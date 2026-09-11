import { DATA_CATEGORIES, PURPOSES, SERVICES, emptyPreferences, getService } from "./catalog.js";
import { resolveService, normalizePreferences, classifyClaims } from "./core.js";
import { readBrowserState, blockLocation, restoreLocation, LOCATION_PATTERN } from "./browser.js";
import { API_BASE } from "./config.js";

const $ = (id) => document.getElementById(id);
const modes = { live: "Live sources", mixed: "Mixed sources", snapshot: "Dated snapshots", unavailable: "Evidence unavailable", fixture: "Fixture test response" };
const statusLabels = { mismatch: "Preference conflict", "browser-verified": "Browser-verified block", "within-preferences": "Within your preferences" };
let preferences = emptyPreferences();
let accessToken = "";
let storageReady = false;
let service = getService("maps");
let analysis = null;
let findings = [];
let browserState = { locationBlocked: false, verifiedAt: null };
let request = null;
let requestId = 0;
let refreshId = 0;
let refreshTimer;
let refreshing = false;
let controlBusy = false;
let decisionKey = "";
let pendingConfirmation = null;
let saveQueue = Promise.resolve();
const reportedGuides = new Set();

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function command(label, className, handler, icon) {
  const button = node("button", className, label);
  button.type = "button";
  button.addEventListener("click", handler);
  if (icon) {
    const image = node("img");
    image.src = `icons/${icon}.svg`;
    image.width = 15;
    image.height = 15;
    image.alt = "";
    button.append(image);
  }
  return button;
}

function message(id, text, error = false) {
  $(id).textContent = text;
  $(id).hidden = !text;
  $(id).classList.toggle("error", error);
}

function date(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not supplied";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function setStep(step) {
  for (const name of ["preferences", "findings", "reductions", "decision"]) {
    if (name === step) $(`step-${name}`).setAttribute("aria-current", "step");
    else $(`step-${name}`).removeAttribute("aria-current");
  }
}

function focusSection(id) {
  $(id).focus({ preventScroll: true });
  $(id).scrollIntoView({ behavior: "instant", block: "start" });
}

function resetAcknowledgment() {
  $("acknowledge").checked = false;
  updateButtons();
}

function updateButtons() {
  $("analyze").disabled = Boolean(request) || !storageReady || !service;
  $("analyze").firstChild.textContent = request ? "Analyzing..." : "Analyze policy";
  $("visit-service").disabled = !$("acknowledge").checked || !analysis || refreshing || controlBusy || Boolean(request);
  $("review-decision").disabled = refreshing || controlBusy;
  $("restore-location").disabled = !browserState.permissionGranted || controlBusy;
  const block = $("block-location");
  if (block) block.disabled = controlBusy || !globalThis.chrome?.permissions || browserState.locationBlocked;
}

function updateSetup() {
  $("setup-notice").hidden = storageReady && Boolean(accessToken);
  $("setup-message").textContent = !storageReady
    ? "Local extension storage is unavailable. Open this page in the installed Chrome extension."
    : "An access token is required for live analysis.";
  $("setup-button").disabled = !storageReady;
  $("save-token").disabled = !storageReady;
  $("remove-token").disabled = !storageReady || !accessToken;
  $("token-state").textContent = accessToken ? "A token is saved on this device. Enter a replacement to change it." : "No access token saved.";
  updateButtons();
}

function renderPreferences() {
  for (const [key, items, target] of [
    ["allowedData", DATA_CATEGORIES, "data-preferences"],
    ["allowedPurposes", PURPOSES, "purpose-preferences"]
  ]) {
    const children = items.map((item) => {
      const label = node("label", "choice");
      const input = node("input");
      input.type = "checkbox";
      input.id = `preference-${item.id}`;
      input.name = key;
      input.value = item.id;
      input.checked = preferences[key].includes(item.id);
      input.addEventListener("change", () => {
        preferences[key] = input.checked ? [...preferences[key], item.id] : preferences[key].filter((id) => id !== item.id);
        preferencesChanged();
      });
      const copy = node("span");
      copy.append(node("strong", "", item.label), node("small", "", item.hint));
      label.append(input, copy);
      return label;
    });
    $(target).replaceChildren(...children);
  }
  updatePreferenceCounts();
}

