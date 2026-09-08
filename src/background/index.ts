import { AnalysisStore } from "../core/analysisStore.ts";
import { emptyCookieSummary, summarizeCookies } from "../core/cookies.ts";
import {
  DocumentRegistry,
  type DocumentLifecycle,
} from "../core/documentRegistry.ts";
import { createExportArtifact } from "../core/export.ts";
import {
  buildPrivacyReport,
  createPermissionSummary,
  unavailablePermissionSummary,
} from "../core/report.ts";
import { parsePageUrl, siteKey } from "../shared/domains.ts";
import type {
  CookieSummary,
  ExportFormat,
  PermissionSummary,
  PopupRequest,
  PopupResponse,
  PrivacyReport,
  SitePermissionFinding,
  SitePermissionsResponse,
} from "../shared/types.ts";

const SESSION_MAX_IDLE_MS = 60 * 60 * 1_000;
const NAVIGATION_MAX_AGE_MS = 60_000;
const DOWNLOAD_URL_MAX_AGE_MS = 5 * 60 * 1_000;
const store = new AnalysisStore();
const documents = new DocumentRegistry();
const pendingMainRequests = new Map<number, {
  hostname: string;
  observedAt: number;
  requestId: string;
  beforeSeen: boolean;
  ambiguous: boolean;
}>();
const recentTopLevelCommits = new Map<number, {
  hostname: string;
  documentId: string;
  committedAt: number;
  observedAt: number;
  beforeNavigateObserved: boolean;
  requestId?: string;
}>();
const navigatingTabs = new Set<number>();
const documentLocations = new Map<number, {
  documentId: string;
  fingerprint: Promise<string | null>;
}>();
const sameDocumentReconciliations = new Map<number, symbol>();
const locationFingerprintSalt = crypto.getRandomValues(new Uint8Array(32));
const downloadUrls = new Map<number, { url: string; timeout: number }>();

interface DocumentAwareRequestDetails {
  documentId?: string;
  parentDocumentId?: string;
  documentLifecycle?: DocumentLifecycle;
}

interface DocumentAwareNavigationDetails {
  documentId?: string;
  parentDocumentId?: string;
  documentLifecycle?: DocumentLifecycle;
}

interface CurrentDocument {
  documentId: string;
  url: string;
}

interface DocumentAwareFrame {
  documentId?: string;
  parentFrameId: number;
  errorOccurred?: boolean;
  documentLifecycle?: DocumentLifecycle;
  url: string;
}

type GetDocumentAwareFrame = (details: {
  tabId: number;
  frameId?: number;
  documentId?: string;
}) => Promise<DocumentAwareFrame | null>;

type SendDocumentMessage = (
  tabId: number,
  message: unknown,
  options: { documentId: string },
) => Promise<unknown>;

const getDocumentAwareFrame = browser.webNavigation
  .getFrame as unknown as GetDocumentAwareFrame;
