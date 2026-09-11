import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { SERVICES } from "../extension/catalog.js";

const token = "fixture-only-access-token-not-a-real-secret";
const requests = [];
const errors = [];
const checks = [];
let responseMode = "fixture";
let releaseResponse;
const fixture = (serviceId) => {
  const service = SERVICES.find((entry) => entry.id === serviceId);
  const definitions = serviceId === "maps" ? [
    ["location", "browser_location", "Browser location", ["essential"]],
    ["ip", "approximate_location", "Approximate IP location", ["essential"]],
    ["typed", "content", "Typed starting points", ["essential"]],
    ["usage", "activity", "Usage analytics", ["analytics"]]
  ] : [
    ["content", "content", serviceId === "chatgpt" ? "Submitted conversations" : "Study activity", ["essential", serviceId === "chatgpt" ? "training" : "analytics"]],
    ["ids", "identifiers", "Device identifiers", ["essential"]]
  ];
  return {
    serviceId, analyzedAt: new Date().toISOString(), mode: responseMode === "mixed" ? "mixed" : "fixture",
    claims: definitions.map(([id, dataCategory, label, purposes]) => ({
      id, dataCategory, label, purposes,
      summary: "Synthetic test finding used to exercise the preference comparison. This is not a live policy assertion.",
      condition: "Synthetic test scenario; actual practices require verified policy evidence.",
      retention: "Not assessed by this fixture.", sourceId: service.sources[0].id,
      evidenceQuote: "Synthetic fixture text, not a quotation from this company."
    })),
    sources: service.sources.map((source, index) => ({
      ...source, method: responseMode === "mixed" && index > 0 ? null : "snapshot",
      status: responseMode === "mixed" && index > 0 ? "unavailable" : "available",
      capturedAt: "2026-09-01T00:00:00.000Z", retrievedAt: null, hash: "test-fixture-not-a-live-evidence-hash"
    })),
    warnings: ["Synthetic integration fixture. No live model call or account-setting verification occurred."],
    usage: { cached: true, estimatedCostUsd: 0 }
  };
};

