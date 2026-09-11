import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const raw = process.env.API_BASE || "http://127.0.0.1:4317";
const url = new URL(raw);
if ((url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
  throw new Error("API_BASE must be an HTTPS origin (or loopback origin for development)");
}
const api = url.origin;
const destination = resolve("dist/extension");
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp("extension", destination, { recursive: true });
const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
manifest.host_permissions = [`${api}/*`];
manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages
  .replace(/connect-src [^;]+/, `connect-src ${api}`);
await writeFile(join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(join(destination, "config.js"), `export const API_BASE = ${JSON.stringify(api)};\n`);
await writeFile(join(destination, "INSTALL.txt"), [
  "Privacy Choices - Chrome extension",
  "",
  "1. Extract this ZIP into a folder.",
  "2. Open chrome://extensions, enable Developer mode, choose Load unpacked.",
  "3. Select the extracted folder containing manifest.json.",
  "4. Open Privacy Choices from the browser toolbar and configure the private demo token.",
  `Backend: ${api}`,
  "",
  "The token is not an OpenAI API key. No credentials are bundled.",
  "Live analysis requires a configured backend. There is no fabricated fallback.",
  "Browser-geolocation protection is optional and covers all www.google.com pages.",
  "Use Restore extension rule to remove this extension's location override.",
  "Guided account changes remain unverified; this is not an anonymity tool.",
  ""
].join("\n"));
await rm("dist/privacy-choices-extension.zip", { force: true });
execFileSync("zip", ["-qr", "../privacy-choices-extension.zip", "."], { cwd: destination });
console.log(`Packaged dist/privacy-choices-extension.zip for ${api}. No provider credentials included.`);
