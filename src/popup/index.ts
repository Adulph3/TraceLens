import type {
  ExportFormat,
  PopupRequest,
  PopupResponse,
  PrivacyReport,
  SitePermissionState,
  TrackerCategory,
} from "../shared/types.ts";

const elements = {
  main: byId("popup-main"),
  announcer: byId("status-announcer"),
  loading: byId("loading"),
  errorState: byId("error-state"),
  errorMessage: byId("error-message"),
  errorRetry: buttonById("error-retry"),
  report: byId("report"),
  hostname: byId("hostname"),
  coverageNote: byId("coverage-note"),
  refresh: buttonById("refresh"),
  scoreRing: byId("score-ring"),
  scoreProgress: byId("score-progress"),
  score: byId("score"),
  scoreDenominator: byId("score-denominator"),
  scoreLabel: byId("score-label"),
  scoreSummary: byId("score-summary"),
  partialAlert: byId("partial-alert"),
  scoreAlertTitle: byId("score-alert-title"),
  scoreAlertMessage: byId("score-alert-message"),
  limitationsList: byId("limitations-list"),
  trackerCount: byId("tracker-count"),
  advertisingCount: byId("advertising-count"),
  analyticsCount: byId("analytics-count"),
  socialCount: byId("social-count"),
  thirdPartyCount: byId("third-party-count"),
  requestCount: byId("request-count"),
  cookieTotal: byId("cookie-total"),
  cookieUnavailable: byId("cookie-unavailable"),
  cookieGrid: byId("cookie-grid"),
  cookieSecure: byId("cookie-secure"),
  cookieHttpOnly: byId("cookie-http-only"),
  cookiePersistent: byId("cookie-persistent"),
  cookieSameSiteNone: byId("cookie-same-site-none"),
  cookiePartitioned: byId("cookie-partitioned"),
  cookieScriptAccessible: byId("cookie-script-accessible"),
  cookieCaveat: byId("cookie-caveat"),
  permissionsList: byId("permissions-list"),
  permissionsCaveat: byId("permissions-caveat"),
  trackerTotalPill: byId("tracker-total-pill"),
  trackerEmpty: byId("tracker-empty"),
  trackerList: byId("tracker-list"),
  scoreDetailsEyebrow: byId("score-details-eyebrow"),
  scoreDetailsHeading: byId("score-details-heading"),
  noDeductions: byId("no-deductions"),
  deductionList: byId("deduction-list"),
  totalDeductions: byId("total-deductions"),
  scoreEquationResult: byId("score-equation-result"),
  scoreDisclaimer: byId("score-disclaimer"),
  unknownCount: byId("unknown-count"),
  thirdPartyList: byId("third-party-list"),
  exportFormat: selectById("export-format"),
  saveReport: buttonById("save-report"),
  saveStatus: byId("save-status"),
  privacyNotice: byId("privacy-notice"),
  analyzedAt: byId("analyzed-at"),
};

let activeTabId: number | null = null;
let activeGeneration: number | null = null;
let saving = false;
let liveRefreshInFlight = false;
let renderedScore: number | null = null;
const LIVE_REFRESH_INTERVAL_MS = 1_000;

// Firefox derives a toolbar popup's preferred width from the strict-mode body.
// Start with the CSS-defined desktop width, then opt into fluid layout only
// after Firefox has had time to apply a genuinely constrained panel viewport.
window.setTimeout(() => {
  const updateWidthMode = (): void => {
    document.documentElement.classList.toggle(
      "popup-constrained",
      window.innerWidth > 0 && window.innerWidth < 380,
    );
  };
  updateWidthMode();
  window.addEventListener("resize", updateWidthMode, { passive: true });
}, 250);

elements.refresh.addEventListener("click", () => void loadReport());
elements.errorRetry.addEventListener("click", () => void loadReport());
elements.saveReport.addEventListener("click", () => void saveReport());

void loadReport();
window.setInterval(() => {
  if (document.visibilityState === "visible") void refreshLiveReport();
}, LIVE_REFRESH_INTERVAL_MS);

