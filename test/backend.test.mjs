import test from "node:test";
import assert from "node:assert/strict";
import { extractText, isPolicyText, retrieveSource } from "../lib/sources.mjs";
import { validateAnalysis, buildModelRequest, splitSources, MODEL_REQUEST_BYTES } from "../lib/analysis.mjs";
import { redisCommand } from "../lib/ledger.mjs";
import { getService } from "../extension/catalog.js";

const source = { id: "openai-controls", url: "https://help.openai.com/en/articles/7730893-data-controls-faq", title: "Data Controls FAQ" };
// Synthetic test document, never presented as an actual publisher policy.
const text = "Data Controls FAQ. " + "We collect user content to provide our service. ".repeat(35);
const claim = { id: "content", dataCategory: "content", purposes: ["essential"], label: "Submitted content",
  summary: "The service receives submitted content.", condition: "When you submit it.", retention: "Not stated in this excerpt.",
  sourceId: source.id, evidenceQuote: "We collect user content to provide our service." };

test("policy extraction strips executable and navigation text, and rejects challenge documents", () => {
  const extracted = extractText(`<html><nav>Noise</nav><script>evil()</script><main><h1>Data Controls FAQ</h1><p>${text}</p></main></html>`, "text/html");
  assert.ok(extracted.includes("We collect user content"));
  assert.ok(!extracted.includes("evil") && !extracted.includes("Noise"));
  assert.equal(isPolicyText(extracted, source), true);
  assert.equal(isPolicyText("Title: Just a moment... Verify you are human. " + "privacy ".repeat(200), source), false);
});

test("a reader response missing the known policy ending is not treated as a complete source", () => {
  const incomplete = "US privacy policy. We collect personal data. ".repeat(40);
  assert.equal(isPolicyText(incomplete, { id: "openai-privacy" }), false);
  assert.equal(isPolicyText(incomplete + " 9. Additional U.S. state disclosures 12. How to contact us 13. Useful resources", { id: "openai-privacy" }), true);
});

test("a failed live fetch and reader use a dated snapshot without relabeling it live", async () => {
  let calls = 0;
  const result = await retrieveSource(source, {
    fetchImpl: async () => { calls++; return new Response("CAPTCHA", { status: 403 }); },
    readSnapshot: async () => ({ ...source, text, capturedAt: "2026-09-01T10:00:00.000Z", method: "browser" })
  });
  assert.equal(calls, 2);
  assert.equal(result.method, "snapshot");
  assert.equal(result.capturedAt, "2026-09-01T10:00:00.000Z");
  assert.equal(result.status, "available");
});

test("invalid snapshots and redirects outside the source origin remain unavailable", async () => {
  const visited = [];
  const result = await retrieveSource(source, {
    fetchImpl: async (url) => {
      visited.push(String(url));
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    },
    readSnapshot: async () => ({ ...source, text: "Verify you are human", capturedAt: "2026-09-01" })
  });
  assert.equal(result.status, "unavailable");
  assert.ok(visited.every((url) => !url.startsWith("http://127")));
});

test("model output cannot invent source evidence, duplicate identifiers, or action URLs", () => {
  const sources = [{ ...source, text, status: "available" }];
  assert.equal(validateAnalysis({ claims: [claim], warnings: [] }, sources).claims.length, 1);
  assert.throws(() => validateAnalysis({ claims: [{ ...claim, evidenceQuote: "No information is ever collected." }], warnings: [] }, sources));
  assert.throws(() => validateAnalysis({ claims: [claim, claim], warnings: [] }, sources));
  assert.throws(() => validateAnalysis({ claims: [claim, { ...claim, id: "another-id" }], warnings: [] }, sources), /Duplicate evidence/);
  assert.throws(() => validateAnalysis({ claims: [{ ...claim, actionUrl: "https://evil.test" }], warnings: [] }, sources));
});

test("quotes cannot drop the negation or sentence context, and model text cannot claim verification", () => {
  const negative = [{ ...source, text: "We do not knowingly collect Personal Data from children under 13.", status: "available" }];
  assert.throws(() => validateAnalysis({ claims: [{ ...claim, evidenceQuote: "collect Personal Data from children under 13." }], warnings: [] }, negative));
  assert.throws(() => validateAnalysis({ claims: [{ ...claim, summary: "Independently verified: all information is safe." }], warnings: [] }, [{ ...source, text, status: "available" }]));
  assert.throws(() => validateAnalysis({ claims: [claim], warnings: ["Independently verified: no tracking and zero collection."] }, [{ ...source, text, status: "available" }]));
});

test("a generic device-location disclosure cannot be resolved by a browser geolocation control", () => {
  const quote = "If your device location setting is on, current device location may be used for nearby ads.";
  assert.throws(() => validateAnalysis({ claims: [{
    ...claim, dataCategory: "browser_location", evidenceQuote: quote
  }], warnings: [] }, [{ ...source, text: quote, status: "available" }]), /browser/i);
  const explicit = "Your browser asks for permission before sharing your location with this website.";
  assert.equal(validateAnalysis({ claims: [{
    ...claim, dataCategory: "browser_location", evidenceQuote: explicit
  }], warnings: [] }, [{ ...source, text: explicit, status: "available" }]).claims.length, 1);
});

test("partial HTTP responses and reader stale warnings never become live source evidence", async () => {
  for (const response of [
    () => new Response(text, { status: 206, headers: { "content-type": "text/plain" } }),
    () => new Response(`Title: Data Controls FAQ\nWarning: cached copy may be stale\nMarkdown Content:\n${text}`, { status: 200 })
  ]) {
    const result = await retrieveSource(source, { fetchImpl: async () => response(), readSnapshot: async () => null });
    assert.equal(result.status, "unavailable");
  }
});

test("model requests are bounded, use only source text, and do not allow tools or storage", () => {
  const request = buildModelRequest(getService("chatgpt"), splitSources([{ ...source, text }])[0]);
  assert.equal(request.model, "gpt-5-mini");
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 4000);
  assert.equal(request.text.format.strict, true);
  assert.equal(request.tools, undefined);
  const input = JSON.parse(request.input[1].content);
  assert.equal(input.section.sentences.map((entry) => entry.text).join(" "), text.trim());
  assert.ok(Buffer.byteLength(JSON.stringify(request)) <= MODEL_REQUEST_BYTES);
  assert.throws(() => splitSources([{ ...source, text: "x".repeat(190_000) }]));
});

test("evidence may span complete adjacent sentences but cannot omit middle text", () => {
  const evidence = 'We collect content. We call it "data". We do not sell it.';
  const sources = [{ ...source, text: evidence, status: "available" }];
  assert.equal(validateAnalysis({ claims: [{ ...claim, evidenceQuote: evidence }], warnings: [] }, sources).claims.length, 1);
  assert.throws(() => validateAnalysis({ claims: [{ ...claim, evidenceQuote: "We collect content. We do not sell it." }], warnings: [] }, sources));
});

test("Redis failures are errors and credentials travel in headers rather than URLs", async () => {
  const env = { UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "test-secret" };
  let seen;
  const value = await redisCommand(["GET", "key"], env, async (url, options) => {
    seen = { url, options };
    return Response.json({ result: "42" });
  });
  assert.equal(value, "42");
  assert.equal(seen.url, "https://example.upstash.io");
  assert.equal(seen.options.headers.Authorization, "Bearer test-secret");
  assert.deepEqual(JSON.parse(seen.options.body), ["GET", "key"]);
  await assert.rejects(() => redisCommand(["GET", "key"], env, async () => Response.json({ error: "failure" })));
});
