import { mkdir, writeFile } from "node:fs/promises";
import { SERVICES } from "../extension/catalog.js";
import { retrieveSource } from "../lib/sources.mjs";

await mkdir("data/snapshots", { recursive: true });
for (const source of SERVICES.flatMap((service) => service.sources)) {
  const result = await retrieveSource(source, { readSnapshot: async () => null });
  if (result.status !== "available") {
    console.log(`${source.id}: unavailable; no snapshot written`);
    continue;
  }
  await writeFile(`data/snapshots/${source.id}.json`, JSON.stringify({
    id: source.id, url: source.url, title: source.title, text: result.text,
    capturedAt: result.retrievedAt, method: result.method,
    reviewNote: "Fetched public source; passed challenge and content checks. Not a legal or behavioral audit."
  }, null, 2) + "\n");
  console.log(`${source.id}: captured ${result.method}, ${result.text.length} characters`);
}
