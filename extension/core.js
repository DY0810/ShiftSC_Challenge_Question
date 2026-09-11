import { SERVICES, DATA_CATEGORIES, PURPOSES } from "./catalog.js";

export function resolveService(input) {
  if (typeof input !== "string" || input.length > 2048) return null;
  const value = input.trim().toLowerCase();
  const alias = SERVICES.find((service) => service.aliases.includes(value));
  if (alias) return alias;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (["google.com", "www.google.com"].includes(url.hostname) &&
        (url.pathname === "/maps" || url.pathname.startsWith("/maps/"))) return SERVICES[0];
    if (url.hostname === "maps.google.com") return SERVICES[0];
    if (["quizlet.com", "www.quizlet.com"].includes(url.hostname)) return SERVICES[1];
    if (["chatgpt.com", "www.chatgpt.com", "chat.openai.com"].includes(url.hostname)) return SERVICES[2];
  } catch { /* Unrecognized input stays local. */ }
  return null;
}

export function normalizePreferences(value) {
  const valid = (items, options) => [...new Set(Array.isArray(items) ? items : [])]
    .filter((item) => options.some((option) => option.id === item));
  return {
    allowedData: valid(value?.allowedData, DATA_CATEGORIES),
    allowedPurposes: valid(value?.allowedPurposes, PURPOSES)
  };
}

export function classifyClaims(claims, preferences, browserState = {}, serviceId) {
  const prefs = normalizePreferences(preferences);
  const age = Date.now() - Date.parse(browserState.verifiedAt);
  const locationVerified = serviceId === "maps" && browserState.locationBlocked === true &&
    Number.isFinite(age) && age >= 0 && age < 60_000;
  return claims.map((claim) => {
    const acquisitionBlocked = claim.dataCategory === "browser_location" && locationVerified;
    const disallowedData = !acquisitionBlocked && !prefs.allowedData.includes(claim.dataCategory);
    const disallowedPurposes = (claim.purposes ?? [])
      .filter((purpose) => purpose !== "essential" && !prefs.allowedPurposes.includes(purpose));
    const purposeUnknown = !claim.purposes?.length;
    const status = disallowedData || disallowedPurposes.length || purposeUnknown ? "mismatch"
      : acquisitionBlocked ? "browser-verified" : "within-preferences";
    return { ...claim, status, disallowedData, disallowedPurposes, acquisitionBlocked, purposeUnknown };
  });
}
