import test from "node:test";
import assert from "node:assert/strict";
import { resolveService, classifyClaims, normalizePreferences } from "../extension/core.js";

test("service matching accepts supported names and HTTPS URLs without trusting lookalike hosts", () => {
  for (const [input, expected] of [
    [" Google Maps ", "maps"], ["https://www.google.com/maps/place/USC", "maps"],
    ["maps.google.com", "maps"], ["quizlet.com/123/test", "quizlet"],
    ["CHATGPT", "chatgpt"], ["https://chatgpt.com/c/private", "chatgpt"],
    ["https://quizlet.com.attacker.test", null], ["https://attacker.test/quizlet.com", null],
    ["https://user@quizlet.com", null], ["javascript:alert(1)", null],
    ["http://chatgpt.com", null], ["https://www.google.com/search?q=x", null],
    ["https://chatgpt.com:8443", null], ["localhost", null], ["", null]
  ]) assert.equal(resolveService(input)?.id ?? null, expected, input);
});

test("verified geolocation does not erase approximate location, content, or training mismatches", () => {
  const claims = [
    { id: "browser", dataCategory: "browser_location", purposes: ["essential"] },
    { id: "ip", dataCategory: "approximate_location", purposes: ["essential"] },
    { id: "content", dataCategory: "content", purposes: ["training"] }
  ];
  const result = classifyClaims(claims, { allowedData: [], allowedPurposes: [] },
    { locationBlocked: true, verifiedAt: new Date().toISOString() }, "maps");
  assert.deepEqual(result.map((claim) => [claim.id, claim.status]), [
    ["browser", "browser-verified"], ["ip", "mismatch"], ["content", "mismatch"]
  ]);
});

test("allowing content is not permission to use it for model training", () => {
  const claims = [{ id: "c", dataCategory: "content", purposes: ["essential", "training"] }];
  assert.equal(classifyClaims(claims, { allowedData: ["content"], allowedPurposes: [] }, {}, "chatgpt")[0].status, "mismatch");
  assert.equal(classifyClaims(claims, { allowedData: ["content"], allowedPurposes: ["training"] }, {}, "chatgpt")[0].status, "within-preferences");
});

test("stale verification and verification for a different service cannot resolve a claim", () => {
  const claims = [{ id: "gps", dataCategory: "browser_location", purposes: ["essential"] }];
  const prefs = { allowedData: [], allowedPurposes: [] };
  assert.equal(classifyClaims(claims, prefs, { locationBlocked: true }, "maps")[0].status, "mismatch");
  assert.equal(classifyClaims(claims, prefs, { locationBlocked: true, verifiedAt: "2020-01-01" }, "maps")[0].status, "mismatch");
  assert.equal(classifyClaims(claims, prefs, { locationBlocked: true, verifiedAt: new Date().toISOString() }, "chatgpt")[0].status, "mismatch");
});

test("stored preferences reject unknown categories and malformed values", () => {
  assert.deepEqual(normalizePreferences({ allowedData: ["content", "content", "magic"], allowedPurposes: ["training", "evil"] }),
    { allowedData: ["content"], allowedPurposes: ["training"] });
  assert.deepEqual(normalizePreferences(null), { allowedData: [], allowedPurposes: [] });
});

test("a current location block does not verify that previously acquired location stops being used for ads", () => {
  const result = classifyClaims([{ id: "gps-ads", dataCategory: "browser_location", purposes: ["advertising"] }],
    { allowedData: [], allowedPurposes: [] }, { locationBlocked: true, verifiedAt: new Date().toISOString() }, "maps");
  assert.equal(result[0].status, "mismatch");
  assert.equal(result[0].acquisitionBlocked, true);
  assert.equal(result[0].disallowedData, false);
  assert.deepEqual(result[0].disallowedPurposes, ["advertising"]);
});