function updatePreferenceCounts() {
  $("data-count").textContent = `${preferences.allowedData.length} of ${DATA_CATEGORIES.length} selected`;
  $("purpose-count").textContent = `${preferences.allowedPurposes.length} of ${PURPOSES.length} selected`;
  $("purpose-preview").textContent = `${preferences.allowedPurposes.length} of ${PURPOSES.length}`;
  $("empty-preferences").textContent = `${preferences.allowedData.length} of ${DATA_CATEGORIES.length} types`;
}

function preferencesChanged() {
  updatePreferenceCounts();
  resetAcknowledgment();
  message("decision-status", "");
  const saved = normalizePreferences(preferences);
  if (storageReady) {
    $("storage-state").textContent = "Saving locally";
    saveQueue = saveQueue.then(() => chrome.storage.local.set({ preferences: saved })).then(() => {
      $("storage-state").textContent = "Preferences saved locally";
    }).catch(() => {
      $("storage-state").textContent = "Preferences not saved";
      message("app-notice", "Local storage could not save your preferences. Current selections are only in this page.");
    });
  }
  void refreshBrowser();
}

function chooseService(value) {
  const next = resolveService(value);
  $("service-input").setAttribute("aria-invalid", String(!next));
  message("service-message", next ? `${next.name} selected.`
    : "Enter Google Maps, Quizlet, or ChatGPT, or a supported HTTPS URL. This input stays local.", !next);
  for (const button of $("service-shortcuts").children) button.setAttribute("aria-pressed", String(button.dataset.service === next?.id));
  if (next?.id !== service?.id) {
    service = next;
    clearAnalysis();
  }
  $("empty-service").textContent = next?.name ?? "Not selected";
  updateButtons();
}

function clearAnalysis() {
  requestId += 1;
  request?.abort();
  request = null;
  analysis = null;
  findings = [];
  reportedGuides.clear();
  decisionKey = "";
  $("results").hidden = true;
  $("reductions").hidden = true;
  $("decision").hidden = true;
  $("loading-state").hidden = true;
  $("service-form").removeAttribute("aria-busy");
  $("empty-state").hidden = false;
  message("analysis-error", "");
  message("decision-status", "");
  resetAcknowledgment();
  setStep("preferences");
}

function validateAnalysis(value, selected) {
  const text = (item, limit = 12000) => typeof item === "string" && item.length <= limit;
  const sourceIds = new Set(selected.sources.map((source) => source.id));
  if (!value || value.serviceId !== selected.id || !Object.hasOwn(modes, value.mode) ||
      !Number.isFinite(Date.parse(value.analyzedAt)) || !Array.isArray(value.claims) || value.claims.length > 100 ||
      !Array.isArray(value.sources) || value.sources.length > selected.sources.length ||
      !Array.isArray(value.warnings) || value.warnings.length > 100 || !value.warnings.every((warning) => text(warning))) {
    throw new Error("The backend returned an invalid analysis. No findings have been displayed.");
  }
  const sources = new Map();
  for (const source of value.sources) {
    const trusted = selected.sources.find((item) => item.id === source?.id);
    if (!trusted || sources.has(source.id) || source.url !== trusted.url ||
        !["available", "unavailable"].includes(source.status) ||
        !(["direct", "reader", "snapshot"].includes(source.method) ||
          (source.status === "unavailable" && source.method === null))) {
      throw new Error("Source evidence could not be validated against the local catalog. No findings have been displayed.");
    }
    sources.set(source.id, source);
  }
  const claimIds = new Set();
  for (const claim of value.claims) {
    if (!claim || !text(claim.id, 200) || claimIds.has(claim.id) ||
        !DATA_CATEGORIES.some((item) => item.id === claim.dataCategory) ||
        !Array.isArray(claim.purposes) || !claim.purposes.every((purpose) => purpose === "essential" || PURPOSES.some((item) => item.id === purpose)) ||
        !text(claim.label, 500) || !text(claim.summary) || !text(claim.condition) || !text(claim.retention) ||
        !text(claim.evidenceQuote) || !claim.evidenceQuote.trim() ||
        !sourceIds.has(claim.sourceId) || sources.get(claim.sourceId)?.status !== "available") {
      throw new Error("A finding was missing valid categories or source evidence. No findings have been displayed.");
    }
    claimIds.add(claim.id);
  }
  if (value.mode === "unavailable" && value.claims.length) throw new Error("The backend returned findings marked as unavailable. This review cannot be validated.");
  return value;
}

