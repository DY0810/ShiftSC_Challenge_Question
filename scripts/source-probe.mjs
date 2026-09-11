import { mkdir, writeFile } from "node:fs/promises";
import { SERVICES } from "../extension/catalog.js";
import { retrieveSource } from "../lib/sources.mjs";

const results = [];
for (const service of SERVICES) {
  for (const source of service.sources) {
    const start = performance.now();
    const { text, ...record } = await retrieveSource(source);
    results.push({ ...record, durationMs: Math.round(performance.now() - start), characters: text.length });
    console.log(`${source.id}: ${record.status}, ${record.method ?? "none"}, ${text.length} characters`);
  }
}
await mkdir("output/qa", { recursive: true });
await writeFile("output/qa/source-probe.json", JSON.stringify({
  checkedAt: new Date().toISOString(), results,
  boundary: "Real retrieval from this machine, not the deployed data center. No model calls. Reader freshness and semantic completeness are not guaranteed."
}, null, 2) + "\n");
if (results.some((source) => source.status !== "available")) process.exitCode = 1;