// A toolbar popup must not keep showing a previous document's report.
// Firefox usually closes it itself, but same-document navigation may not.
function closeStalePopup(details: { tabId: number; frameId: number }): void {
  if (details.tabId === activeTabId && details.frameId === 0 &&
    browser.extension.getViews({ type: "popup" }).includes(window)) {
    window.close();
  }
}
browser.webNavigation.onBeforeNavigate.addListener(closeStalePopup);
browser.webNavigation.onHistoryStateUpdated.addListener(closeStalePopup);
browser.webNavigation.onReferenceFragmentUpdated.addListener(closeStalePopup);

async function loadReport(): Promise<void> {
  const restoreFocus = document.activeElement === elements.refresh ||
    document.activeElement === elements.errorRetry;
  showLoading();
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      showError("No active browser tab is available.");
      return;
    }

    activeTabId = tab.id;
    const response: unknown = await browser.runtime.sendMessage({
      type: "GET_REPORT",
      tabId: tab.id,
    } satisfies PopupRequest);
    if (!isPopupResponse(response) || !response.ok || !("report" in response)) {
      showError(
        isPopupResponse(response) && !response.ok
          ? response.message
          : "TraceLens could not read this tab.",
      );
      return;
    }

    activeGeneration = response.generation;
    renderReport(response.report, false);
  } catch {
    showError("TraceLens could not read this tab. Reload the page and try again.");
  } finally {
    elements.main.setAttribute("aria-busy", "false");
    if (restoreFocus) {
      (elements.report.hidden ? elements.errorRetry : elements.refresh).focus();
    }
  }
}

async function refreshLiveReport(): Promise<void> {
  if (
    activeTabId === null ||
    saving ||
    liveRefreshInFlight ||
    elements.report.hidden
  ) {
    return;
  }

  liveRefreshInFlight = true;
  try {
    const response: unknown = await browser.runtime.sendMessage({
      type: "GET_REPORT",
      tabId: activeTabId,
    } satisfies PopupRequest);
    if (isPopupResponse(response) && response.ok && "report" in response) {
      activeGeneration = response.generation;
      renderReport(response.report, true);
    }
  } catch {
    // A transient navigation or a closing popup needs no visible error. The
    // next interval or explicit refresh will request a current snapshot.
  } finally {
    liveRefreshInFlight = false;
  }
}

async function saveReport(): Promise<void> {
  if (activeTabId === null || activeGeneration === null || saving) {
    return;
  }

  const format = elements.exportFormat.value === "html" ? "html" : "json";
  saving = true;
  elements.saveReport.setAttribute("aria-disabled", "true");
  elements.saveStatus.textContent = "Preparing a sanitized local export…";

  try {
    const response: unknown = await browser.runtime.sendMessage({
      type: "SAVE_REPORT",
      tabId: activeTabId,
      expectedGeneration: activeGeneration,
      format: format satisfies ExportFormat,
    } satisfies PopupRequest);
    if (!isPopupResponse(response) || !response.ok || !("downloadStarted" in response)) {
      elements.saveStatus.textContent =
        isPopupResponse(response) && !response.ok
          ? response.message
          : "The download could not be started.";
      return;
    }
    elements.saveStatus.textContent =
      "Download started. TraceLens does not keep another exported copy.";
  } catch {
    elements.saveStatus.textContent = "The download could not be started.";
  } finally {
    saving = false;
    elements.saveReport.removeAttribute("aria-disabled");
  }
}