async function analyze(event) {
  event.preventDefault();
  chooseService($("service-input").value);
  if (!service || request || !storageReady) return;
  if (!accessToken) {
    message("analysis-error", "No access token is saved. Configure analysis access before requesting a policy review.");
    openSettings();
    return;
  }
  const selected = service;
  clearAnalysis();
  const id = ++requestId;
  const controller = new AbortController();
  request = controller;
  $("empty-state").hidden = true;
  $("loading-state").hidden = false;
  $("service-form").setAttribute("aria-busy", "true");
  updateButtons();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 210_000);
  try {
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ serviceId: selected.id }),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });
    if (id !== requestId) return;
    const data = await response.json().catch(() => null);
    if (id !== requestId) return;
    if (!response.ok) {
      const reason = { 401: "Access token rejected. Update the saved token.", 403: "Access denied by the analysis backend.", 429: "The backend's usage or rate limit has been reached.", 503: "Analysis is unavailable. The backend may need setup or available source evidence." }[response.status];
      const detail = typeof data?.error?.message === "string" ? data.error.message.slice(0, 500) : "";
      throw new Error(`${reason || "The analysis request failed."} HTTP ${response.status}.${detail ? ` ${detail}` : ""}`);
    }
    analysis = validateAnalysis(data, selected);
    $("results").hidden = false;
    renderAnalysis();
    await refreshBrowser();
    if (id !== requestId) return;
    setStep("findings");
    focusSection("findings-title");
  } catch (error) {
    if (id !== requestId) return;
    analysis = null;
    $("results").hidden = true;
    const detail = controller.signal.aborted
      ? timedOut ? "The backend did not respond within 210 seconds. No findings were received." : "Lookup canceled. No findings were received."
      : error instanceof TypeError ? "The analysis backend could not be reached. No findings are available. Check the backend connection and setup."
        : error.message;
    message("analysis-error", detail, true);
    $("empty-state").hidden = false;
  } finally {
    clearTimeout(timeout);
    if (id === requestId) {
      request = null;
      $("loading-state").hidden = true;
      $("service-form").removeAttribute("aria-busy");
      updateButtons();
    }
  }
}

function sourceButton(source) {
  return command(source.title, "text-button source-button", () => confirmContact("source", source.id), "arrow-up-right");
}

function evidenceWarnings() {
  if (!analysis) return [];
  const warnings = [...analysis.warnings];
  if (analysis.mode === "fixture") warnings.unshift("Fixture response: synthetic test evidence, not a live review.");
  if (analysis.sources.some((source) => source.method === "snapshot")) warnings.push("Some or all evidence comes from dated snapshots. Policy wording and account controls may have changed since capture.");
  if (analysis.mode === "unavailable" || !analysis.claims.length) warnings.push("No supported findings were returned. This is an evidence gap, not proof that information is not collected.");
  for (const source of service.sources) {
    if (!analysis.sources.some((item) => item.id === source.id && item.status === "available")) warnings.push(`${source.title}: evidence unavailable for this review.`);
  }
  return [...new Set(warnings)];
}

function renderAnalysis() {
  $("analysis-service").textContent = service.name.toUpperCase();
  $("analysis-mode").textContent = modes[analysis.mode];
  $("analysis-mode").className = `badge ${analysis.mode === "unavailable" ? "unavailable" : ""}`;
  $("analysis-date").textContent = `Analyzed ${date(analysis.analyzedAt)}. US consumer policies, English.`;
  $("fixture-banner").hidden = analysis.mode !== "fixture";
  $("warnings").replaceChildren(...evidenceWarnings().map((warning) => node("p", "", warning)));
  $("sources-list").replaceChildren(...service.sources.map((trusted) => {
    const source = analysis.sources.find((item) => item.id === trusted.id);
    const row = node("div", "source-row");
    const copy = node("div");
    copy.append(sourceButton(trusted));
    const method = { direct: "Direct retrieval", reader: "Public reader", snapshot: "Dated snapshot" }[source?.method] ?? "No retrieval record";
    copy.append(node("p", "source-meta", `${method} | Retrieved: ${date(source?.retrievedAt)}`));
    if (source?.method === "snapshot" || source?.capturedAt) copy.append(node("p", "source-meta", `Captured: ${date(source.capturedAt)}`));
    if (typeof source?.hash === "string") copy.append(node("p", "source-hash", `Evidence hash: ${source.hash.slice(0, 128)}`));
    row.append(copy, node("span", `badge ${source?.status === "available" ? "" : "unavailable"}`, source?.status === "available" ? "Available" : "Unavailable"));
    return row;
  }));
}

