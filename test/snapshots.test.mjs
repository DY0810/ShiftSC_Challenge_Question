import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SERVICES } from "../extension/catalog.js";
import { isPolicyText, normalizeText } from "../lib/sources.mjs";

test("all reviewed snapshots identify official sources, carry real dates, and contain policy text", async () => {
  for (const source of SERVICES.flatMap((service) => service.sources)) {
    const snapshot = JSON.parse(await readFile(new URL(`../data/snapshots/${source.id}.json`, import.meta.url), "utf8"));
    assert.equal(snapshot.id, source.id);
    assert.equal(snapshot.url, source.url);
    assert.ok(["browser", "direct", "reader"].includes(snapshot.method));
    assert.ok(Date.parse(snapshot.capturedAt) <= Date.now());
    assert.ok(isPolicyText(normalizeText(snapshot.text), source), source.id);
  }
});