function renderReport(report: PrivacyReport, liveUpdate: boolean): void {
  elements.loading.hidden = true;
  elements.errorState.hidden = true;
  elements.report.hidden = false;
  elements.hostname.textContent = report.hostname;
  elements.coverageNote.textContent = report.observation.note;

  const score = report.score.value;
  const partialCoverage = report.observation.coverage === "partial";
  const cookiesUnavailable = report.cookies.status === "unavailable";
  elements.scoreRing.setAttribute(
    "aria-label",
    `Privacy score based on observed signals: ${score} out of 100`,
  );
  elements.scoreAlertTitle.textContent = partialCoverage
    ? "Partial observation"
    : "Cookie evidence unavailable";
  elements.scoreAlertMessage.textContent = partialCoverage && cookiesUnavailable
    ? "Score uses observed request signals; cookie evidence is unavailable."
    : partialCoverage
      ? "Score is based only on signals observed by TraceLens so far."
      : "Score is based on the other privacy signals observed so far.";
  elements.partialAlert.hidden = !partialCoverage && !cookiesUnavailable;
  elements.score.textContent = String(score);
  elements.scoreDenominator.hidden = false;
  elements.scoreProgress.setAttribute("stroke-dasharray", `${score} 100`);
  elements.scoreRing.classList.toggle("score-medium", score < 75 && score >= 45);
  elements.scoreRing.classList.toggle("score-low", score < 45);
  elements.scoreLabel.textContent = scoreLabel(score);
  elements.scoreSummary.textContent =
    "Based on privacy signals observed by TraceLens so far.";
  elements.scoreDetailsEyebrow.textContent = "Observed evidence";
  elements.scoreDetailsHeading.textContent = "Score details";
  elements.noDeductions.textContent = "No deductions from observed signals.";

  setCount(elements.trackerCount, report.counts.trackers);
  setCount(elements.advertisingCount, report.counts.advertising);
  setCount(elements.analyticsCount, report.counts.analytics);
  setCount(elements.socialCount, report.counts.social);
  setCount(elements.thirdPartyCount, report.counts.thirdPartyDomains);
  setCount(elements.requestCount, report.requests.total);

  elements.cookieTotal.textContent =
    report.cookies.status === "available" ? `${report.cookies.total} total` : "Unavailable";
  elements.cookieUnavailable.hidden = report.cookies.status === "available";
  elements.cookieGrid.hidden = report.cookies.status !== "available";
  setCount(elements.cookieSecure, report.cookies.secure);
  setCount(elements.cookieHttpOnly, report.cookies.httpOnly);
  setCount(elements.cookiePersistent, report.cookies.persistent);
  setCount(elements.cookieSameSiteNone, report.cookies.sameSite.none);
  setCount(elements.cookiePartitioned, report.cookies.partitioned);
  setCount(elements.cookieScriptAccessible, report.cookies.scriptAccessible);
  elements.cookieCaveat.textContent = report.cookies.caveat;

  renderPermissions(report);
  renderTrackers(report);
  renderDeductions(report);
  elements.totalDeductions.textContent = `−${report.score.totalDeductions}`;
  elements.scoreEquationResult.textContent =
    `max(0, 100 − ${report.score.totalDeductions}) = ${report.score.value}`;
  renderThirdParties(report);
  elements.limitationsList.replaceChildren();
  for (const limitation of report.limitations) {
    const item = document.createElement("li");
    item.textContent = limitation;
    elements.limitationsList.append(item);
  }

  elements.scoreDisclaimer.textContent = report.score.disclaimer;
  elements.privacyNotice.textContent = report.privacyNotice;
  elements.analyzedAt.textContent = `Updated ${formatTimestamp(report.analyzedAt)}`;
  if (!liveUpdate) elements.saveStatus.textContent = "";
  if (liveUpdate && renderedScore !== null && renderedScore !== score) {
    elements.announcer.textContent = `Observed privacy score updated to ${score} out of 100.`;
  } else if (!liveUpdate) {
    elements.announcer.textContent =
      `Report ready for ${report.hostname}. Observed privacy score ${score} out of 100.`;
  }
  renderedScore = score;
}

function renderPermissions(report: PrivacyReport): void {
  elements.permissionsList.replaceChildren();
  if (report.permissions.items.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Unavailable on this page";
    elements.permissionsList.append(item);
  } else {
    for (const permission of report.permissions.items) {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = titleCase(permission.name);
      const state = document.createElement("span");
      state.className = `status-chip ${statusClass(permission.state)}`;
      state.textContent = permission.state;
      item.append(label, state);
      elements.permissionsList.append(item);
    }
  }
  elements.permissionsCaveat.textContent = report.permissions.caveat;
}

