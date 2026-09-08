import type {
  CookieSummary,
  PrivacyScore,
  ScoreDeduction,
  TrackerCategory,
  TrackerFinding,
} from "../shared/types.ts";

export interface ScoreInput {
  coverage: "full-navigation" | "partial";
  protocol: "http:" | "https:";
  hostname: string;
  thirdPartyDomainCount: number;
  trackers: readonly TrackerFinding[];
  cookies: CookieSummary;
}

interface TrackerCategoryRule {
  category: TrackerCategory;
  code: ScoreDeduction["code"];
  label: string;
  pointsEach: number;
  fullRateCount: number;
  cap: number;
}

// Categories describe different observed behavior, so they retain independent
// caps. This makes a diverse tracker set more consequential than a long list
// from only one category while keeping every component bounded.
const TRACKER_RULES: readonly TrackerCategoryRule[] = [
  { category: "fingerprinting", code: "fingerprinting-trackers", label: "fingerprinting", pointsEach: 7, fullRateCount: 3, cap: 38 },
  { category: "advertising", code: "advertising-trackers", label: "advertising", pointsEach: 6, fullRateCount: 3, cap: 35 },
  { category: "social", code: "social-trackers", label: "social", pointsEach: 5, fullRateCount: 3, cap: 32 },
  { category: "analytics", code: "analytics-trackers", label: "analytics", pointsEach: 4, fullRateCount: 3, cap: 29 },
  { category: "other", code: "other-trackers", label: "other", pointsEach: 3, fullRateCount: 2, cap: 24 },
] as const;

const SCORE_DISCLAIMER =
  "Based only on privacy signals observed by TraceLens so far. Browser privacy tools and content blockers can affect which requests TraceLens observes. A high score may reflect limited evidence and does not prove that a site is safe.";

export function calculatePrivacyScore(input: ScoreInput): PrivacyScore {
  const deductions: ScoreDeduction[] = [];

  if (input.protocol === "http:" && !isLoopback(input.hostname)) {
    deductions.push({
      code: "insecure-transport",
      points: 10,
      count: 1,
      cap: 10,
      explanation: "The page used HTTP instead of encrypted HTTPS.",
    });
  }

  const thirdPartyPoints = thirdPartyDeduction(input.thirdPartyDomainCount);
  if (thirdPartyPoints > 0) {
    deductions.push({
      code: "third-party-exposure",
      points: thirdPartyPoints,
      count: input.thirdPartyDomainCount,
      cap: 30,
      explanation: `${input.thirdPartyDomainCount} unique third-party domain${plural(input.thirdPartyDomainCount)} observed: first 10 × 1 point, next 20 × 0.5 rounded up, next 30 × one-third rounded up; capped at 30 points. Requests may later be blocked or fail.`,
    });
  }

  const uniqueTrackers = uniqueTrackerCategories(input.trackers);
  for (const rule of TRACKER_RULES) {
    const count = countCategory(uniqueTrackers, rule.category);
    const points = trackerCategoryDeduction(count, rule);
    if (points > 0) {
      deductions.push({
        code: rule.code,
        points,
        count,
        cap: rule.cap,
        explanation: `${count} unique ${rule.label} tracker domain${plural(count)}: first ${rule.fullRateCount} × ${rule.pointsEach} points, then 1 point each; capped at ${rule.cap}. Matches use the bundled domain list.`,
      });
    }
  }

  if (input.cookies.status === "available") {
    addCappedDeduction(
      deductions,
      "persistent-cookies",
      input.cookies.persistent,
      0.5,
      5,
      `${input.cookies.persistent} persistent cookie${plural(input.cookies.persistent)}: 1 point per 2 cookies, rounded up; capped at 5. These cookies can remain beyond the current browser session.`,
    );
    addCappedDeduction(
      deductions,
      "cross-site-cookies",
      input.cookies.sameSite.none,
      1,
      6,
      `${input.cookies.sameSite.none} SameSite=None cookie${plural(input.cookies.sameSite.none)} × 1 point, capped at 6. This setting permits cross-site contexts when other browser protections allow it.`,
    );
    if (input.protocol === "https:") {
      addCappedDeduction(
        deductions,
        "non-secure-cookies",
        input.cookies.nonSecure,
        1,
        4,
        `${input.cookies.nonSecure} cookie${plural(input.cookies.nonSecure)} applicable to this HTTPS page lack the Secure flag × 1 point, capped at 4.`,
      );
    }
  }

  const totalDeductions = deductions.reduce((total, deduction) => total + deduction.points, 0);
  return {
    version: "2.0",
    basis: "observed-signals",
    baseline: 100,
    value: Math.max(0, 100 - totalDeductions),
    totalDeductions,
    provisional:
      input.coverage !== "full-navigation" || input.cookies.status !== "available",
    deductions,
    disclaimer: SCORE_DISCLAIMER,
  };
}

function addCappedDeduction(
  deductions: ScoreDeduction[],
  code: ScoreDeduction["code"],
  count: number,
  pointsEach: number,
  cap: number,
  explanation: string,
): void {
  const points = Math.min(Math.ceil(count * pointsEach), cap);
  if (points > 0) {
    deductions.push({ code, points, count, cap, explanation });
  }
}

export function thirdPartyDeduction(count: number): number {
  const firstBand = Math.min(count, 10);
  const secondBand = Math.ceil(Math.min(Math.max(count - 10, 0), 20) / 2);
  const thirdBand = Math.ceil(Math.min(Math.max(count - 30, 0), 30) / 3);
  return Math.min(firstBand + secondBand + thirdBand, 30);
}

function trackerCategoryDeduction(count: number, rule: TrackerCategoryRule): number {
  const fullRate = Math.min(count, rule.fullRateCount) * rule.pointsEach;
  const diminishing = Math.max(count - rule.fullRateCount, 0);
  return Math.min(fullRate + diminishing, rule.cap);
}

function uniqueTrackerCategories(trackers: readonly TrackerFinding[]): Map<string, TrackerCategory> {
  const categories = new Map<string, TrackerCategory>();
  for (const tracker of trackers) {
    const domain = tracker.domain.trim().toLowerCase().replace(/\.+$/u, "");
    if (domain.length === 0) continue;
    const existing = categories.get(domain);
    if (existing === undefined || categoryWeight(tracker.category) > categoryWeight(existing)) {
      categories.set(domain, tracker.category);
    }
  }
  return categories;
}

function countCategory(
  trackers: ReadonlyMap<string, TrackerCategory>,
  category: TrackerCategory,
): number {
  let count = 0;
  for (const value of trackers.values()) {
    if (value === category) count += 1;
  }
  return count;
}

function categoryWeight(category: TrackerCategory): number {
  return TRACKER_RULES.find((rule) => rule.category === category)?.pointsEach ?? 0;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}
