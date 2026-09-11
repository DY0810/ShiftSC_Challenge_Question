import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as analysis from "../lib/analysis.mjs";
import { normalizeText } from "../lib/sources.mjs";
import { SERVICES } from "../extension/catalog.js";
import { RESERVATION_MICRO_USD } from "../lib/ledger.mjs";

const service = SERVICES[2];
const source = { id: "openai-privacy", title: "Synthetic policy", status: "available",
  method: "snapshot", capturedAt: "2026-09-01T00:00:00Z",
  text: 'We collect the messages you submit to deliver replies. We do not sell your messages.' };
const claim = { id: "content", sourceId: source.id, dataCategory: "content", purposes: ["essential"],
  label: "Submitted messages", summary: "Messages you submit are received to deliver replies.",
  condition: "When you submit a message.", retention: "Not stated in this evidence.",
  evidenceQuote: "We collect the messages you submit to deliver replies." };

const review = (claims, supported = true) => ({ checks: claims.map(({ id }) => ({
  id, labelSupported: supported, summarySupported: supported, categorySupported: supported,
  purposesSupported: supported, conditionSupported: supported, retentionSupported: supported,
  collectionAffirmed: supported, browserScopeSupported: supported
})) });

test("section splitting covers every sentence of every shipped source without dropping text", async () => {
  assert.equal(typeof analysis.splitSources, "function", "section splitting is missing");
  for (const service of SERVICES) {
    const sources = await Promise.all(service.sources.map(async (entry) =>
      ({ ...entry, ...JSON.parse(await readFile(new URL(`../data/snapshots/${entry.id}.json`, import.meta.url))),
        status: "available" })));
    const sections = analysis.splitSources(sources);
    assert.ok(sections.length > 1);
    assert.ok(sections.every((section) => Buffer.byteLength(section.text) <= analysis.SECTION_BYTES));
    for (const source of sources) {
      assert.equal(sections.filter((section) => section.sourceId === source.id).map((section) => section.text).join(" "),
        normalizeText(source.text));
    }
  }
});

test("oversized sentences fail explicitly instead of truncating or skipping part of a policy", () => {
  assert.equal(typeof analysis.splitSources, "function");
  assert.throws(() => analysis.splitSources([{ ...source, text: "X".repeat(analysis.SECTION_BYTES + 1) }]), /section/i);
});

test("section requests use a static schema and preserve quoted words and negations in context", () => {
  assert.equal(typeof analysis.splitSources, "function");
  const section = analysis.splitSources([{ ...source, text: 'We call it "content". We do not sell your messages.' }])[0];
  const request = analysis.buildModelRequest(service, section);
  assert.ok(Buffer.byteLength(JSON.stringify(request)) <= analysis.MODEL_REQUEST_BYTES);
  assert.equal(request.store, false);
  assert.equal(request.tools, undefined);
  assert.equal(request.text.format.schema.properties.claims.items.properties.evidenceQuote, undefined);
  assert.equal(JSON.parse(request.input[1].content).section.sentences.map((entry) => entry.text).join(" "), section.text);
  for (const request of [analysis.buildModelRequest(service, section),
    analysis.buildReviewRequest(service, section, [{ ...claim, evidenceQuote: 'We call it "content".' }])]) {
    // Conservatively count one token per UTF-8 byte, plus message overhead.
    const upperCostMicroUsd = (analysis.MODEL_REQUEST_BYTES + 2048) * 0.25 + request.max_output_tokens * 2;
    assert.ok(upperCostMicroUsd < RESERVATION_MICRO_USD, "Every call fits its spending reservation");
  }
});