function renderTrackers(report: PrivacyReport): void {
  elements.trackerList.replaceChildren();
  elements.trackerEmpty.hidden = report.trackers.length > 0;
  elements.trackerTotalPill.textContent = `${report.trackers.length} domain${plural(report.trackers.length)}`;

  for (const tracker of report.trackers) {
    const item = document.createElement("li");
    const identity = document.createElement("div");
    const domain = document.createElement("strong");
    domain.textContent = tracker.domain;
    const detail = document.createElement("small");
    const dot = document.createElement("span");
    dot.className = `category-dot ${categoryClass(tracker.category)}`;
    detail.append(dot, `${tracker.company} · ${titleCase(tracker.category)}`);
    identity.append(domain, detail);
    const requests = document.createElement("span");
    requests.className = "request-pill";
    requests.textContent = `${tracker.requestCount} req`;
    item.append(identity, requests);
    elements.trackerList.append(item);
  }
}

function renderDeductions(report: PrivacyReport): void {
  elements.deductionList.replaceChildren();
  elements.noDeductions.hidden = report.score.deductions.length > 0;
  for (const deduction of report.score.deductions) {
    const item = document.createElement("li");
    const copy = document.createElement("p");
    copy.textContent = deduction.explanation;
    const points = document.createElement("span");
    points.className = "deduction-points";
    points.textContent = `−${deduction.points}`;
    item.append(copy, points);
    elements.deductionList.append(item);
  }
}

function renderThirdParties(report: PrivacyReport): void {
  elements.thirdPartyList.replaceChildren();
  elements.unknownCount.textContent = `${report.counts.unknownThirdPartyDomains} unknown`;

  if (report.thirdParties.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No third-party domains observed.";
    elements.thirdPartyList.append(item);
    return;
  }

  for (const finding of report.thirdParties) {
    const item = document.createElement("li");
    const identity = document.createElement("div");
    const domain = document.createElement("strong");
    domain.textContent = finding.domain;
    const detail = document.createElement("small");
    detail.textContent =
      finding.classification === "known-tracker"
        ? `Known ${titleCase(finding.category ?? "other")}`
        : "Unknown third party — not classified as a tracker";
    identity.append(domain, detail);
    const requests = document.createElement("span");
    requests.className = "request-pill";
    requests.textContent = `${finding.requestCount} req`;
    item.append(identity, requests);
    elements.thirdPartyList.append(item);
  }
}

function showLoading(): void {
  activeGeneration = null;
  elements.main.setAttribute("aria-busy", "true");
  elements.announcer.textContent = "Reading this tab. Building a local snapshot.";
  elements.loading.hidden = false;
  elements.errorState.hidden = true;
  elements.report.hidden = true;
}

function showError(message: string): void {
  activeGeneration = null;
  elements.announcer.textContent = `Analysis unavailable. ${message}`;
  elements.loading.hidden = true;
  elements.report.hidden = true;
  elements.errorState.hidden = false;
  elements.errorMessage.textContent = message;
}

function scoreLabel(score: number): string {
  if (score >= 85) return "Fewer observed concerns";
  if (score >= 65) return "Some privacy concerns";
  if (score >= 40) return "Many privacy concerns";
  return "Heavy observed exposure";
}

function statusClass(state: SitePermissionState): string {
  return state === "granted" || state === "denied" || state === "prompt" ? state : "";
}

function categoryClass(category: TrackerCategory): string {
  return category;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/-/gu, " ");
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "just now" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function setCount(element: HTMLElement, value: number): void {
  element.textContent = value.toLocaleString();
}

function isPopupResponse(value: unknown): value is PopupResponse {
  return typeof value === "object" && value !== null && "ok" in value && typeof value.ok === "boolean";
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing popup element: ${id}`);
  }
  return element;
}

function buttonById(id: string): HTMLButtonElement {
  const element = byId(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Popup element is not a button: ${id}`);
  }
  return element;
}

function selectById(id: string): HTMLSelectElement {
  const element = byId(id);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Popup element is not a select: ${id}`);
  }
  return element;
}
