export type TrackerCategory =
  | "advertising"
  | "analytics"
  | "social"
  | "fingerprinting"
  | "other";

export interface TrackerRule {
  readonly id: string;
  readonly domain: string;
  readonly company: string;
  readonly category: TrackerCategory;
}

export interface TrackerFinding {
  domain: string;
  company: string;
  category: TrackerCategory;
  requestCount: number;
  evidence: "bundled-domain-list";
}

export interface ThirdPartyFinding {
  domain: string;
  requestCount: number;
  classification: "known-tracker" | "unknown-third-party";
  company?: string;
  category?: TrackerCategory;
}

export type SitePermissionName =
  | "geolocation"
  | "notifications"
  | "camera"
  | "microphone";

export type SitePermissionState =
  | "granted"
  | "prompt"
  | "denied"
  | "unsupported"
  | "unavailable";

export interface SitePermissionFinding {
  name: SitePermissionName;
  state: SitePermissionState;
}

export interface PermissionSummary {
  source: "page-permissions-api";
  status: "available" | "partial" | "unavailable";
  items: SitePermissionFinding[];
  caveat: string;
}

export interface CookieSummary {
  status: "available" | "unavailable";
  scope: "cookies-applicable-to-current-page";
  total: number;
  session: number;
  persistent: number;
  secure: number;
  nonSecure: number;
  httpOnly: number;
  scriptAccessible: number;
  hostOnly: number;
  domainScoped: number;
  partitioned: number;
  sameSite: {
    strict: number;
    lax: number;
    none: number;
    unspecified: number;
  };
  caveat: string;
}

export interface ScoreDeduction {
  code:
    | "insecure-transport"
    | "third-party-exposure"
    | "advertising-trackers"
    | "analytics-trackers"
    | "social-trackers"
    | "fingerprinting-trackers"
    | "other-trackers"
    | "persistent-cookies"
    | "cross-site-cookies"
    | "non-secure-cookies";
  points: number;
  count: number;
  cap: number;
  explanation: string;
}

export interface PrivacyScore {
  version: "2.0";
  basis: "observed-signals";
  baseline: 100;
  value: number;
  totalDeductions: number;
  provisional: boolean;
  deductions: ScoreDeduction[];
  disclaimer: string;
}

export type ObservationCoverage = "full-navigation" | "partial";

export interface PrivacyReport {
  schemaVersion: "1.0";
  product: "TraceLens";
  hostname: string;
  analyzedAt: string;
  observation: {
    startedAt: string;
    coverage: ObservationCoverage;
    note: string;
  };
  score: PrivacyScore;
  requests: {
    total: number;
    firstParty: number;
    thirdParty: number;
    byType: Record<string, number>;
  };
  counts: {
    trackers: number;
    advertising: number;
    analytics: number;
    social: number;
    fingerprinting: number;
    other: number;
    thirdPartyDomains: number;
    unknownThirdPartyDomains: number;
  };
  trackers: TrackerFinding[];
  thirdParties: ThirdPartyFinding[];
  cookies: CookieSummary;
  permissions: PermissionSummary;
  privacyNotice: string;
  limitations: string[];
}

export type ExportFormat = "json" | "html";

export type PopupRequest =
  | { type: "GET_REPORT"; tabId: number }
  | { type: "SAVE_REPORT"; tabId: number; format: ExportFormat; expectedGeneration: number };

export type PopupResponse =
  | { ok: true; report: PrivacyReport; generation: number }
  | { ok: true; downloadStarted: true }
  | {
      ok: false;
      reason: "unsupported-page" | "unavailable" | "invalid-request";
      message: string;
    };

export interface QuerySitePermissionsRequest {
  type: "QUERY_SITE_PERMISSIONS";
}

export interface SitePermissionsResponse {
  type: "SITE_PERMISSIONS_RESULT";
  items: SitePermissionFinding[];
}
