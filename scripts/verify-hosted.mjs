import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { getService } from "../extension/catalog.js";

const base = new URL(process.env.API_BASE || "https://shiftsc-privacy-choices.vercel.app");
assert.equal(base.protocol, "https:");
assert.ok(process.env.DEMO_ACCESS_TOKEN, "Load .env.local first");
const results = [];
const serviceIds = (process.env.SERVICE_IDS || "maps,quizlet,chatgpt").split(",");
assert.ok(serviceIds.length && serviceIds.every((id) => getService(id)));
await mkdir("output/qa", { recursive: true });
async function request(body, authorization) {
  const start = Date.now();
  const response = await fetch(new URL("/api/analyze", base), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(210_000),
    headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify(body)
  });
  return { status: response.status, durationMs: Date.now() - start, body: await response.json() };
}
const unauthorized = await request({ serviceId: "maps" }, "Bearer invalid");
assert.equal(unauthorized.status, 401);
const token = `Bearer ${process.env.DEMO_ACCESS_TOKEN}`;
const extra = await request({ serviceId: "maps", unexpected: true }, token);
assert.equal(extra.status, 400);
for (const serviceId of serviceIds) {
  const response = await request({ serviceId }, token);
  const { body, status, durationMs } = response;
  if (status === 200) {
    assert.equal(body.serviceId, serviceId);
    assert.notEqual(body.mode, "fixture");
    assert.ok(body.claims.length > 0);
    assert.equal(body.coverage.method, "section-extraction-and-evidence-check");
    assert.ok(body.coverage.sectionsTotal > 0);
    assert.equal(body.coverage.sectionsCompleted, body.coverage.sectionsTotal);
    assert.ok(body.sources.every((source) => getService(serviceId).sources.some((entry) => entry.id === source.id && entry.url === source.url)));
  }
  await writeFile(`output/qa/sections-live-${serviceId}.json`, JSON.stringify({
    checkedAt: new Date().toISOString(), ...response
  }, null, 2) + "\n");
  const result = { serviceId, status, durationMs, code: body.error?.code ?? "analysis_received",
    findings: body.claims?.length, coverage: body.coverage, usage: body.usage };
  results.push(result);
  console.log(JSON.stringify(result));
}
const passed = results.every((result) => result.status === 200);
await writeFile("output/qa/hosted.json", JSON.stringify({
  checkedAt: new Date().toISOString(), base: base.origin, results, authenticationVerified: true,
  passed, liveAnalysisVerified: passed && ["maps", "quizlet", "chatgpt"].every((id) => serviceIds.includes(id)),
  evidenceBoundary: "Actual hosted analysis responses. These checks prove request flow and validation, not independent semantic accuracy or actual collection behavior."
}, null, 2) + "\n");
if (!passed) process.exitCode = 1;
