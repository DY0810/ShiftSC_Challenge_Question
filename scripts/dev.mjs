import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import handler from "../api/analyze.mjs";

const basePort = Number(process.env.PORT || 4317);
const root = resolve("extension");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (value) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
  try {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    if (path === "/api/analyze") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 512) {
          res.status(413).json({ error: { code: "too_large", message: "Request too large." } });
          return;
        }
      }
      req.body = body;
      await handler(req, res);
      return;
    }
    try {
      const file = resolve(root, "." + decodeURIComponent(path === "/" ? "/index.html" : path));
      if (!file.startsWith(root + "/")) throw new Error();
      res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(await readFile(file));
    } catch { res.statusCode = 404; res.end("Not found"); }
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) { res.destroy(); return; }
    const invalidUrl = error.code === "ERR_INVALID_URL";
    res.status(invalidUrl ? 400 : 500).json({ error: {
      code: invalidUrl ? "invalid_request" : "server_error",
      message: invalidUrl ? "Invalid request URL." : "Analysis unavailable."
    } });
  }
});
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${basePort} is busy. Set PORT to a free port and match the development extension configuration.`);
  } else console.error(error.code);
  process.exitCode = 1;
});
server.listen(basePort, "127.0.0.1", () => console.log(`Privacy Choices: http://127.0.0.1:${basePort}`));
