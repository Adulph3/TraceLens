import type { SessionSnapshot } from "./analysisStore.ts";
import { calculatePrivacyScore } from "./score.ts";
import type {
  CookieSummary,
  PermissionSummary,
  PrivacyReport,
  SitePermissionFinding,
  TrackerFinding,
} from "../shared/types.ts";

const PRIVACY_NOTICE =
  "Your browsing analysis stays in memory and is discarded automatically. Reports are only saved when you explicitly export them.";

const BASE_LIMITATIONS = [
  "Only requests observed after TraceLens began watching this page are included.",
  "Observed requests may be blocked or fail later. Counts do not prove delivery or reveal transmitted personal data.",
  "Domain-list matching cannot detect CNAME-cloaked, path-based, or previously unknown trackers.",
  "Cookie totals are a current-site metadata snapshot, not a record of cookies created or sent by this load.",
  "Permission status does not mean the site requested or used a capability.",
];

export function unavailablePermissionSummary(): PermissionSummary {
  return {
    source: "page-permissions-api",
    status: "unavailable",
    items: [],
    caveat:
      "Current browser permission status is unavailable on this page. Status never proves that a site requested or used a capability.",
  };
}

export function createPermissionSummary(items: SitePermissionFinding[]): PermissionSummary {
  const supported = items.filter(
    (item) =>
      item.state === "granted" || item.state === "prompt" || item.state === "denied",
  );
  return {
    source: "page-permissions-api",
    status:
      supported.length === 0
        ? "unavailable"
        : supported.length === items.length
          ? "available"
          : "partial",
    items,
    caveat:
      "Browser status for this page origin. It does not mean the site requested or used the capability, and no prompt was triggered.",
  };
}

export function normalizePermissionState(state: string): SitePermissionFinding["state"] {
  if (state === "default") {
    return "prompt";
  }
  return state === "granted" || state === "prompt" || state === "denied"
    ? state
    : "unsupported";
}

export function buildPrivacyReport(
  snapshot: SessionSnapshot,
  cookies: CookieSummary,
  permissions: PermissionSummary,
  analyzedAt: number = Date.now(),
): PrivacyReport {
  const thirdParties = [...snapshot.thirdParties].sort(compareFindings);
  const trackers: TrackerFinding[] = thirdParties
    .filter(
      (finding): finding is typeof finding & Required<Pick<typeof finding, "company" | "category">> =>
        finding.classification === "known-tracker" &&
        finding.company !== undefined &&
        finding.category !== undefined,
    )
    .map((finding) => ({
      domain: finding.domain,
      company: finding.company,
      category: finding.category,
      requestCount: finding.requestCount,
      evidence: "bundled-domain-list",
    }));

  const countCategory = (category: TrackerFinding["category"]): number =>
    trackers.filter((tracker) => tracker.category === category).length;

  const limitations = [...BASE_LIMITATIONS];
  if (snapshot.overflowRequests > 0) {
    limitations.push(
      `${snapshot.overflowRequests} third-party requests were counted but omitted from domain details after the 1,000-domain safety limit.`,
    );
  }

  const counts = {
    trackers: trackers.length,
    advertising: countCategory("advertising"),
    analytics: countCategory("analytics"),
    social: countCategory("social"),
    fingerprinting: countCategory("fingerprinting"),
    other: countCategory("other"),
    thirdPartyDomains: thirdParties.length,
    unknownThirdPartyDomains: thirdParties.filter(
      (finding) => finding.classification === "unknown-third-party",
    ).length,
  };

  return {
    schemaVersion: "1.0",
    product: "TraceLens",
    hostname: snapshot.hostname,
    analyzedAt: new Date(analyzedAt).toISOString(),
    observation: {
      startedAt: new Date(snapshot.startedAt).toISOString(),
      coverage: snapshot.coverage,
      note:
        snapshot.coverage === "full-navigation"
          ? "Observed from the start of this top-level navigation; the score uses signals observed so far."
          : "Partial observation — the score uses only signals observed by TraceLens so far.",
    },
    score: calculatePrivacyScore({
      coverage: snapshot.coverage,
      protocol: snapshot.protocol,
      hostname: snapshot.hostname,
      thirdPartyDomainCount: thirdParties.length,
      trackers,
      cookies,
    }),
    requests: {
      total: snapshot.totalRequests,
      firstParty: snapshot.firstPartyRequests,
      thirdParty: snapshot.thirdPartyRequests,
      byType: { ...snapshot.requestsByType },
    },
    counts,
    trackers,
    thirdParties,
    cookies,
    permissions,
    privacyNotice: PRIVACY_NOTICE,
    limitations,
  };
}

function compareFindings(
  left: SessionSnapshot["thirdParties"][number],
  right: SessionSnapshot["thirdParties"][number],
): number {
  if (left.classification !== right.classification) {
    return left.classification === "known-tracker" ? -1 : 1;
  }
  if (left.requestCount !== right.requestCount) {
    return right.requestCount - left.requestCount;
  }
  return left.domain.localeCompare(right.domain);
}
