import { randomBytes } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";

let text;
try { text = await readFile(".env.local", "utf8"); }
catch { text = await readFile(".env.example", "utf8"); }
const match = text.match(/^DEMO_ACCESS_TOKEN=(.*)$/m);
if (!match || !match[1].trim()) {
  const entry = `DEMO_ACCESS_TOKEN=${randomBytes(32).toString("base64url")}`;
  text = match ? text.replace(/^DEMO_ACCESS_TOKEN=.*$/m, entry) : text + `\n${entry}\n`;
  await writeFile(".env.local", text, { mode: 0o600 });
}
await chmod(".env.local", 0o600);
console.log("Private demo token is in .env.local. Its value was not printed. Add provider credentials there; never package this file.");
