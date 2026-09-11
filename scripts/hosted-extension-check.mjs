import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.ok(process.env.DEMO_ACCESS_TOKEN, "Load .env.local before this check");
const directory = await mkdtemp(join(tmpdir(), "privacy-hosted-"));
const extension = resolve("dist/extension");
const requests = [];
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
  await page.locator("#analyze").click();
  await page.locator("#analysis-error").waitFor({ state: "visible", timeout: 65000 });
  const message = await page.locator("#analysis-error").textContent();
  assert.ok(message.includes("persistent budget storage"), message);
  assert.equal(await page.locator("#results").isVisible(), false);
  assert.deepEqual(requests, [{
    origin: "https://shiftsc-privacy-choices.vercel.app", path: "/api/analyze", fields: ["serviceId"]
  }]);
  await mkdir("output/qa", { recursive: true });
  await page.screenshot({ path: "output/qa/05-hosted-setup-needed.png", fullPage: true });
  await writeFile("output/qa/hosted-extension.json", JSON.stringify({
    passed: true, checkedAt: new Date().toISOString(), requests, status: "not_configured",
    evidenceBoundary: "Distributed extension loaded unchanged; actual hosted authentication and configuration failure verified. No model call and no fabricated findings."
  }, null, 2) + "\n");
  console.log("PASS: distributed extension reaches only the hosted analysis API and shows the real setup error; no fabricated findings.");
} finally {
  await context.close();
  await rm(directory, { recursive: true, force: true });
}