function renderFindings() {
  const expanded = new Set([...document.querySelectorAll(".finding details[open]")]
    .map((element) => element.closest(".finding").dataset.claim));
  const focusedClaim = document.activeElement?.closest(".finding")?.dataset.claim;
  const focusedControl = document.activeElement?.matches("summary") ? "summary"
    : document.activeElement?.matches(".source-button") ? ".source-button" : null;
  const conflicts = findings.filter((claim) => claim.status === "mismatch").length;
  const verified = findings.filter((claim) => claim.status === "browser-verified").length;
  $("finding-summary").replaceChildren(...[
    [conflicts, "conflicts", "conflict-count"], [verified, "browser-verified", ""],
    [findings.length - conflicts - verified, "within preferences", ""]
  ].map(([count, label, className]) => {
    const item = node("span", className);
    item.append(node("strong", "", String(count)), document.createTextNode(label));
    return item;
  }));
  $("findings-list").replaceChildren(...findings.map((claim) => {
    const article = node("article", "finding");
    article.dataset.claim = claim.id;
    const heading = node("div", "finding-topline");
    heading.append(node("h3", "", claim.label), node("span", `badge ${claim.status}`,
      claim.purposeUnknown && !claim.disallowedData && !claim.disallowedPurposes.length ? "Unresolved purpose" : statusLabels[claim.status]));
    article.append(heading, node("p", "", claim.summary));
    if (claim.acquisitionBlocked && claim.status === "mismatch") {
      article.append(node("p", "verified-note", "New browser-geolocation access is blocked. The use of previously acquired information is not verified and remains a conflict."));
    }
    if (claim.status === "mismatch") {
      const reasons = [];
      if (claim.disallowedData) reasons.push(`${DATA_CATEGORIES.find((item) => item.id === claim.dataCategory).label} is not selected as acceptable`);
      if (claim.disallowedPurposes.length) reasons.push(`Unaccepted uses: ${claim.disallowedPurposes.map((id) => PURPOSES.find((item) => item.id === id).label).join(", ")}`);
      if (claim.purposeUnknown) reasons.push("The purpose is not established by the cited evidence and remains unresolved");
      article.append(node("p", "reason", reasons.join(". ") + "."));
    } else if (claim.status === "browser-verified") {
      article.append(node("p", "verified-note", "Chrome reports browser geolocation blocked for www.google.com. IP-derived locations, typed places, and other collection are not blocked."));
    } else {
      article.append(node("p", "muted", "Matches your selected preferences. This does not mean no collection or tracking."));
    }
    const details = node("dl");
    for (const [label, value] of [
      ["Data type", DATA_CATEGORIES.find((item) => item.id === claim.dataCategory).label],
      ["Uses", claim.purposes.map((id) => id === "essential" ? "Essential service operation" : PURPOSES.find((item) => item.id === id).label).join(", ") || "Not specified"],
      ["Conditions", claim.condition || "Not specified in this finding"],
      ["Retention", claim.retention || "Not specified in this finding"]
    ]) details.append(node("dt", "", label), node("dd", "", value));
    const evidence = node("details");
    evidence.open = expanded.has(claim.id);
    evidence.append(node("summary", "", "Details & policy evidence"),
      node("p", "interpretation-note", "AI interpretation of a company disclosure. Semantic accuracy is not independently verified."),
      details, node("blockquote", "", claim.evidenceQuote),
      sourceButton(service.sources.find((item) => item.id === claim.sourceId)));
    article.append(evidence);
    return article;
  }));
  if (focusedClaim && focusedControl) {
    [...$("findings-list").children].find((article) => article.dataset.claim === focusedClaim)
      ?.querySelector(focusedControl)?.focus({ preventScroll: true });
  }
}

function renderBrowserStatus() {
  $("browser-status").textContent = browserState.error ? `Unverified: ${browserState.error}`
    : !browserState.permissionGranted ? "Not verified. Optional browser-control permission has not been granted."
      : `${browserState.locationBlocked ? "Effective setting: blocked" : `Effective setting: ${browserState.setting}`}. Checked ${date(browserState.verifiedAt)}.`;
  updateButtons();
}