const sendDocumentMessage = browser.tabs.sendMessage as unknown as SendDocumentMessage;

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) {
      return;
    }

    if (details.type === "main_frame") {
      const page = parsePageUrl(details.url);
      if (page === null) {
        pendingMainRequests.delete(details.tabId);
      } else {
        const recentCommit = recentTopLevelCommits.get(details.tabId);
        const requestTimestamp = validEventTimestamp(details.timeStamp);
        if (
          recentCommit !== undefined &&
          recentCommit.hostname === page.hostname &&
          recentCommit.beforeNavigateObserved &&
          requestTimestamp !== null &&
          requestTimestamp < recentCommit.committedAt &&
          Date.now() - recentCommit.observedAt < NAVIGATION_MAX_AGE_MS
        ) {
          if (recentCommit.requestId === undefined) {
            recentCommit.requestId = details.requestId;
            store.confirmLateMainRequest(details.tabId, recentCommit.documentId);
          } else if (recentCommit.requestId !== details.requestId) {
            store.markPartial(details.tabId);
          }
          return;
        }

        forgetDocumentLocation(details.tabId);
        recentTopLevelCommits.delete(details.tabId);
        documents.remove(details.tabId);
        store.remove(details.tabId);
        const prior = pendingMainRequests.get(details.tabId);
        pendingMainRequests.set(details.tabId, {
          hostname: page.hostname,
          observedAt: Date.now(),
          requestId: details.requestId,
          beforeSeen: prior?.beforeSeen ?? navigatingTabs.has(details.tabId),
          ambiguous: prior !== undefined &&
            (prior.ambiguous || prior.requestId !== details.requestId),
        });
      }
      return;
    }

    const extendedDetails = details as typeof details & DocumentAwareRequestDetails;
    const topLevelDocumentId = documents.topLevelForRequest({
      tabId: details.tabId,
      type: details.type,
      ...(extendedDetails.documentId === undefined
        ? {}
        : { documentId: extendedDetails.documentId }),
      ...(extendedDetails.parentDocumentId === undefined
        ? {}
        : { parentDocumentId: extendedDetails.parentDocumentId }),
      ...(extendedDetails.documentLifecycle === undefined
        ? {}
        : { documentLifecycle: extendedDetails.documentLifecycle }),
    });
    if (topLevelDocumentId === null) {
      // An old/speculative subresource can race a fresh top-level reload after
      // its previous document tree has been cleared. It has no bearing on
      // whether the unique main-frame request and commit were observed.
      if (
        !pendingMainRequests.has(details.tabId) &&
        (extendedDetails.documentLifecycle === undefined ||
          extendedDetails.documentLifecycle === "active")
      ) {
        store.markPartial(details.tabId);
      }
      return;
    }

    store.recordResource({
      tabId: details.tabId,
      topLevelDocumentId,
      url: details.url,
      type: details.type,
    });
  },
  { urls: ["*://*/*"] },
);

browser.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  forgetDocumentLocation(details.tabId);
  recentTopLevelCommits.delete(details.tabId);
  navigatingTabs.add(details.tabId);
  const pending = pendingMainRequests.get(details.tabId);
  if (pending !== undefined) {
    // Firefox can deliver the main request before onBeforeNavigate.
    pending.ambiguous ||= pending.beforeSeen;
    pending.beforeSeen = true;
  }
  documents.remove(details.tabId);
  store.remove(details.tabId);
});

browser.webNavigation.onCommitted.addListener((details) => {
  const extendedDetails = details as typeof details & DocumentAwareNavigationDetails;
  const documentId = validDocumentId(extendedDetails.documentId);

  if (details.frameId !== 0) {
    if (
      documentId !== null &&
      (extendedDetails.documentLifecycle === undefined || extendedDetails.documentLifecycle === "active") &&
      extendedDetails.parentDocumentId !== undefined
    ) {
      const registered = documents.registerCommitted(
        details.tabId,
        details.frameId,
        documentId,
        extendedDetails.parentDocumentId,
      );
      if (!registered) {
        store.markPartial(details.tabId);
      }
    }
    return;
  }

  const page = parsePageUrl(details.url);
  const pending = pendingMainRequests.get(details.tabId);
  const beforeNavigateObserved = navigatingTabs.has(details.tabId);
  if (
    pending !== undefined &&
    page !== null &&
    pending.hostname !== page.hostname &&
    navigatingTabs.has(details.tabId)
  ) {
    return;
  }

  navigatingTabs.delete(details.tabId);
  pendingMainRequests.delete(details.tabId);
  const mainRequestObserved = page !== null && pending?.hostname === page.hostname &&
    !pending.ambiguous && Date.now() - pending.observedAt < 60_000;
  const committedAt = validEventTimestamp(details.timeStamp);
  if (
    documentId === null ||
    (extendedDetails.documentLifecycle !== undefined && extendedDetails.documentLifecycle !== "active") ||
    !store.commitNavigation(
      details.tabId,
      details.url,
      documentId,
      mainRequestObserved,
      pending === undefined && beforeNavigateObserved && committedAt !== null,
    )
  ) {
    documents.remove(details.tabId);
    store.remove(details.tabId);
    forgetDocumentLocation(details.tabId);
    recentTopLevelCommits.delete(details.tabId);
    return;
  }
  documents.registerCommitted(details.tabId, 0, documentId);
  rememberDocumentLocation(details.tabId, documentId, details.url);
  if (page !== null && committedAt !== null) {
    recentTopLevelCommits.set(details.tabId, {
      hostname: page.hostname,
      documentId,
      committedAt,
      observedAt: Date.now(),
      beforeNavigateObserved,
      ...(pending === undefined ? {} : { requestId: pending.requestId }),
    });
  } else {
    recentTopLevelCommits.delete(details.tabId);
  }
});