test("a separate evidence check removes an explanation that contradicts an intact quote", async () => {
  assert.equal(typeof analysis.analyzeSections, "function", "section pipeline is missing");
  const wrong = { ...claim, id: "sale", summary: "Messages are sold to advertisers.",
    purposes: ["advertising"], evidenceQuote: "We do not sell your messages." };
  const calls = [];
  const result = await analysis.analyzeSections(service, [source], async (request) => {
    calls.push(request);
    if (request.text.format.name === "privacy_section") {
      return { analysis: { claims: [claim, wrong].map(({ sourceId, evidenceQuote, ...rest }, index) =>
        ({ ...rest, evidenceStart: index, evidenceEnd: index })), warnings: [] } };
    }
    const { claims } = JSON.parse(request.input[1].content);
    const checked = review(claims);
    checked.checks[1].summarySupported = false;
    checked.checks[1].collectionAffirmed = false;
    return { analysis: checked };
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].text.format.name, "privacy_evidence_check");
  assert.deepEqual(result.claims.map((item) => item.summary), [claim.summary]);
  assert.equal(result.coverage.rejectedFindings, 1);
  assert.equal(result.coverage.sectionsCompleted, result.coverage.sectionsTotal);
});

test("evidence ranges are server-resolved, bounded, and cannot skip a negation", () => {
  assert.equal(typeof analysis.resolveSectionClaims, "function");
  const section = analysis.splitSources([source])[0];
  const { sourceId, evidenceQuote, ...rest } = claim;
  const raw = { claims: [{ ...rest, evidenceStart: 0, evidenceEnd: 1 }], warnings: [] };
  assert.equal(analysis.resolveSectionClaims(raw, section).claims[0].evidenceQuote, source.text);
  for (const [start, end] of [[-1, 0], [1, 0], [0, 999], [0.5, 1], ["0", 1]]) {
    assert.throws(() => analysis.resolveSectionClaims({ ...raw, claims: [{ ...rest, evidenceStart: start, evidenceEnd: end }] }, section));
  }
  assert.throws(() => analysis.resolveSectionClaims({ ...raw, claims: [{ ...raw.claims[0], evidenceQuote: "invented" }] }, section));
});

test("missing or repeated review verdicts cannot be treated as approval", () => {
  assert.equal(typeof analysis.acceptReviewedClaims, "function");
  assert.throws(() => analysis.acceptReviewedClaims([claim], { checks: [] }), /review/i);
  assert.throws(() => analysis.acceptReviewedClaims([claim], { checks: [...review([claim]).checks, ...review([claim]).checks] }), /review/i);
  assert.throws(() => analysis.acceptReviewedClaims([claim], review([{ id: "invented" }])), /review/i);
  const invalid = review([claim]);
  invalid.checks[0].summarySupported = "true";
  assert.throws(() => analysis.acceptReviewedClaims([claim], invalid), /review/i);
  const mobileOnly = review([claim]);
  mobileOnly.checks[0].browserScopeSupported = false;
  assert.deepEqual(analysis.acceptReviewedClaims([claim], mobileOnly), []);
});

test("unclear purpose or retention does not erase a supported collection fact or invent missing details", () => {
  const checked = review([claim]);
  checked.checks[0].purposesSupported = false;
  checked.checks[0].retentionSupported = false;
  checked.checks[0].conditionSupported = false;
  const accepted = analysis.acceptReviewedClaims([claim], checked);
  assert.equal(accepted.length, 1);
  assert.deepEqual(accepted[0].purposes, []);
  assert.equal(accepted[0].retention, "Not established by the cited evidence.");
  assert.equal(accepted[0].condition, "Not established by the cited evidence.");
  assert.equal(accepted[0].summary, claim.summary);
});

test("evidence review does not borrow support from unrelated text elsewhere in a section", () => {
  const section = analysis.splitSources([{ ...source, text:
    source.text + " Privacy choices vary. Unrelated business products process credit card statements." }])[0];
  const request = analysis.buildReviewRequest(service, section, [claim]);
  const input = JSON.parse(request.input[1].content);
  assert.equal(input.section.text, undefined);
  assert.ok(JSON.stringify(input).includes(claim.evidenceQuote));
  assert.ok(!JSON.stringify(input).includes("Unrelated business products"));
});