async function refreshBrowser() {
  const id = ++refreshId;
  clearTimeout(refreshTimer);
  refreshing = true;
  $("verification-pending").hidden = !analysis;
  for (const badge of document.querySelectorAll(".badge.browser-verified")) badge.textContent = "Verification pending";
  if (analysis) $("finding-summary").textContent = "Checking the effective browser control...";
  updateButtons();
  const state = await readBrowserState();
  if (id !== refreshId) return;
  browserState = state;
  refreshing = false;
  $("verification-pending").hidden = true;
  renderBrowserStatus();
  if (analysis) {
    findings = classifyClaims(analysis.claims, preferences, browserState, service.id);
    const nextKey = JSON.stringify([findings.map((claim) => [claim.id, claim.status, claim.disallowedData, claim.disallowedPurposes]), preferences, browserState.locationBlocked, browserState.error, [...reportedGuides].sort()]);
    if (decisionKey && decisionKey !== nextKey) {
      resetAcknowledgment();
      if (!$("decision").hidden) message("decision-status", "This review changed. Read the remaining risks and acknowledge them again.");
    }
    decisionKey = nextKey;
    renderFindings();
    updateActionState();
    renderDecision();
  }
  // Re-read before the classifier's 60-second verification window expires.
  refreshTimer = setTimeout(() => void refreshBrowser(), 55_000);
  updateButtons();
}

function renderActions() {
  $("actions-list").replaceChildren(...service.actions.map((action) => {
    const row = node("article", "action-row");
    row.append(node("span", "badge", action.kind === "browser" ? "Browser control" : "Guided account choice"));
    row.append(node("h3", "", action.label), node("p", "", action.detail));
    const controls = node("div", "action-controls");
    if (action.kind === "browser" && service.id === "maps" && action.id === "block-location") {
      const button = command("Block browser location", "button secondary compact", () => confirmLocation("block"));
      button.id = "block-location";
      controls.append(button);
    } else if (action.kind === "guide") {
      controls.append(command("Open guide", "button secondary compact", () => confirmContact("guide", action.id), "arrow-up-right"));
      const label = node("label", "report-choice");
      const checkbox = node("input");
      checkbox.type = "checkbox";
      checkbox.id = `report-${action.id}`;
      checkbox.checked = reportedGuides.has(action.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) reportedGuides.add(action.id);
        else reportedGuides.delete(action.id);
        resetAcknowledgment();
        updateActionState();
        void refreshBrowser();
      });
      label.append(checkbox, node("span", "", "I made a change in the service settings"));
      controls.append(label);
    }
    row.append(controls);
    if (action.kind === "guide") {
      const report = node("p", "guide-status");
      report.id = `guide-status-${action.id}`;
      row.append(report);
    }
    return row;
  }));
  updateActionState();
}

function updateActionState() {
  if (!service) return;
  for (const action of service.actions.filter((item) => item.kind === "guide")) {
    const status = $(`guide-status-${action.id}`);
    if (status) status.textContent = reportedGuides.has(action.id) ? "User-reported change. Not independently verified; related conflicts remain unresolved." : "Not verified. Related conflicts remain unresolved.";
  }
  if ($("block-location")) $("block-location").textContent = browserState.locationBlocked ? "Browser reports location blocked" : "Block browser location";
  updateButtons();
}

function renderDecision() {
  if (!analysis) return;
  const remaining = findings.filter((claim) => claim.status === "mismatch");
  $("risk-summary").textContent = remaining.length
    ? `${remaining.length} ${remaining.length === 1 ? "finding still conflicts" : "findings still conflict"} with your preferences for ${service.name}.`
    : findings.length ? "No listed findings conflict with your selected preferences. This is not a safety rating or proof of no collection." : "There is not enough supported evidence to assess the remaining collection risks.";
  const risks = [...remaining.map((claim) => claim.label), ...evidenceWarnings()];
  if (reportedGuides.size) risks.push("Guided changes are user-reported, not verified, and have not resolved any policy conflicts.");
  if (browserState.error) risks.push("The effective browser control could not be verified.");
  $("remaining-risks").replaceChildren(...risks.map((risk) => node("li", "", risk)));
  $("visit-service").firstChild.textContent = `Visit ${service.name}`;
}

function catalogUrl(choice) {
  const selected = getService(choice.serviceId);
  if (!selected) return null;
  if (choice.kind === "visit") return selected.homeUrl;
  if (choice.kind === "source") return selected.sources.find((source) => source.id === choice.id)?.url ?? null;
  if (choice.kind === "guide") return selected.actions.find((action) => action.id === choice.id && action.kind === "guide")?.url ?? null;
  return null;
}

