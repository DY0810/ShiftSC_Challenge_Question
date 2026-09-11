import { timingSafeEqual, randomUUID } from "node:crypto";
import { getService } from "../extension/catalog.js";
import { retrieveSource, hashText, readLimited } from "./sources.mjs";
import { analyzeSections, splitSources, validateAnalysis, MODEL, ANALYSIS_VERSION, PIPELINE_TIMEOUT_MS } from "./analysis.mjs";
import { redisCommand, RESERVE_LUA, RATE_LUA, BUDGET_KEY, BUDGET_MICRO_USD, RESERVATION_MICRO_USD } from "./ledger.mjs";

const failure = (status, code, message) => ({ status, body: { error: { code, message } } });

async function requestModel(request, env, fetchImpl, signal) {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(75_000)]),
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    let code = "unknown";
    try {
      const body = JSON.parse(await readLimited(response, 8192));
      if (["insufficient_quota", "invalid_api_key", "model_not_found", "rate_limit_exceeded", "permission_denied", "invalid_json_schema"].includes(body.error?.code)) code = body.error.code;
    } catch { /* Never log raw provider bodies or credentials. */ }
    console.error("privacy_model_rejected", { status: response.status, code });
    throw new Error("Model unavailable");
  }
  const result = JSON.parse(await readLimited(response, 262_144));
  if (result.status !== "completed") {
    console.error("privacy_model_incomplete", {
      reason: ["max_output_tokens", "content_filter"].includes(result.incomplete_details?.reason) ? result.incomplete_details.reason : "unknown",
      outputTokens: Number(result.usage?.output_tokens ?? 0)
    });
    throw new Error(result.incomplete_details?.reason === "content_filter" ? "Model content filtered" : "Model did not complete");
  }
  const parts = (result.output ?? []).flatMap((item) => item.type === "message" ? item.content ?? [] : []);
  if (parts.some((part) => part.type === "refusal")) throw new Error("Model refused analysis");
  const content = parts.filter((part) => part.type === "output_text").map((part) => part.text).join("");
  return { analysis: JSON.parse(content), usage: result.usage ?? {} };
}