browser.webNavigation.onHistoryStateUpdated.addListener((details) => {
  void resetSameDocumentNavigation(details);
});
browser.webNavigation.onReferenceFragmentUpdated.addListener((details) => {
  void resetSameDocumentNavigation(details);
});

browser.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId === 0) {
    forgetDocumentLocation(details.tabId);
    recentTopLevelCommits.delete(details.tabId);
    documents.remove(details.tabId);
    store.remove(details.tabId);
    if (!pendingMainRequests.has(details.tabId)) {
      navigatingTabs.delete(details.tabId);
    }
  }
});

browser.webRequest.onErrorOccurred.addListener(
  (details) => {
    const pending = pendingMainRequests.get(details.tabId);
    if (details.type === "main_frame" && pending?.requestId === details.requestId) {
      pendingMainRequests.delete(details.tabId);
      navigatingTabs.delete(details.tabId);
      forgetDocumentLocation(details.tabId);
      recentTopLevelCommits.delete(details.tabId);
      documents.remove(details.tabId);
      store.remove(details.tabId);
    }
  },
  { urls: ["*://*/*"] },
);

browser.tabs.onRemoved.addListener((tabId) => {
  pendingMainRequests.delete(tabId);
  navigatingTabs.delete(tabId);
  forgetDocumentLocation(tabId);
  recentTopLevelCommits.delete(tabId);
  documents.remove(tabId);
  store.remove(tabId);
});

browser.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
  pendingMainRequests.delete(removedTabId);
  navigatingTabs.delete(removedTabId);
  forgetDocumentLocation(removedTabId);
  recentTopLevelCommits.delete(removedTabId);
  documents.remove(removedTabId);
  store.remove(removedTabId);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    void reconcileSettledNavigation(tabId);
  }
});

browser.permissions.onRemoved.addListener((removed) => {
  if ((removed.origins?.length ?? 0) > 0) {
    pendingMainRequests.clear();
    navigatingTabs.clear();
    documentLocations.clear();
    sameDocumentReconciliations.clear();
    recentTopLevelCommits.clear();
    documents.clear();
    store.clear();
  }
});

browser.downloads.onChanged.addListener((delta) => {
  const terminal = delta.state?.current;
  if (terminal === "complete" || terminal === "interrupted") {
    releaseDownloadUrl(delta.id);
  }
});

browser.runtime.onMessage.addListener((message: unknown, sender) => {
  if (
    sender.id !== browser.runtime.id ||
    sender.url !== browser.runtime.getURL("popup/popup.html") ||
    !isPopupRequest(message)
  ) {
    return undefined;
  }
  return handlePopupRequest(message);
});

setInterval(() => {
  store.removeExpired(SESSION_MAX_IDLE_MS);
  documents.removeWithoutSession((tabId) => store.has(tabId));
  for (const tabId of documentLocations.keys()) {
    if (!store.has(tabId)) forgetDocumentLocation(tabId);
  }
  const cutoff = Date.now() - NAVIGATION_MAX_AGE_MS;
  for (const [tabId, pending] of pendingMainRequests) {
    if (pending.observedAt < cutoff) {
      pendingMainRequests.delete(tabId);
      navigatingTabs.delete(tabId);
    }
  }
  for (const [tabId, commit] of recentTopLevelCommits) {
    if (commit.observedAt < cutoff) recentTopLevelCommits.delete(tabId);
  }
}, 60_000);