function confirmContact(kind, id) {
  if (!service) return;
  const choice = { kind, id, serviceId: service.id };
  const url = catalogUrl(choice);
  if (!url) return;
  pendingConfirmation = choice;
  $("confirm-title").textContent = kind === "visit" ? `Visit ${service.name}?` : `Open ${kind === "guide" ? "company guide" : "policy source"}?`;
  $("confirm-description").textContent = "This opens an external company page in a new tab.";
  $("confirm-detail").textContent = "Continuing contacts the company and may send your IP address, cookies, and account-session information. This is separate from the policy preview.";
  $("confirm-url").textContent = url;
  $("confirm-proceed").textContent = kind === "visit" ? "Confirm visit" : "Open company page";
  $("confirm-dialog").showModal();
}

function confirmLocation(kind) {
  pendingConfirmation = { kind, serviceId: service?.id };
  $("confirm-title").textContent = kind === "block" ? "Block browser location?" : "Restore the extension's location rule?";
  $("confirm-description").textContent = kind === "block"
    ? "Chrome will ask for optional content-settings permission if it has not been granted. Only a geolocation block will be applied."
    : "Only this extension's regular-profile geolocation rule will be removed. Your browser, organization, and other extensions may still block location.";
  $("confirm-detail").textContent = "Scope: all https://www.google.com/* pages, not just Maps. Other Google pages are affected. The block persists until restored; IP-derived location and typed places remain exposed. Restoration never sets location to Allow.";
  $("confirm-url").textContent = LOCATION_PATTERN;
  $("confirm-proceed").textContent = kind === "block" ? "Request permission & block" : "Restore extension rule";
  $("confirm-dialog").showModal();
}

async function proceedConfirmation() {
  const choice = pendingConfirmation;
  if (!choice) return;
  $("confirm-dialog").close();
  if (choice.kind === "block" || choice.kind === "restore") {
    controlBusy = true;
    resetAcknowledgment();
    message("control-status", "");
    try {
      // Do not await any other work before blockLocation's permission request.
      const operation = choice.kind === "block" ? blockLocation(choice.serviceId) : restoreLocation();
      updateButtons();
      const state = await operation;
      const text = state.error ? `The rule operation completed, but verification failed: ${state.error}`
        : choice.kind === "block" ? state.locationBlocked
          ? "Chrome read-back confirms location blocked for www.google.com. Other collection remains."
          : "Chrome accepted the rule, but the effective setting is not blocked. No reduction was verified."
          : state.locationBlocked ? "Extension rule removed. Chrome still reports a block from another setting."
            : `Extension rule removed. Chrome reports ${state.setting}; no Allow rule was written.`;
      message("control-status", text, Boolean(state.error) || (choice.kind === "block" && !state.locationBlocked));
    } catch (error) {
      message("control-status", error.message, true);
    } finally {
      controlBusy = false;
      await refreshBrowser();
    }
    return;
  }
  if (choice.serviceId !== service?.id) return;
  if (choice.kind === "visit") {
    await refreshBrowser();
    if (!$("acknowledge").checked || !analysis || refreshing || choice.serviceId !== service?.id) {
      message("decision-status", "The review changed. Acknowledge the current remaining risks before visiting.", true);
      return;
    }
  }
  const url = catalogUrl(choice);
  if (!url) return;
  try {
    if (!globalThis.chrome?.tabs?.create) throw new Error("Opening company pages requires the installed Chrome extension.");
    await chrome.tabs.create({ url });
    message(choice.kind === "visit" ? "decision-status" : "service-message", `Opened ${choice.kind === "visit" ? service.name : "the company page"} in a new tab. The company may now receive browser and account information.`);
  } catch (error) {
    message("app-notice", `The page could not be opened. ${error.message}`, true);
  }
}

function openSettings() {
  $("token-input").value = "";
  message("settings-status", "");
  updateSetup();
  $("settings-dialog").showModal();
}

