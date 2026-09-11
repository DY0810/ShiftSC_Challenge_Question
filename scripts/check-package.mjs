import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = "dist/extension";
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ["storage"]);
assert.deepEqual(manifest.optional_permissions, ["contentSettings"]);
assert.equal(manifest.host_permissions.length, 1);
assert.ok(!manifest.host_permissions.includes("<all_urls>"));
const content = await readFile(join(root, "config.js"), "utf8");
const configured = content.match(/API_BASE\s*=\s*"([^"]+)"/)?.[1];
assert.ok(configured && manifest.host_permissions[0] === `${configured}/*`);
assert.ok(manifest.content_security_policy.extension_pages.includes(`connect-src ${configured};`));
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else files.push(file);
  }
}
await walk(root);
for (const file of files) {
  assert.ok(!/(?:^|\/)(?:\.env|node_modules|data|test|\.vercel|output)(?:[./]|$)/.test(file), `Unexpected file: ${file}`);
  if (file.endsWith(".png")) continue;
  if (file.endsWith(".woff2")) {
    assert.equal((await readFile(file)).subarray(0, 4).toString(), "wOF2", `Invalid font: ${file}`);
    continue;
  }
  const text = await readFile(file, "utf8");
  assert.ok(!/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/.test(text), `Potential API credential in ${file}`);
  assert.ok(!/UPSTASH_REDIS_REST_TOKEN\s*=|DEMO_ACCESS_TOKEN\s*=/.test(text), `Potential backend configuration in ${file}`);
  if (file.endsWith(".js")) execFileSync(process.execPath, ["--check", file]);
}
assert.ok(files.some((file) => file.endsWith("icons/icon-128.png")));
execFileSync("unzip", ["-t", "dist/privacy-choices-extension.zip"], { stdio: "pipe" });
console.log(`PASS: ${files.length} package files, one backend origin, optional browser permission, syntax and ZIP integrity, no detected credential patterns.`);
