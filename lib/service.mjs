import { timingSafeEqual, randomUUID } from "node:crypto";
import { getService } from "../extension/catalog.js";
import { retrieveSource, hashText, readLimited } from "./sources.mjs";
import { buildModelRequest, validateAnalysis, MODEL, ANALYSIS_VERSION } from "./analysis.mjs";
import { redisCommand, RESERVE_LUA, RATE_LUA, BUDGET_KEY, BUDGET_MICRO_USD, RESERVATION_MICRO_USD } from "./ledger.mjs";

const failure = (status, code, message) => ({ status, body: { error: { code, message } } });

async function requestModel(request, env, fetchImpl) {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Model unavailable"); }
  const result = JSON.parse(await readLimited(response, 262_144));
  if (result.status !== "completed") throw new Error("Model did not complete");
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
      const analysis = validateAnalysis({ claims: stored.claims, warnings: stored.warnings }, sources);
      return success(service, sources, analysis, { cached: true, estimatedCostUsd: 0 }, stored.analyzedAt);
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
  let modelRequest;
  try { modelRequest = buildModelRequest(service, sources.filter((source) => source.status === "available")); }
  catch { return failure(422, "source_too_large", "The available policy exceeds this demo's analysis limit. It was not silently truncated."); }
  const lockKey = `${cacheKey}:lock`;
  const lockToken = randomUUID();
  try {
    const acquired = await redis(["SET", lockKey, lockToken, "NX", "EX", 90]);
    if (acquired === null) return failure(409, "analysis_in_progress", "This policy is already being analyzed. Try again shortly; no duplicate model request was charged.");
    if (acquired !== "OK") throw new Error("Invalid lock result");
  } catch { return failure(503, "budget_unavailable", "Analysis coordination is unavailable. No model request was made."); }
  try {
    const cached = fromCache(await redis(["GET", cacheKey]));
    if (cached) return cached;
    const remaining = await redis(["EVAL", RESERVE_LUA, 1, BUDGET_KEY, RESERVATION_MICRO_USD, BUDGET_MICRO_USD]);
    if (!Number.isInteger(remaining) || remaining < -1 || remaining > BUDGET_MICRO_USD) throw new Error("Invalid budget response");
    if (remaining < 0) return failure(429, "budget_exhausted", "The $5 demo allowance is exhausted. Existing unchanged cached analyses may still be available.");
    try {
      const result = await (options.callModel ?? ((request) => requestModel(request, env, fetchImpl)))(modelRequest);
      const analysis = validateAnalysis(result.analysis, sources);
      const input = Number(result.usage?.input_tokens ?? 0);
      const output = Number(result.usage?.output_tokens ?? 0);
      const cachedTokens = Number(result.usage?.input_tokens_details?.cached_tokens ?? 0);
      const usage = {
        cached: false, model: MODEL, inputTokens: input, outputTokens: output, cachedInputTokens: cachedTokens,
        estimatedCostUsd: ((input - cachedTokens) * 0.25 + cachedTokens * 0.025 + output * 2) / 1_000_000,
        reservationUsd: RESERVATION_MICRO_USD / 1_000_000
      };
      const analyzedAt = new Date().toISOString();
      try {
        await redis(["SET", cacheKey, JSON.stringify({ ...analysis, analyzedAt }), "EX", 604800]);
      } catch { analysis.warnings.push("This result could not be cached. Its spending reservation remains recorded."); }
      return success(service, sources, analysis, usage, analyzedAt);
    } catch {
      return failure(502, "analysis_unverified", "The model did not return a complete, source-matched analysis. No privacy conclusion was made. Its reservation is retained to prevent overspending.");
    }
  } catch {
    return failure(503, "budget_unavailable", "The spending limit could not be checked. No model request was made.");
  } finally {
    try {
      await redis(["EVAL", "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", 1, lockKey, lockToken]);
    } catch { /* Lock expires; spending reservations never expire. */ }
  }
}

function success(service, sources, analysis, usage, analyzedAt = new Date().toISOString()) {
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
      "AI-generated categories, explanations, purposes, and retention interpretations may be wrong. Exact sentence matching does not prove semantic accuracy.",
      ...analysis.warnings,
      ...(sources.some((source) => source.method === "reader") ? ["Public-reader retrieval was used. Upstream completeness and freshness are not independently guaranteed."] : []),
      ...(snapshot.length ? ["Some evidence is a dated snapshot. Its currentness could not be verified."] : []),
      ...(unavailable.length ? ["Some official sources were unavailable. Missing information is not proof that collection does not occur."] : [])
    ],
    usage
  } };
}
