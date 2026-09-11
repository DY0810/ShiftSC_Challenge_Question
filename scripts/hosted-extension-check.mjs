import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getService } from "../extension/catalog.js";

assert.ok(process.env.DEMO_ACCESS_TOKEN, "Load .env.local before this check");
const serviceIds = (process.env.SERVICE_IDS || "maps,quizlet,chatgpt").split(",");
assert.ok(serviceIds.length && serviceIds.every((id) => getService(id)), "Only catalog services may be checked");
const directory = await mkdtemp(join(tmpdir(), "privacy-hosted-"));
const extension = resolve("dist/extension");
const requests = [];
const results = [];
const context = await chromium.launchPersistentContext(directory, {
  channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
try {
  context.on("request", (request) => {
    if (request.url().startsWith("https://")) requests.push({
      origin: new URL(request.url()).origin, path: new URL(request.url()).pathname,
      fields: request.method() === "POST" ? Object.keys(request.postDataJSON() ?? {}) : []
    });
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate((accessToken) => chrome.storage.local.set({ accessToken }), process.env.DEMO_ACCESS_TOKEN);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await mkdir("output/qa", { recursive: true });
  assert.equal(requests.length, 0, "Opening the extension must not contact a company or backend");
  for (const serviceId of serviceIds) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator("#service-input").fill(getService(serviceId).name);
    await page.locator("#data-none").click();
    const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/analyze"), { timeout: 215000 });
    await page.locator("#analyze").click();
    const response = await responsePromise;
    const body = await response.json();
    assert.equal(response.status(), 200, `${serviceId}: ${body.error?.code}`);
    assert.equal(body.serviceId, serviceId);
    assert.notEqual(body.mode, "fixture");
    await page.locator("#results").waitFor({ state: "visible" });
    const conflicts = await page.locator("#findings-list .badge.mismatch").count();
    assert.ok(conflicts > 0, "None must show actual policy conflicts");
    await page.screenshot({ path: `output/qa/live-${serviceId}-desktop.png`, fullPage: true });
    await page.locator("#find-reductions").click();
    const guide = page.locator(serviceId === "chatgpt" ? "#report-chatgpt-training" : "#report-quizlet-cookies");
    if (serviceId !== "maps") {
      await guide.check();
      assert.equal(await page.locator("#findings-list .badge.mismatch").count(), conflicts,
        "User-reported account changes must not remove conflicts");
    }
    await page.locator("#review-decision").click();
    assert.equal(await page.locator("#visit-service").isDisabled(), true);
    await page.locator("#acknowledge").check();
    assert.equal(await page.locator("#visit-service").isEnabled(), true);
    await page.locator("#do-not-visit").click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `output/qa/live-${serviceId}-narrow.png`, fullPage: true });
    results.push({ serviceId, claims: body.claims.length, conflicts, mode: body.mode, cached: body.usage?.cached });
  }
  assert.equal(requests.length, serviceIds.length);
  assert.ok(requests.every((request) => request.origin === "https://shiftsc-privacy-choices.vercel.app" &&
    request.path === "/api/analyze" && JSON.stringify(request.fields) === '["serviceId"]'));
  const report = { passed: true, checkedAt: new Date().toISOString(), requests, results,
    evidenceBoundary: "Unchanged distributed extension and actual hosted model responses. Only listed services checked. No company visit, no automatic account-setting proof, and no claim of exhaustive or semantically infallible analysis." };
  await writeFile("output/qa/hosted-extension.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await rm(directory, { recursive: true, force: true });
}
