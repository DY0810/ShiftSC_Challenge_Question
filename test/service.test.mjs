import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRequest } from "../lib/service.mjs";

const token = "test-only-access-token-at-least-32-characters";
const env = { DEMO_ACCESS_TOKEN: token, OPENAI_API_KEY: "test-only-not-a-real-key",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "test-storage" };
const text = "We collect your submitted content. ".repeat(35);
const sources = [{ id: "openai-privacy", url: "https://openai.com/policies/privacy-policy/", title: "Test document",
  status: "available", method: "direct", text, hash: "testhash", retrievedAt: "2026-09-01T00:00:00.000Z", capturedAt: null }];
const analysis = { claims: [{
  id: "content", dataCategory: "content", purposes: ["essential"], label: "Content",
  summary: "Submitted content is received.", condition: "When submitted.", retention: "Not stated.",
  sourceId: "openai-privacy", evidenceQuote: "We collect your submitted content."
}], warnings: [] };
const request = (body = { serviceId: "chatgpt" }, authorization = `Bearer ${token}`) => ({ body, authorization });

test("unauthorized or malformed analysis never reaches source, storage, or model providers", async () => {
  let external = 0;
  const deps = { env, redis: async () => { external++; }, retrieve: async () => { external++; }, callModel: async () => { external++; } };
  assert.equal((await analyzeRequest(request(undefined, "Bearer wrong"), deps)).status, 401);
  assert.equal((await analyzeRequest(request({ serviceId: "chatgpt", url: "http://localhost" }), deps)).status, 400);
  assert.equal((await analyzeRequest(request({ serviceId: "unknown" }), deps)).status, 400);
  assert.equal(external, 0);
});

test("budget exhaustion and storage failure prevent model calls", async () => {
  let calls = 0;
  const deps = {
    env, retrieve: async () => sources,
    redis: async (command) => command[0] === "GET" ? null : command[0] === "SET" ? "OK" : command.includes("shiftsc:privacy:budget:v1") ? -1 : 1,
    callModel: async () => { calls++; }
  };
  assert.equal((await analyzeRequest(request(), deps)).status, 429);
  assert.equal(calls, 0);
  deps.redis = async () => { throw new Error("offline"); };
  assert.equal((await analyzeRequest(request(), deps)).status, 503);
  assert.equal(calls, 0);
});

test("a grounded cached result costs no model call or budget reservation", async () => {
  const commands = [];
  const result = await analyzeRequest(request(), {
    env, retrieve: async () => sources,
    redis: async (command) => {
      commands.push(command);
      return command[0] === "GET" ? JSON.stringify({ ...analysis, analyzedAt: "2026-09-01T00:00:00.000Z" }) : 1;
    },
    callModel: async () => { throw new Error("must not call a model for cache hits"); }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.claims.length, 1);
  assert.equal(result.body.usage.cached, true);
  assert.ok(commands.every((command) => !command.includes("shiftsc:privacy:budget:v1")));
});

test("a source snapshot stays marked snapshot even after a new successful model analysis", async () => {
  const commands = [];
  const result = await analyzeRequest(request(), {
    env, retrieve: async () => sources.map((source) => ({ ...source, method: "snapshot", capturedAt: "2026-09-01T00:00:00.000Z", retrievedAt: null })),
    redis: async (command) => { commands.push(command); return command[0] === "GET" ? null : command[0] === "SET" ? "OK" : 1; },
    callModel: async () => ({ analysis, usage: { input_tokens: 100, output_tokens: 50 } })
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.mode, "snapshot");
  assert.ok(result.body.warnings.some((warning) => /snapshot/i.test(warning)));
  assert.ok(commands.some((command) => command.includes("shiftsc:privacy:budget:v1")));
  assert.equal(result.body.sources[0].text, undefined, "do not return full policy bodies to the extension");
});

test("no source and missing model credentials are explicit failures, never fixture responses", async () => {
  const redis = async (command) => command[0] === "GET" ? null : 1;
  assert.equal((await analyzeRequest(request(), { env, redis, retrieve: async () => [] })).body.error.code, "source_unavailable");
  assert.equal((await analyzeRequest(request(), { env: { ...env, OPENAI_API_KEY: "" }, redis, retrieve: async () => sources })).body.error.code, "not_configured");
});

test("null or malformed spending and rate replies fail closed before a paid request", async () => {
  let calls = 0;
  const base = { env, retrieve: async () => sources, callModel: async () => { calls++; } };
  assert.equal((await analyzeRequest(request(), { ...base, redis: async () => null })).status, 503);
  assert.equal((await analyzeRequest(request(), {
    ...base, redis: async (command) => command[0] === "GET" ? null : command[0] === "SET" ? "OK" : command.includes("shiftsc:privacy:budget:v1") ? null : 1
  })).status, 503);
  assert.equal(calls, 0);
});

test("concurrent identical analyses share an in-flight lock and spend only one reservation", async () => {
  const values = new Map();
  let modelCalls = 0;
  let reservations = 0;
  const redis = async (command) => {
    const [name, ...args] = command;
    if (name === "GET") return values.get(args[0]) ?? null;
    if (name === "SET") {
      if (args.includes("NX") && values.has(args[0])) return null;
      values.set(args[0], args[1]);
      return "OK";
    }
    if (command.includes("shiftsc:privacy:budget:v1")) { reservations++; return 4_930_000; }
    if (String(args[0]).includes("DEL")) { values.delete(args[2]); return 1; }
    return 1;
  };
  const results = await Promise.all(Array.from({ length: 10 }, () => analyzeRequest(request(), {
    env, redis, retrieve: async () => sources,
    callModel: async () => {
      modelCalls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { analysis, usage: { input_tokens: 100, output_tokens: 20 } };
    }
  })));
  assert.equal(modelCalls, 1);
  assert.equal(reservations, 1);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(results.filter((result) => result.body.error?.code === "analysis_in_progress").length, 9);
});

test("unsupported assurance in model warnings cannot escape through fresh output or cache", async () => {
  const bad = { ...analysis, warnings: ["Independently verified: no tracking and zero collection."] };
  for (const cached of [null, JSON.stringify({ ...bad, analyzedAt: new Date().toISOString() })]) {
    const result = await analyzeRequest(request(), {
      env, retrieve: async () => sources,
      redis: async (command) => command[0] === "GET" ? cached : command[0] === "SET" ? "OK" : 1,
      callModel: async () => ({ analysis: bad, usage: {} })
    });
    assert.equal(result.status, 502);
    assert.equal(result.body.error.code, "analysis_unverified");
  }
});