async function resetSameDocumentNavigation(
  details: {
    tabId: number;
    frameId: number;
    url: string;
  } & DocumentAwareNavigationDetails,
): Promise<void> {
  if (details.frameId !== 0) {
    return;
  }

  const documentId = validDocumentId(details.documentId);
  if (
    documentId === null ||
    (details.documentLifecycle !== undefined && details.documentLifecycle !== "active")
  ) {
    forgetDocumentLocation(details.tabId);
    documents.remove(details.tabId);
    store.remove(details.tabId);
    return;
  }

  const reconciliation = Symbol();
  sameDocumentReconciliations.set(details.tabId, reconciliation);
  try {
    const unchanged = await isUnchangedDocumentLocation(
      details.tabId,
      documentId,
      details.url,
    );
    if (sameDocumentReconciliations.get(details.tabId) !== reconciliation) {
      return;
    }
    if (
      unchanged &&
      !navigatingTabs.has(details.tabId) &&
      !pendingMainRequests.has(details.tabId) &&
      store.isDocumentCurrentOrMissing(details.tabId, documentId)
    ) {
      return;
    }

    if (
      !navigatingTabs.has(details.tabId) &&
      !pendingMainRequests.has(details.tabId) &&
      store.isDocumentCurrentOrMissing(details.tabId, documentId)
    ) {
      commitSameDocumentNavigation(details.tabId, details.url, documentId);
      return;
    }

    // Firefox can emit a top-level request/navigation-start around a fragment
    // update. Verify the browser's final tab and frame state before treating the
    // same-document event as authoritative and clearing that transient state.
    await reconcileSameDocumentNavigation(
      details.tabId,
      details.url,
      documentId,
      reconciliation,
    );
  } finally {
    if (sameDocumentReconciliations.get(details.tabId) === reconciliation) {
      sameDocumentReconciliations.delete(details.tabId);
    }
  }
}

async function reconcileSameDocumentNavigation(
  tabId: number,
  rawUrl: string,
  documentId: string,
  reconciliation: symbol,
): Promise<void> {
  try {
    const [tab, currentDocument] = await Promise.all([
      browser.tabs.get(tabId),
      readCurrentDocument(tabId),
    ]);
    const expectedUrl = normalizePageLocation(rawUrl);
    if (
      expectedUrl === null ||
      normalizePageLocation(tab.url ?? "") !== expectedUrl ||
      currentDocument?.documentId !== documentId ||
      normalizePageLocation(currentDocument.url) !== expectedUrl ||
      sameDocumentReconciliations.get(tabId) !== reconciliation
    ) {
      return;
    }

    const latestDocument = await readCurrentDocument(tabId);
    if (
      latestDocument?.documentId !== documentId ||
      normalizePageLocation(latestDocument.url) !== expectedUrl ||
      sameDocumentReconciliations.get(tabId) !== reconciliation
    ) {
      return;
    }

    pendingMainRequests.delete(tabId);
    navigatingTabs.delete(tabId);
    commitSameDocumentNavigation(tabId, rawUrl, documentId);
  } catch {
    // A closed/replaced tab needs no further cleanup here; its tab listeners
    // own the authoritative removal path.
  }
}

async function reconcileSettledNavigation(tabId: number): Promise<void> {
  const pending = pendingMainRequests.get(tabId);
  if (pending === undefined || navigatingTabs.has(tabId)) return;

  try {
    const [tab, currentDocument] = await Promise.all([
      browser.tabs.get(tabId),
      readCurrentDocument(tabId),
    ]);
    const page = currentDocument === null ? null : parsePageUrl(currentDocument.url);
    if (
      tab.status !== "complete" ||
      currentDocument === null ||
      page?.hostname !== pending.hostname ||
      pendingMainRequests.get(tabId) !== pending ||
      navigatingTabs.has(tabId)
    ) {
      return;
    }

    pendingMainRequests.delete(tabId);
    documents.remove(tabId);
    if (!store.commitNavigation(tabId, currentDocument.url, currentDocument.documentId, false)) {
      forgetDocumentLocation(tabId);
      store.remove(tabId);
      return;
    }
    documents.ensureTopLevel(tabId, currentDocument.documentId);
    rememberDocumentLocation(tabId, currentDocument.documentId, currentDocument.url);
  } catch {
    // Tab removal/replacement listeners own cleanup if the tab disappeared.
  }
}

