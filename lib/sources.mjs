import { load } from "cheerio";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const normalizeText = (text) => text.normalize("NFKC").replace(/\s+/g, " ").trim();
export const hashText = (text) => createHash("sha256").update(text).digest("hex");

export function extractText(body, contentType = "") {
  if (/^Warning:/im.test(body.slice(0, 2500))) throw new Error("Reader reports incomplete or uncertain source content");
  if (contentType.includes("html") || /^\s*<!doctype|^\s*<html/i.test(body)) {
    const $ = load(body);
    $("script,style,noscript,nav,header,footer,iframe,svg,form").remove();
    $("p,li,div,h1,h2,h3,h4,section,br").append("\n");
    const main = $("main").first();
    return normalizeText(main.length && main.text().length > 650 ? main.text() : $("body").text());
  }
  const start = body.indexOf("Markdown Content:");
  return normalizeText(start >= 0 ? body.slice(start + 17) : body);
}

export function isPolicyText(text, source) {
  if (typeof text !== "string" || text.length < 650 || text.length > 200_000) return false;
  if (/just a moment|one more step|verify (?:that )?you are human|security system for this website|enable javascript and cookies/i.test(text.slice(0, 1500))) return false;
  // Known reader omission: the OpenAI page can lose its disclosure/contact sections.
  // A changed document structure needs review rather than silent partial coverage.
  if (source?.id === "openai-privacy" &&
      ![/9\.\s+Additional U\.S\. state disclosures/i, /12\.\s+How to contact us/i, /13\.\s+Useful resources/i]
        .every((section) => section.test(text))) return false;
  return /privacy|personal (?:data|information)|data controls/i.test(text) &&
    /collect|information|conversations|location/i.test(text) && Boolean(source?.id);
}

export async function readLimited(response, maximum = 1_048_576) {
  if (Number(response.headers.get("content-length")) > maximum) throw new Error("Source too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("Source too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readSnapshot(source) {
  try {
    return JSON.parse(await readFile(new URL(`../data/snapshots/${source.id}.json`, import.meta.url), "utf8"));
  } catch { return null; }
}

async function fetchDocument(url, fetchImpl, headers = {}) {
  const origin = new URL(url).origin;
  let next = url;
  const signal = AbortSignal.timeout(12_000);
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetchImpl(next, {
      redirect: "manual", signal, headers: { Accept: "text/html,text/plain", ...headers }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Missing redirect target");
      const redirected = new URL(location, next);
      if (redirected.origin !== origin || redirected.username || redirected.password) throw new Error("Unapproved redirect");
      next = redirected.href;
      continue;
    }
    if (response.status !== 200) { await response.body?.cancel(); throw new Error("Source request failed or partial"); }
    return extractText(await readLimited(response), response.headers.get("content-type") ?? "");
  }
  throw new Error("Too many redirects");
}

export async function retrieveSource(source, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  for (const method of ["direct", "reader"]) {
    try {
      const headers = method === "reader" ? { "X-No-Cache": "true" } : {};
      const text = await fetchDocument(method === "reader" ? `https://r.jina.ai/${source.url}` : source.url, fetchImpl, headers);
      if (!isPolicyText(text, source)) continue;
      return { ...source, text, method, status: "available", hash: hashText(text),
        retrievedAt: new Date().toISOString(), capturedAt: null };
    } catch { /* A denied source is missing evidence, not a privacy judgment. */ }
  }
  try {
    const snapshot = await (options.readSnapshot ?? readSnapshot)(source);
    const time = Date.parse(snapshot?.capturedAt);
    const text = typeof snapshot?.text === "string" ? normalizeText(snapshot.text) : "";
    if (snapshot?.id === source.id && snapshot.url === source.url &&
        Number.isFinite(time) && time <= Date.now() && isPolicyText(text, source)) {
      return { ...source, text, method: "snapshot", status: "available",
        hash: hashText(text), retrievedAt: null, capturedAt: snapshot.capturedAt };
    }
  } catch { /* Corrupt or unavailable snapshots cannot support an explanation. */ }
  return { ...source, text: "", method: null, status: "unavailable", hash: null, retrievedAt: null, capturedAt: null };
}