export async function analyzeRequest({ body, authorization }, options = {}) {
  const env = options.env ?? process.env;
  const expected = env.DEMO_ACCESS_TOKEN;
  if (typeof expected !== "string" || expected.length < 32) {
    return failure(503, "not_configured", "The private backend is not configured. Ask the demo owner to finish setup.");
  }
  const presented = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (presented.length > 256 || !timingSafeEqual(Buffer.from(hashText(expected)), Buffer.from(hashText(presented)))) {
    return failure(401, "unauthorized", "Enter a valid private demo access token.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== 1 || typeof body.serviceId !== "string" || !getService(body.serviceId)) {
    return failure(400, "invalid_request", "Choose Google Maps, Quizlet, or ChatGPT. No other request data is accepted.");
  }
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return failure(503, "not_configured", "Live analysis is disabled until persistent budget storage is configured.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const redis = options.redis ?? ((command) => redisCommand(command, env, fetchImpl));
  const service = getService(body.serviceId);
  let sources;
  let cacheKey;
  const fromCache = (cached) => {
    if (!cached) return null;
    try {
      const stored = JSON.parse(cached);
      if (stored.coverage?.method !== "section-extraction-and-evidence-check" ||
          !Number.isInteger(stored.coverage.sectionsTotal) || stored.coverage.sectionsTotal < 1 ||
          stored.coverage.sectionsCompleted !== stored.coverage.sectionsTotal ||
          !Number.isInteger(stored.coverage.rejectedFindings) || stored.coverage.rejectedFindings < 0) return null;
      const analysis = validateAnalysis({ claims: stored.claims, warnings: stored.warnings }, sources);
      return success(service, sources, analysis, { cached: true, estimatedCostUsd: 0, reservationUsd: 0, modelCalls: 0 },
        stored.analyzedAt, stored.coverage);
    } catch { return null; }
  };
  try {
    const rate = await redis(["EVAL", RATE_LUA, 1,
      `shiftsc:privacy:rate:${hashText(presented)}:${Math.floor(Date.now() / 60_000)}`]);
    if (!Number.isInteger(rate) || rate < 1) throw new Error("Invalid rate response");
    if (rate > 10) {
      return failure(429, "rate_limited", "Please wait a minute before another analysis.");
    }
    sources = await (options.retrieve ?? ((selected) => Promise.all(selected.sources.map((source) =>
      retrieveSource(source, { fetchImpl })))))(service);
    const available = sources.filter((source) => source.status === "available");
    if (!available.length) return failure(503, "source_unavailable", "No readable official policy or valid dated snapshot is available. No privacy conclusion was made.");
    cacheKey = `shiftsc:privacy:analysis:${hashText(JSON.stringify({
      serviceId: service.id, model: MODEL, version: ANALYSIS_VERSION,
      sources: available.map((source) => [source.id, source.hash])
    }))}`;
    const cached = fromCache(await redis(["GET", cacheKey]));
    if (cached) return cached;
  } catch {
    return failure(503, "dependency_unavailable", "Source or budget storage is unavailable. No new model analysis was started.");
  }
  if (!env.OPENAI_API_KEY) return failure(503, "not_configured", "The OpenAI API key is not configured. Live AI analysis is unavailable.");
  const available = sources.filter((source) => source.status === "available");
  try { splitSources(available); }
  catch { return failure(422, "source_too_large", "The policy exceeds this demo's section limits. No text was silently omitted or truncated."); }
  const lockKey = `${cacheKey}:lock`;
  const lockToken = randomUUID();
  try {
    const acquired = await redis(["SET", lockKey, lockToken, "NX", "EX", Math.ceil(PIPELINE_TIMEOUT_MS / 1000) + 30]);
    if (acquired === null) return failure(409, "analysis_in_progress", "This policy is already being analyzed. Try again shortly; no duplicate model request was charged.");
    if (acquired !== "OK") throw new Error("Invalid lock result");
  } catch { return failure(503, "budget_unavailable", "Analysis coordination is unavailable. No model request was made."); }
  const usage = { cached: false, model: MODEL, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
    estimatedCostUsd: 0, reservationUsd: 0, modelCalls: 0 };
  const sectionKey = (section) => `shiftsc:privacy:section:${hashText(JSON.stringify({
    serviceId: service.id, model: MODEL, version: ANALYSIS_VERSION, section
  }))}`;
  try {
    const cached = fromCache(await redis(["GET", cacheKey]));
    if (cached) return cached;
    const analysis = await analyzeSections(service, available, async (request, signal) => {
      signal.throwIfAborted();
      let remaining;
      try {
        remaining = await redis(["EVAL", RESERVE_LUA, 1, BUDGET_KEY, RESERVATION_MICRO_USD, BUDGET_MICRO_USD]);
        if (!Number.isInteger(remaining) || remaining < -1 || remaining > BUDGET_MICRO_USD) throw new Error();
      } catch { throw new Error("Budget unavailable"); }
      if (remaining < 0) throw new Error("Budget exhausted");
      usage.reservationUsd += RESERVATION_MICRO_USD / 1_000_000;
      usage.remainingAllowanceUsd = Math.min(usage.remainingAllowanceUsd ?? Infinity, remaining / 1_000_000);
      signal.throwIfAborted();
      usage.modelCalls++;
      const result = await (options.callModel ?? ((request, signal) => requestModel(request, env, fetchImpl, signal)))(request, signal);
      const input = Math.max(0, Number(result.usage?.input_tokens) || 0);
      const output = Math.max(0, Number(result.usage?.output_tokens) || 0);
      const cachedTokens = Math.min(input, Math.max(0, Number(result.usage?.input_tokens_details?.cached_tokens) || 0));
      usage.inputTokens += input;
      usage.outputTokens += output;
      usage.cachedInputTokens += cachedTokens;
      usage.estimatedCostUsd += ((input - cachedTokens) * 0.25 + cachedTokens * 0.025 + output * 2) / 1_000_000;
      return result;
    }, {
      readSection: async (section) => {
        const stored = await redis(["GET", sectionKey(section)]);
        try { return stored ? JSON.parse(stored) : null; } catch { return null; }
      },
      writeSection: async (section, result) => {
        await redis(["SET", sectionKey(section), JSON.stringify(result), "EX", 604800]);
      }
    });
    const analyzedAt = new Date().toISOString();
    try {
      await redis(["SET", cacheKey, JSON.stringify({ ...analysis, analyzedAt }), "EX", 604800]);
    } catch { analysis.warnings.push("This result could not be cached. Its spending reservations remain recorded."); }
    return success(service, sources, analysis, usage, analyzedAt, analysis.coverage);
  } catch (error) {
    const known = ["Model unavailable", "Model did not complete", "Model content filtered", "Model refused analysis",
      "Invalid analysis structure", "Invalid finding", "Finding lacks an intact source sentence",
      "Model output makes an unsupported assurance", "Invalid warnings", "Duplicate evidence",
      "Invalid evidence review", "Invalid evidence range", "Evidence does not establish browser location permission",
      "Budget unavailable", "Budget exhausted", "No supported findings"];
    console.error("privacy_analysis_failed", {
      reason: known.includes(error?.message) ? error.message : error?.name === "TimeoutError" ? "timeout" : "invalid_response",
      section: /^s\d+$/.test(error?.sectionId) ? error.sectionId : null,
      stage: ["extraction", "evidence-review"].includes(error?.analysisStage) ? error.analysisStage : null
    });
    let result;
    if (error?.message === "Budget exhausted") {
      result = failure(429, "budget_exhausted", "The $5 allowance cannot cover the remaining analysis checks. No partial findings were published. Unchanged cached results may still be available.");
    } else if (error?.message === "Budget unavailable") {
      result = failure(503, "budget_unavailable", "Spending could not be checked. No further model calls were made and no partial findings were published.");
    } else if (["Model content filtered", "Model refused analysis"].includes(error?.message)) {
      result = failure(502, "analysis_filtered", "The AI provider declined a policy section. Analysis stopped without retries or partial findings. Ask the demo owner to review the provider response.");
    } else if (error?.message === "No supported findings") {
      result = failure(422, "no_supported_findings", "No candidate findings passed the evidence checks. This is not proof that the service collects no information.");
    } else {
      result = failure(502, "analysis_unverified", "A policy section or evidence check did not complete successfully. No partial findings were published. Spending reservations remain recorded.");
    }
    result.body.usage = { modelCalls: usage.modelCalls, reservationUsd: usage.reservationUsd,
      remainingAllowanceUsd: usage.remainingAllowanceUsd };
    return result;
  } finally {
    try {
      await redis(["EVAL", "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", 1, lockKey, lockToken]);
    } catch { /* Lock expires; spending reservations never expire. */ }
  }
}

function success(service, sources, analysis, usage, analyzedAt = new Date().toISOString(), coverage) {
  const available = sources.filter((source) => source.status === "available");
  const snapshot = available.filter((source) => source.method === "snapshot");
  const unavailable = sources.filter((source) => source.status === "unavailable");
  const mode = snapshot.length === available.length ? "snapshot"
    : snapshot.length || unavailable.length ? "mixed" : "live";
  return { status: 200, body: {
    serviceId: service.id, analyzedAt, mode, claims: analysis.claims,
    sources: sources.map(({ text, ...metadata }) => metadata),
    warnings: [
      "Company disclosures are not an independent audit or verification of your account settings.",
      `All ${coverage.sectionsCompleted} sections of the available text completed extraction and a separate AI evidence check. Findings remain selective, not a complete inventory.`,
      `${coverage.rejectedFindings} candidate findings were excluded after evidence review or deduplication.`,
      "The evidence check is another AI judgment, not independent verification. Categories, explanations, purposes, and retention interpretations may still be wrong.",
      ...analysis.warnings,
      ...(sources.some((source) => source.method === "reader") ? ["Public-reader retrieval was used. Upstream completeness and freshness are not independently guaranteed."] : []),
      ...(snapshot.length ? ["Some evidence is a dated snapshot. Its currentness could not be verified."] : []),
      ...(unavailable.length ? ["Some official sources were unavailable. Missing information is not proof that collection does not occur."] : [])
    ],
    usage, coverage
  } };
}