function commitSameDocumentNavigation(
  tabId: number,
  rawUrl: string,
  documentId: string,
): void {
  if (!store.commitNavigation(tabId, rawUrl, documentId, false)) {
    forgetDocumentLocation(tabId);
    documents.remove(tabId);
    store.remove(tabId);
    return;
  }
  store.markPartial(tabId);
  recentTopLevelCommits.delete(tabId);
  documents.ensureTopLevel(tabId, documentId);
  rememberDocumentLocation(tabId, documentId, rawUrl);
}

function rememberDocumentLocation(
  tabId: number,
  documentId: string,
  rawUrl: string,
): void {
  sameDocumentReconciliations.delete(tabId);
  documentLocations.set(tabId, {
    documentId,
    fingerprint: fingerprintPageLocation(rawUrl),
  });
}

function forgetDocumentLocation(tabId: number): void {
  documentLocations.delete(tabId);
  sameDocumentReconciliations.delete(tabId);
}

async function isUnchangedDocumentLocation(
  tabId: number,
  documentId: string,
  rawUrl: string,
): Promise<boolean> {
  const remembered = documentLocations.get(tabId);
  if (remembered?.documentId !== documentId) return false;
  const [previous, candidate] = await Promise.all([
    remembered.fingerprint,
    fingerprintPageLocation(rawUrl),
  ]);
  return previous !== null && candidate !== null && previous === candidate &&
    documentLocations.get(tabId) === remembered;
}

async function fingerprintPageLocation(rawUrl: string): Promise<string | null> {
  const normalized = normalizePageLocation(rawUrl);
  if (normalized === null) return null;
  try {
    const urlBytes = new TextEncoder().encode(normalized);
    const input = new Uint8Array(locationFingerprintSalt.length + urlBytes.length);
    input.set(locationFingerprintSalt);
    input.set(urlBytes, locationFingerprintSalt.length);
    const digest = await crypto.subtle.digest("SHA-256", input);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

function normalizePageLocation(rawUrl: string): string | null {
  if (parsePageUrl(rawUrl) === null) return null;
  try {
    return new URL(rawUrl).href;
  } catch {
    return null;
  }
}

async function handlePopupRequest(request: PopupRequest): Promise<PopupResponse> {
  if (!Number.isInteger(request.tabId) || request.tabId < 0) {
    return invalidRequest();
  }
  if (navigatingTabs.has(request.tabId) || sameDocumentReconciliations.has(request.tabId)) {
    return {
      ok: false,
      reason: "unavailable",
      message: "The page is still navigating. Try again when it finishes loading.",
    };
  }
  if (pendingMainRequests.has(request.tabId)) {
    await reconcileSettledNavigation(request.tabId);
    if (pendingMainRequests.has(request.tabId)) {
      return {
        ok: false,
        reason: "unavailable",
        message: "TraceLens is still reconciling the top-level request. Try again shortly.",
      };
    }
  }

  try {
    const report = await getCurrentReport(request.tabId);
    if (report === null) {
      return {
        ok: false,
        reason: "unsupported-page",
        message: "TraceLens can analyze regular HTTP and HTTPS pages only.",
      };
    }

    if (request.type === "GET_REPORT") {
      const snapshot = store.snapshot(request.tabId);
      if (snapshot === null) throw new Error("Report expired");
      return { ok: true, report, generation: snapshot.generation };
    }

    if (store.snapshot(request.tabId)?.generation !== request.expectedGeneration) {
      throw new Error("The displayed report is stale");
    }
    await startDownload(report, request.format);
    return { ok: true, downloadStarted: true };
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "The report is temporarily unavailable. Reload the page and try again.",
    };
  }
}

async function getCurrentReport(tabId: number): Promise<PrivacyReport | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (
      navigatingTabs.has(tabId) ||
      pendingMainRequests.has(tabId) ||
      sameDocumentReconciliations.has(tabId)
    ) {
      throw new Error("Navigation is in progress");
    }

    const [tab, currentDocument] = await Promise.all([
      browser.tabs.get(tabId),
      readCurrentDocument(tabId),
    ]);
    if (
      navigatingTabs.has(tabId) ||
      pendingMainRequests.has(tabId) ||
      sameDocumentReconciliations.has(tabId)
    ) continue;
    if (currentDocument === null) {
      forgetDocumentLocation(tabId);
      documents.remove(tabId);
      store.remove(tabId);
      return null;
    }

    documents.ensureTopLevel(tabId, currentDocument.documentId);
    const snapshot = store.ensurePartialSession(
      tabId,
      currentDocument.url,
      currentDocument.documentId,
    );
    if (snapshot === null) {
      forgetDocumentLocation(tabId);
      return null;
    }

    const [cookies, permissions] = await Promise.all([
      readCookieSummary(currentDocument.url, tab.cookieStoreId),
      readPermissionSummary(tabId, currentDocument.documentId),
    ]);

    const latestDocument = await readCurrentDocument(tabId);
    if (
      !navigatingTabs.has(tabId) &&
      !pendingMainRequests.has(tabId) &&
      !sameDocumentReconciliations.has(tabId) &&
      latestDocument?.documentId === snapshot.documentId &&
      latestDocument.url === currentDocument.url &&
      store.isCurrent(tabId, snapshot.generation, snapshot.documentId)
    ) {
      rememberDocumentLocation(tabId, snapshot.documentId, currentDocument.url);
      return buildPrivacyReport(snapshot, cookies, permissions);
    }
  }

  return null;
}