$("api-address").textContent = API_BASE;
$("service-form").addEventListener("submit", analyze);
$("service-input").addEventListener("input", (event) => chooseService(event.target.value));
$("cancel-analysis").addEventListener("click", () => request?.abort());
$("settings-button").addEventListener("click", openSettings);
$("setup-button").addEventListener("click", openSettings);
$("close-settings").addEventListener("click", () => $("settings-dialog").close());
$("settings-dialog").addEventListener("close", () => { $("token-input").value = ""; });
$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = $("token-input").value.trim();
  if (!/^[\x21-\x7E]{1,2048}$/.test(token)) {
    message("settings-status", "Enter a valid access token without spaces or control characters.", true);
    return;
  }
  $("save-token").disabled = true;
  try {
    await chrome.storage.local.set({ accessToken: token });
    accessToken = token;
    $("token-input").value = "";
    message("settings-status", "Access token saved locally. No analysis request has been sent.");
    updateSetup();
  } catch {
    message("settings-status", "The token could not be saved to local extension storage.", true);
  } finally {
    updateSetup();
  }
});
$("remove-token").addEventListener("click", async () => {
  try {
    await chrome.storage.local.remove("accessToken");
    accessToken = "";
    request?.abort();
    $("token-input").value = "";
    message("settings-status", "Saved access token removed.");
    updateSetup();
  } catch {
    message("settings-status", "The saved access token could not be removed.", true);
  }
});

for (const [group, key, options] of [["data", "allowedData", DATA_CATEGORIES], ["purpose", "allowedPurposes", PURPOSES]]) {
  for (const mode of ["none", "all"]) {
    $(`${group}-${mode}`).addEventListener("click", () => {
      preferences[key] = mode === "all" ? options.map((item) => item.id) : [];
      renderPreferences();
      preferencesChanged();
    });
  }
}

$("service-shortcuts").replaceChildren(...SERVICES.map((item) => {
  const button = command("", "service-option", () => {
    $("service-input").value = item.name;
    chooseService(item.name);
  });
  button.dataset.service = item.id;
  button.setAttribute("aria-pressed", String(service.id === item.id));
  button.setAttribute("aria-label", item.name);
  const copy = node("span");
  copy.append(node("strong", "", item.name), node("small", "", item.topic));
  button.append(copy);
  return button;
}));

$("find-reductions").addEventListener("click", async () => {
  if (!analysis) return;
  await refreshBrowser();
  if (!analysis) return;
  renderActions();
  $("reductions").hidden = false;
  setStep("reductions");
  focusSection("reductions-title");
});
$("review-decision").addEventListener("click", async () => {
  await refreshBrowser();
  if (!analysis) return;
  $("decision").hidden = false;
  setStep("decision");
  renderDecision();
  focusSection("decision-title");
});
$("acknowledge").addEventListener("change", updateButtons);
$("visit-service").addEventListener("click", async () => {
  await refreshBrowser();
  if (!$("acknowledge").checked || !analysis || refreshing) return;
  confirmContact("visit");
});
$("do-not-visit").addEventListener("click", () => {
  resetAcknowledgment();
  message("decision-status", `Decision: do not visit ${service.name}. No service page was opened by this decision. Existing browser rules remain in place until restored.`);
});
$("restore-location").addEventListener("click", () => confirmLocation("restore"));
$("confirm-cancel").addEventListener("click", () => $("confirm-dialog").close());
$("confirm-dialog").addEventListener("close", () => { pendingConfirmation = null; });
$("confirm-proceed").addEventListener("click", () => void proceedConfirmation());
window.addEventListener("focus", () => void refreshBrowser());
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshBrowser(); });
globalThis.chrome?.permissions?.onRemoved?.addListener(() => void refreshBrowser());
globalThis.chrome?.permissions?.onAdded?.addListener(() => void refreshBrowser());
globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.accessToken) {
    accessToken = typeof changes.accessToken.newValue === "string" ? changes.accessToken.newValue : "";
    updateSetup();
  }
});

async function initialize() {
  renderPreferences();
  try {
    if (!globalThis.chrome?.storage?.local) throw new Error("Local extension storage unavailable");
    const saved = await chrome.storage.local.get(["preferences", "accessToken"]);
    preferences = normalizePreferences(saved.preferences);
    accessToken = typeof saved.accessToken === "string" ? saved.accessToken : "";
    storageReady = true;
    renderPreferences();
    $("storage-state").textContent = "Preferences saved locally";
  } catch {
    $("storage-state").textContent = "Local storage unavailable";
    message("app-notice", "Extension setup is unavailable in this context. Preferences cannot be saved and no analysis can be requested. Open Privacy Choices from the installed Chrome extension.");
  }
  updateSetup();
  await refreshBrowser();
}
void initialize();
