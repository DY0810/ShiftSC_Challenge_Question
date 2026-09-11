import { getService } from "./catalog.js";

export const LOCATION_PATTERN = "https://www.google.com/*";
const LOCATION_URL = getService("maps").homeUrl;

function invoke(api, area, method, details) {
  return new Promise((resolve, reject) => {
    area[method](details, (result) => {
      const error = api.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

export async function readBrowserState(api = globalThis.chrome) {
  const state = { locationBlocked: false, verifiedAt: null, permissionGranted: false, setting: null, error: null };
  try {
    if (!api?.permissions) throw new Error("Browser controls are unavailable. Open the installed Chrome extension.");
    state.permissionGranted = await invoke(api, api.permissions, "contains", { permissions: ["contentSettings"] });
    if (!state.permissionGranted) return state;
    const result = await invoke(api, api.contentSettings.location, "get", {
      primaryUrl: LOCATION_URL, secondaryUrl: LOCATION_URL, incognito: false
    });
    if (!["block", "ask", "allow"].includes(result?.setting)) throw new Error("Chrome did not return a recognized location setting.");
    state.setting = result.setting;
    state.locationBlocked = result.setting === "block";
    state.verifiedAt = new Date().toISOString();
  } catch (error) {
    state.error = error.message;
  }
  return state;
}

export async function blockLocation(serviceId, api = globalThis.chrome) {
  if (serviceId !== "maps") throw new Error("Only Google Maps has a supported browser control.");
  if (!api?.permissions) throw new Error("Browser controls require the installed Chrome extension.");
  // Request first: Chrome must receive this directly from the user's click.
  const granted = await invoke(api, api.permissions, "request", { permissions: ["contentSettings"] });
  if (!granted) throw new Error("Location-control permission was not granted. No rule was applied.");
  await invoke(api, api.contentSettings.location, "set", {
    primaryPattern: LOCATION_PATTERN, setting: "block", scope: "regular"
  });
  return readBrowserState(api);
}

export async function restoreLocation(api = globalThis.chrome) {
  if (!api?.permissions || !await invoke(api, api.permissions, "contains", { permissions: ["contentSettings"] })) {
    throw new Error("Location-control permission is unavailable. Nothing was changed.");
  }
  // clear is extension-scoped. This extension creates only one geolocation rule.
  await invoke(api, api.contentSettings.location, "clear", { scope: "regular" });
  return readBrowserState(api);
}