async function readCurrentDocument(tabId: number): Promise<CurrentDocument | null> {
  try {
    const frame = await getDocumentAwareFrame({ tabId, frameId: 0 });
    const documentId = validDocumentId(frame?.documentId);
    if (
      frame === null ||
      frame.parentFrameId !== -1 ||
      frame.errorOccurred === true ||
      (frame.documentLifecycle !== undefined && frame.documentLifecycle !== "active") ||
      documentId === null ||
      parsePageUrl(frame.url) === null
    ) {
      return null;
    }
    return { documentId, url: frame.url };
  } catch {
    return null;
  }
}

async function readCookieSummary(
  rawUrl: string,
  cookieStoreId?: string,
): Promise<CookieSummary> {
  const cookieUrl = sanitizeCookieUrl(rawUrl);
  const page = parsePageUrl(rawUrl);
  if (cookieUrl === null || page === null) {
    return emptyCookieSummary("unavailable");
  }

  try {
    const partitionTopLevelSite = `${page.protocol}//${siteKey(page.hostname)}`;
    let cookieGroups: browser.cookies.Cookie[][];
    try {
      cookieGroups = await getCookieGroups(
        cookieUrl,
        partitionTopLevelSite,
        cookieStoreId,
      );
    } catch {
      cookieGroups = await getCookieGroups(
        cookieUrl,
        partitionTopLevelSite,
        cookieStoreId,
        siteKey(page.hostname),
      );
    }

    const metadata = cookieGroups.flatMap((cookies) => {
      const projected = cookies.map((cookie) => ({
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        session: cookie.session,
        hostOnly: cookie.hostOnly,
        sameSite: cookie.sameSite,
        partitioned: typeof cookie.partitionKey?.topLevelSite === "string" &&
          cookie.partitionKey.topLevelSite.length > 0,
      }));
      cookies.length = 0;
      return projected;
    });
    return summarizeCookies(metadata);
  } catch {
    return emptyCookieSummary("unavailable");
  }
}