const server = createServer(async (req, res) => {
  let body = "";
  for await (const part of req) body += part;
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  if (req.url !== "/api/analyze") { res.writeHead(404).end(); return; }
  const data = JSON.parse(body);
  requests.push({ data, authorizationMatches: req.headers.authorization === `Bearer ${token}` });
  res.setHeader("Content-Type", "application/json");
  if (responseMode === "loading") await new Promise((resolveResponse) => { releaseResponse = resolveResponse; });
  if (responseMode === "error") {
    res.writeHead(503).end(JSON.stringify({ error: { code: "not_configured", message: "Live analysis requires credentials." } }));
  } else res.end(JSON.stringify(fixture(data.serviceId)));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const api = `http://127.0.0.1:${server.address().port}`;
const directory = await mkdtemp(join(tmpdir(), "privacy-e2e-"));
const output = resolve("output/qa");
await mkdir(output, { recursive: true });
let context;
let id;
const external = [];

async function launch(granted) {
  const extension = join(directory, granted ? "granted-extension" : "production-extension");
  await cp("extension", extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, "manifest.json"), "utf8"));
  manifest.host_permissions = [`${api}/*`];
  manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace(/connect-src [^;]+/, `connect-src ${api}`);
  if (granted) {
    manifest.permissions.push("contentSettings");
    manifest.optional_permissions = [];
  }
  await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(extension, "config.js"), `export const API_BASE = ${JSON.stringify(api)};\n`);
  context = await chromium.launchPersistentContext(join(directory, granted ? "granted-profile" : "production-profile"), {
    channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http") && !url.startsWith(api + "/")) {
      external.push(url);
      if (route.request().resourceType() === "document") {
        await route.fulfill({ contentType: "text/html", body: "<h1>External navigation intercepted by browser test</h1>" });
      } else await route.abort("blockedbyclient");
    } else await route.continue();
  });
  context.on("page", (page) => page.on("pageerror", (error) => {
    if (page.url().startsWith("chrome-extension://")) errors.push(error.message);
  }));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  id = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/index.html`);
  await page.waitForFunction(() => !document.getElementById("analyze").disabled);
  return page;
}

async function configure(page) {
  await page.locator("#settings-button").click();
  await page.locator("#settings-dialog").screenshot({ path: join(output, "settings-detail.png") });
  await page.locator("#token-input").fill(token);
  await page.locator("#save-token").click();
  await page.locator("#settings-status").getByText("Access token saved locally.", { exact: false }).waitFor();
  await page.locator("#close-settings").click();
}

async function analyze(page, service = "Google Maps") {
  await page.locator("#service-input").fill(service);
  await page.locator("#analyze").click();
  await page.locator("#results").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.getElementById("review-decision").disabled);
}

try {
  let page = await launch(false);
  await page.evaluate(() => document.fonts.ready);
  assert.ok(await page.evaluate(() => document.fonts.check("14px Geist") &&
    getComputedStyle(document.body).fontFamily.includes("Geist")), "The bundled Geist font must render, not a fallback");
  assert.ok(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize) >= 14),
    "Chrome's extension stylesheet must not shrink the base text below 14px");
  assert.ok(await page.locator("img").evaluateAll((images) =>
    images.every((image) => image.complete && image.naturalWidth > 0)), "All bundled images must decode");
  assert.equal(await page.evaluate(() => chrome.permissions.contains({ permissions: ["contentSettings"] })), false);
  assert.equal(external.length, 0);
  await page.screenshot({ path: join(output, "00-start-desktop.png"), fullPage: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `horizontal overflow at ${width}`);
    if (width <= 390) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const lookup = await page.locator("#service-input").boundingBox();
      const prefs = await page.locator(".preferences").boundingBox();
      assert.ok(lookup.y + lookup.height < 844, "Mobile service lookup must be in the first viewport");
      assert.ok(lookup.y < prefs.y, "Service lookup must come before preferences on mobile");
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, "00-start-narrow.png"), fullPage: true });
  checks.push("Production manifest loads without contentSettings permission; no initial external requests; no horizontal overflow at 320/390/768/1440px.");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(output, "00-start-viewport.png") });
  await page.locator(".service-main").screenshot({ path: join(output, "lookup-detail.png") });
  await page.locator("#data-all").click();
  assert.equal(await page.locator("#empty-preferences").textContent(), "8 of 8 types");
  await page.locator("#data-none").click();
  await configure(page);
  responseMode = "loading";
  await page.locator("#analyze").click();
  await page.locator("#loading-state").waitFor({ state: "visible" });
  assert.equal(await page.locator(".loading-skeleton > div").count(), 6);
  await page.locator("#loading-state").screenshot({ path: join(output, "loading-detail.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.ok(await page.locator(".loading-skeleton > div").evaluateAll((items) =>
    items.every((item) => getComputedStyle(item).animationName === "none")));
  responseMode = "error";
  releaseResponse();
  await page.locator("#analysis-error").waitFor({ state: "visible" });
  assert.equal(await page.locator("#results").isVisible(), false);
  await page.locator("#analysis-error").screenshot({ path: join(output, "error-detail.png") });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  responseMode = "mixed";
  await analyze(page);
  assert.equal(await page.locator("#analysis-mode").textContent(), "Mixed sources");
  assert.ok((await page.locator("#sources-list").textContent()).includes("Unavailable"));
  checks.push("Backend failure is visible; valid mixed results retain the unavailable-source warning.");
  await context.close();

  responseMode = "fixture";
  page = await launch(true);
  await configure(page);
  await analyze(page, "https://www.google.com/maps?private-query=never-send-this");
  assert.equal(await page.locator("#findings-list .badge.mismatch").count(), 4);
  assert.equal(await page.locator("#fixture-banner").isVisible(), true);
  assert.equal(external.length, 0);
  assert.ok(requests.every((entry) => entry.authorizationMatches && Object.keys(entry.data).join(",") === "serviceId"));
  assert.ok(!JSON.stringify(requests).includes("private-query"));
  const evidenceToggle = page.locator('[data-claim="location"] summary');
  await evidenceToggle.click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => !document.getElementById("review-decision").disabled);
  assert.equal(await page.locator('[data-claim="location"] details').getAttribute("open"), "");
  assert.ok(await evidenceToggle.evaluate((element) => document.activeElement === element),
    "Refreshing browser verification must preserve keyboard focus in expanded evidence");
  await page.locator('[data-claim="location"]').screenshot({ path: join(output, "expanded-evidence.png") });
  await evidenceToggle.click();
  await page.screenshot({ path: join(output, "01-findings-fixture-desktop.png"), fullPage: true });
  await page.locator("#find-reductions").click();
  await page.locator("#block-location").click();
  await page.locator("#confirm-proceed").click();
  await page.waitForFunction(() => document.getElementById("control-status").textContent.includes("read-back confirms"));
  await page.waitForFunction(() => document.querySelectorAll("#findings-list .badge.browser-verified").length === 1);
  const native = await page.evaluate(() => chrome.contentSettings.location.get({ primaryUrl: "https://www.google.com/maps" }));
  assert.equal(native.setting, "block");
  assert.equal(await page.locator("#findings-list .badge.mismatch").count(), 3);
  assert.ok((await page.locator('[data-claim="ip"]').textContent()).includes("Preference conflict"));
  assert.equal(external.length, 0);
  await page.locator("#findings-title").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "02-reduced-fixture-desktop.png"), fullPage: true });
  const resultsBox = await page.locator("#results").boundingBox();
  await page.screenshot({ path: join(output, "02-reduced-fixture-detail.png"), clip: {
    x: resultsBox.x, y: Math.max(0, resultsBox.y), width: resultsBox.width, height: Math.min(950, 1000 - Math.max(0, resultsBox.y))
  } });
  checks.push("Real Chrome location setting changes to block; exactly the browser-location fixture resolves; IP/content/activity remain mismatches.");

  await page.locator("#review-decision").click();
  assert.equal(await page.locator("#visit-service").isDisabled(), true);
  await page.locator("#do-not-visit").click();
  assert.equal(external.length, 0);
  await page.locator("#acknowledge").check();
  await page.locator("#decision").screenshot({ path: join(output, "03-decision-fixture-desktop.png") });
  await page.locator("#visit-service").click();
  await page.locator("#confirm-cancel").click();
  assert.equal(external.length, 0);
  await page.locator("#visit-service").click();
  const opened = context.waitForEvent("page");
  await page.locator("#confirm-proceed").click();
  const target = await opened;
  await target.waitForLoadState();
  assert.equal(target.url(), "https://www.google.com/maps");
  assert.ok(external.every((url) => new URL(url).hostname === "www.google.com"),
    `Unexpected external host after confirmed visit: ${JSON.stringify(external)}`);
  await target.close();
  checks.push("Do not visit and canceled confirmation make no company request. Acknowledgment plus confirmed visit opens the catalog destination; subsequent observed subresources are intercepted.");

  await page.locator("#restore-location").click();
  await page.locator("#confirm-proceed").click();
  await page.waitForFunction(() => document.getElementById("control-status").textContent.includes("Extension rule removed"));
  assert.equal((await page.evaluate(() => chrome.contentSettings.location.get({ primaryUrl: "https://www.google.com/maps" }))).setting, "ask");
  await analyze(page, "ChatGPT");
  assert.equal(await page.locator("#findings-list .badge.mismatch").count(), 2);
  await page.locator("#find-reductions").click();
  await page.locator("#report-chatgpt-training").check();
  assert.equal(await page.locator("#findings-list .badge.mismatch").count(), 2);
  assert.ok((await page.locator("#guide-status-chatgpt-training").textContent()).includes("Not independently verified"));
  await page.locator("#data-all").click();
  await page.waitForFunction(() => document.querySelectorAll("#findings-list .badge.mismatch").length === 1);
  await page.locator("#purpose-options > summary").click();
  await page.locator("#purpose-all").click();
  await page.waitForFunction(() => document.querySelectorAll("#findings-list .badge.mismatch").length === 0);
  assert.equal((await page.evaluate(() => chrome.contentSettings.location.get({ primaryUrl: "https://www.google.com/maps" }))).setting, "ask");
  checks.push("Restoration removes the extension rule without writing Allow. User-reported training change stays unresolved. All preferences never grant browser location.");

  await analyze(page, "Quizlet");
  await page.locator("#find-reductions").click();
  await page.locator("#report-quizlet-cookies").check();
  assert.ok((await page.locator("#guide-status-quizlet-cookies").textContent()).includes("unresolved"));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(output, "04-results-fixture-narrow.png"), fullPage: true });
  await page.locator("#service-input").fill("https://quizlet.com.attacker.test");
  assert.equal(await page.locator("#analyze").isDisabled(), true);
  checks.push("Quizlet guidance remains user-reported; unsupported lookalike domains cannot be analyzed; results fit a narrow viewport.");
  assert.deepEqual(errors, []);
  checks.push("Bundled Geist loads; lookup precedes preferences in the mobile first viewport; local counts update; evidence expansion and keyboard focus survive rechecks; loading respects reduced motion.");
  const report = {
    passed: true, checkedAt: new Date().toISOString(), browser: await context.browser()?.version(),
    checks, requestCount: requests.length, externalNavigationCount: external.length,
    evidenceBoundary: "Real Chromium extension and native content settings. Provider responses are explicitly synthetic fixtures. The granted-control test uses a temporary manifest with contentSettings pregranted; the shipped manifest keeps it optional. The explicitly confirmed Maps visit may contact Google from the isolated test profile; subsequent observed subresources are intercepted. No live model, account-setting, or tracking-prevention claim."
  };
  await writeFile(join(output, "browser.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (context) {
    const page = context.pages().find((item) => item.url().startsWith("chrome-extension://"));
    await page?.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await context?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(directory, { recursive: true, force: true });
}