test("a refused or failed section stops the pipeline without fabricated partial results or retries", async () => {
  assert.equal(typeof analysis.analyzeSections, "function");
  let calls = 0;
  await assert.rejects(() => analysis.analyzeSections(service, [source], async () => {
    calls++;
    throw new Error("Model content filtered");
  }), /Model content filtered/);
  assert.equal(calls, 1);
});

test("section work is bounded and an aborted sibling cannot overwrite the original failure", async () => {
  const many = { ...source, text: "We collect messages to deliver replies. ".repeat(1000) };
  let calls = 0;
  let active = 0;
  let maximum = 0;
  await assert.rejects(() => analysis.analyzeSections(service, [many], async (request, signal) => {
    calls++;
    active++;
    maximum = Math.max(maximum, active);
    const section = JSON.parse(request.input[1].content).section;
    try {
      if (section.id === "s1") {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("Model content filtered");
      }
      await new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    } finally { active--; }
  }), (error) => error.message === "Model content filtered" && error.sectionId === "s1" && error.analysisStage === "extraction");
  assert.equal(maximum, 3);
  assert.equal(calls, 3, "Do not start the rest of the policy after a section fails");
  assert.equal(active, 0);
});

test("duplicate candidates are evidence-checked then merged rather than failing the whole policy", async () => {
  const { sourceId, evidenceQuote, ...rest } = claim;
  const result = await analysis.analyzeSections(service, [source], async (request) =>
    request.text.format.name === "privacy_section"
      ? { analysis: { claims: [rest, { ...rest, id: "duplicate" }].map((claim) =>
        ({ ...claim, evidenceStart: 0, evidenceEnd: 0 })), warnings: [] } }
      : { analysis: review(JSON.parse(request.input[1].content).claims) });
  assert.equal(result.claims.length, 1);
  assert.equal(result.coverage.rejectedFindings, 1);
});

test("invalid candidates are counted and excluded while valid evidence still receives review", async () => {
  const { sourceId, evidenceQuote, ...rest } = claim;
  const valid = { ...rest, evidenceStart: 0, evidenceEnd: 0 };
  const invalid = { ...valid, evidenceEnd: 9999 };
  const result = await analysis.analyzeSections(service, [source], async (request) =>
    request.text.format.name === "privacy_section"
      ? { analysis: { claims: [valid, invalid], warnings: [] } }
      : { analysis: review(JSON.parse(request.input[1].content).claims) });
  assert.equal(result.claims.length, 1);
  assert.equal(result.coverage.rejectedFindings, 1);
});

test("completed evidence checks survive a later section failure and are reused on the next request", async () => {
  const text = "We collect the messages you submit to deliver replies. ".repeat(190);
  const multiple = [{ ...source, text }];
  const cache = new Map();
  const caching = { readSection: async (section) => cache.get(section.id),
    writeSection: async (section, result) => cache.set(section.id, result) };
  let fail = true;
  const called = [];
  const model = async (request) => {
    const input = JSON.parse(request.input[1].content);
    called.push(input.section.id);
    if (fail && input.section.id === "s2") {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("Model did not complete");
    }
    if (request.text.format.name === "privacy_evidence_check") return { analysis: review(input.claims) };
    const { sourceId, evidenceQuote, ...rest } = claim;
    return { analysis: { claims: [{ ...rest, evidenceStart: 0, evidenceEnd: 0 }], warnings: [] } };
  };
  await assert.rejects(() => analysis.analyzeSections(service, multiple, model, caching));
  assert.equal(cache.has("s1"), true);
  fail = false;
  called.length = 0;
  const result = await analysis.analyzeSections(service, multiple, model, caching);
  assert.ok(called.every((id) => id === "s2"));
  assert.equal(result.coverage.sectionsCompleted, 2);
  assert.equal(result.coverage.sectionCacheHits, 1);
});