async function getCookieGroups(
  url: string,
  partitionTopLevelSite: string,
  storeId?: string,
  firstPartyDomain?: string,
): Promise<browser.cookies.Cookie[][]> {
  const baseQuery: {
    url: string;
    storeId?: string;
    firstPartyDomain?: string;
  } = { url };
  if (storeId !== undefined) baseQuery.storeId = storeId;
  if (firstPartyDomain !== undefined) baseQuery.firstPartyDomain = firstPartyDomain;

  return Promise.all([
    browser.cookies.getAll(baseQuery),
    browser.cookies.getAll({
      ...baseQuery,
      partitionKey: { topLevelSite: partitionTopLevelSite },
    }),
  ]);
}

async function readPermissionSummary(
  tabId: number,
  documentId: string,
): Promise<PermissionSummary> {
  try {
    const response = await sendDocumentMessage(
      tabId,
      { type: "QUERY_SITE_PERMISSIONS" },
      { documentId },
    );
    if (!isSitePermissionsResponse(response)) {
      return unavailablePermissionSummary();
    }
    return createPermissionSummary(response.items);
  } catch {
    return unavailablePermissionSummary();
  }
}

async function startDownload(report: PrivacyReport, format: ExportFormat): Promise<void> {
  const artifact = createExportArtifact(report, format);
  const blob = new Blob([artifact.content], { type: `${artifact.mimeType};charset=utf-8` });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const downloadId = await browser.downloads.download({
      url: objectUrl,
      filename: artifact.filename,
      saveAs: true,
      conflictAction: "uniquify",
    });
    const timeout = window.setTimeout(
      () => releaseDownloadUrl(downloadId),
      DOWNLOAD_URL_MAX_AGE_MS,
    );
    downloadUrls.set(downloadId, { url: objectUrl, timeout });
    // A tiny download may finish before download() resolves.
    void browser.downloads.search({ id: downloadId }).then(([download]) => {
      if (download?.state === "complete" || download?.state === "interrupted") {
        releaseDownloadUrl(downloadId);
      }
    }).catch(() => { /* The terminal event and expiry still release the URL. */ });
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function releaseDownloadUrl(downloadId: number): void {
  const tracked = downloadUrls.get(downloadId);
  if (tracked === undefined) {
    return;
  }
  window.clearTimeout(tracked.timeout);
  URL.revokeObjectURL(tracked.url);
  downloadUrls.delete(downloadId);
}

function sanitizeCookieUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsePageUrl(rawUrl) === null) {
      return null;
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function isPopupRequest(message: unknown): message is PopupRequest {
  if (
    typeof message !== "object" ||
    message === null ||
    !("type" in message) ||
    !("tabId" in message) ||
    typeof message.tabId !== "number"
  ) {
    return false;
  }

  if (message.type === "GET_REPORT") {
    return true;
  }
  return (
    message.type === "SAVE_REPORT" &&
    "expectedGeneration" in message &&
    typeof message.expectedGeneration === "number" &&
    Number.isSafeInteger(message.expectedGeneration) &&
    "format" in message &&
    (message.format === "json" || message.format === "html")
  );
}

function isSitePermissionsResponse(value: unknown): value is SitePermissionsResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    value.type !== "SITE_PERMISSIONS_RESULT" ||
    !("items" in value) ||
    !Array.isArray(value.items)
  ) {
    return false;
  }

  return value.items.every(isSitePermissionFinding);
}

function isSitePermissionFinding(value: unknown): value is SitePermissionFinding {
  if (
    typeof value !== "object" ||
    value === null ||
    !("name" in value) ||
    !("state" in value)
  ) {
    return false;
  }
  const names = ["geolocation", "notifications", "camera", "microphone"];
  const states = ["granted", "prompt", "denied", "unsupported", "unavailable"];
  return (
    typeof value.name === "string" &&
    names.includes(value.name) &&
    typeof value.state === "string" &&
    states.includes(value.state)
  );
}

function invalidRequest(): PopupResponse {
  return {
    ok: false,
    reason: "invalid-request",
    message: "TraceLens rejected an invalid extension request.",
  };
}

function validDocumentId(value: string | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function validEventTimestamp(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
