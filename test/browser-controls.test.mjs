import test from "node:test";
import assert from "node:assert/strict";
import { readBrowserState, blockLocation, restoreLocation, LOCATION_PATTERN } from "../extension/browser.js";
import { classifyClaims } from "../extension/core.js";

function browser({ granted = true, approve = true, baseline = "ask", effective, failure } = {}) {
  const calls = [];
  let rule = null;
  const api = {
    runtime: {},
    permissions: {
      contains(details, done) { calls.push(["contains", details]); done(granted); },
      request(details, done) { calls.push(["request", details]); granted = approve; done(approve); }
    },
    contentSettings: {
      // Chrome's ContentSetting property is "location", not "geolocation".
      // https://developer.chrome.com/docs/extensions/reference/api/contentSettings#property-location
      location: Object.fromEntries(["get", "set", "clear"].map((method) => [method, (details, done) => {
        calls.push([method, details]);
        if (failure === method) {
          api.runtime.lastError = { message: `${method} failed` };
          done();
          delete api.runtime.lastError;
          return;
        }
        if (method === "set") rule = details.setting;
        if (method === "clear") rule = null;
        done(method === "get" ? { setting: effective ?? rule ?? baseline } : undefined);
      }]))
    }
  };
  return { api, calls };
}

test("reading without permission neither prompts nor changes browser settings", async () => {
  const { api, calls } = browser({ granted: false });
  const state = await readBrowserState(api);
  assert.equal(state.locationBlocked, false);
  assert.equal(state.verifiedAt, null);
  assert.equal(state.permissionGranted, false);
  assert.deepEqual(calls.map(([name]) => name), ["contains"]);
});

test("blocking requests permission in the calling gesture and verifies the exact effective setting", async () => {
  const { api, calls } = browser({ granted: false });
  const pending = blockLocation("maps", api);
  assert.equal(calls[0][0], "request");
  const state = await pending;
  assert.equal(state.locationBlocked, true);
  assert.ok(Date.now() - Date.parse(state.verifiedAt) < 1000);
  assert.deepEqual(calls.find(([name]) => name === "set")[1], {
    primaryPattern: "https://www.google.com/*", setting: "block", scope: "regular"
  });
  assert.equal(LOCATION_PATTERN, "https://www.google.com/*");
  assert.deepEqual(calls.find(([name]) => name === "get")[1], {
    primaryUrl: "https://www.google.com/maps",
    secondaryUrl: "https://www.google.com/maps",
    incognito: false
  });
});

test("no permission grant or non-Maps service can set a rule", async () => {
  const denied = browser({ granted: false, approve: false });
  await assert.rejects(blockLocation("maps", denied.api), /permission/i);
  assert.equal(denied.calls.some(([name]) => name === "set"), false);
  for (const id of ["quizlet", "chatgpt", "https://www.google.com/maps", null]) {
    const other = browser();
    await assert.rejects(blockLocation(id, other.api), /Maps/);
    assert.deepEqual(other.calls, []);
  }
});

test("a successful set is not proof when effective read-back is not blocked", async () => {
  const { api } = browser({ effective: "ask" });
  const state = await blockLocation("maps", api);
  assert.equal(state.locationBlocked, false);
  assert.equal(state.setting, "ask");
});

test("restore clears only this extension's regular geolocation rules and never sets allow", async () => {
  const { api, calls } = browser({ baseline: "block" });
  await blockLocation("maps", api);
  calls.length = 0;
  const state = await restoreLocation(api);
  assert.deepEqual(calls.find(([name]) => name === "clear")[1], { scope: "regular" });
  assert.equal(calls.some(([name]) => name === "request" || name === "set"), false);
  assert.equal(state.locationBlocked, true, "the user's pre-existing block remains effective");
  assert.equal(calls.at(-1)[0], "get");
});

test("reads are fresh; permission removal and stale verification cannot resolve claims", async () => {
  const { api } = browser();
  const blocked = await blockLocation("maps", api);
  const claims = [{ id: "location", dataCategory: "browser_location", purposes: ["essential"] }];
  assert.equal(classifyClaims(claims, {}, blocked, "maps")[0].status, "browser-verified");
  const restored = await restoreLocation(api);
  assert.equal(restored.locationBlocked, false);
  assert.equal(classifyClaims(claims, {}, restored, "maps")[0].status, "mismatch");
  assert.equal(classifyClaims(claims, {}, { ...blocked, verifiedAt: new Date(Date.now() - 60_001).toISOString() }, "maps")[0].status, "mismatch");
  api.permissions.contains = (_details, done) => done(false);
  assert.equal((await readBrowserState(api)).verifiedAt, null);
});

test("missing APIs and read failures are unverified; write and restore failures surface", async () => {
  for (const api of [undefined, {}, browser({ failure: "get" }).api]) {
    const state = await readBrowserState(api);
    assert.equal(state.locationBlocked, false);
    assert.equal(state.verifiedAt, null);
    assert.ok(state.error);
  }
  await assert.rejects(blockLocation("maps", browser({ failure: "set" }).api), /set failed/);
  await assert.rejects(restoreLocation(browser({ failure: "clear" }).api), /clear failed/);
  const denied = browser({ granted: false });
  await assert.rejects(restoreLocation(denied.api), /permission/i);
  assert.equal(denied.calls.some(([name]) => name === "clear" || name === "request"), false);
});
