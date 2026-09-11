import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const base = new URL(process.env.API_BASE || "https://shiftsc-privacy-choices.vercel.app");
assert.equal(base.protocol, "https:");
assert.ok(process.env.DEMO_ACCESS_TOKEN, "Load .env.local first");
const results = [];
for (const [label, authorization] of [
  ["unauthorized", "Bearer invalid"],
  ["authorized", `Bearer ${process.env.DEMO_ACCESS_TOKEN}`]
]) {
  const response = await fetch(new URL("/api/analyze", base), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000),
    headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify({ serviceId: "maps" })
  });
  const body = await response.json();
  results.push({ label, status: response.status, code: body.error?.code ?? "analysis_received" });
  if (label === "unauthorized") assert.equal(response.status, 401);
  if (label === "authorized") assert.ok(response.status === 200 || body.error?.code === "not_configured",
    `Unexpected hosted response: ${response.status} ${body.error?.code}`);
}
await mkdir("output/qa", { recursive: true });
await writeFile("output/qa/hosted.json", JSON.stringify({
  checkedAt: new Date().toISOString(), base: base.origin, results,
  liveAnalysisVerified: results.find((result) => result.label === "authorized").status === 200
}, null, 2) + "\n");
console.log(JSON.stringify(results));
