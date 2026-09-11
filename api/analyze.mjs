import { analyzeRequest } from "../lib/service.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const origin = req.headers.origin;
  const allowed = !origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
    (process.env.VERCEL !== "1" && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
  if (!allowed) return res.status(403).json({ error: { code: "origin_denied", message: "This origin cannot use the private API." } });
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: { code: "method_not_allowed", message: "Use POST." } });
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    return res.status(415).json({ error: { code: "invalid_content_type", message: "Use application/json." } });
  }
  let body = req.body;
  try {
    if (Buffer.byteLength(typeof body === "string" ? body : JSON.stringify(body) ?? "") > 512) throw new Error();
    if (typeof body === "string") body = JSON.parse(body);
  } catch { return res.status(400).json({ error: { code: "invalid_request", message: "Invalid analysis request." } }); }
  const result = await analyzeRequest({ body, authorization: req.headers.authorization });
  return res.status(result.status).json(result.body);
}
