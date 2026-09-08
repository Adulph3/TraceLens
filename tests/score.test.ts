import assert from "node:assert/strict";
import test from "node:test";

import { emptyCookieSummary } from "../src/core/cookies.ts";
import { calculatePrivacyScore, thirdPartyDeduction } from "../src/core/score.ts";
import type { CookieSummary, TrackerCategory, TrackerFinding } from "../src/shared/types.ts";

const baseInput = {
  coverage: "full-navigation" as const,
  protocol: "https:" as const,
  hostname: "example.test",
};

function tracker(category: TrackerCategory, index: number): TrackerFinding {
  return {
    domain: `${category}-${index}.tracker.test`,
    company: "Test tracker",
    category,
    requestCount: 1,
    evidence: "bundled-domain-list",
  };
}

function trackerSet(categories: readonly TrackerCategory[]): TrackerFinding[] {
  return categories.map((category, index) => tracker(category, index));
}

function cookies(persistent = 0, sameSiteNone = 0, nonSecure = 0): CookieSummary {
  return {
    ...emptyCookieSummary("available"),
    total: Math.max(persistent, sameSiteNone, nonSecure),
    persistent,
    nonSecure,
    sameSite: { strict: 0, lax: 0, none: sameSiteNone, unspecified: 0 },
  };
}

test("score 2.0 exposes exact bounded components and stays in range", () => {
  const score = calculatePrivacyScore({
    ...baseInput,
    thirdPartyDomainCount: 100,
    trackers: trackerSet(["advertising", "analytics"]),
    cookies: cookies(20, 20, 20),
  });

  assert.equal(score.version, "2.0");
  assert.equal(score.value, 45);
  assert.equal(score.totalDeductions, 55);
  assert.deepEqual(
    score.deductions.map(({ code, points, cap }) => ({ code, points, cap })),
    [
      { code: "third-party-exposure", points: 30, cap: 30 },
      { code: "advertising-trackers", points: 6, cap: 35 },
      { code: "analytics-trackers", points: 4, cap: 29 },
      { code: "persistent-cookies", points: 5, cap: 5 },
      { code: "cross-site-cookies", points: 6, cap: 6 },
      { code: "non-secure-cookies", points: 4, cap: 4 },
    ],
  );
  assert.equal(score.deductions.every((deduction) => deduction.explanation.length > 0), true);
  assert.equal(score.baseline - score.totalDeductions, score.value);
});

test("representative synthetic profiles are ordered from sparse to extreme exposure", () => {
  const profileA = calculatePrivacyScore({
    ...baseInput,
    thirdPartyDomainCount: 0,
    trackers: [],
    cookies: cookies(),
  });
  const profileB = calculatePrivacyScore({
    ...baseInput,
    thirdPartyDomainCount: 8,
    trackers: trackerSet(["analytics"]),
    cookies: cookies(2, 1, 0),
  });
  const profileC = calculatePrivacyScore({
    ...baseInput,
    thirdPartyDomainCount: 25,
    trackers: trackerSet([
      "advertising",
      "advertising",
      "fingerprinting",
      "analytics",
      "social",
    ]),
    cookies: cookies(8, 4, 2),
  });
  const profileD = calculatePrivacyScore({
    ...baseInput,
    thirdPartyDomainCount: 74,
    trackers: trackerSet([
      ...Array<TrackerCategory>(8).fill("advertising"),
      ...Array<TrackerCategory>(3).fill("fingerprinting"),
      ...Array<TrackerCategory>(3).fill("social"),
      ...Array<TrackerCategory>(4).fill("analytics"),
      ...Array<TrackerCategory>(2).fill("other"),
    ]),
    cookies: cookies(30, 15, 12),
  });

  assert.deepEqual(
    [profileA.value, profileB.value, profileC.value, profileD.value],
    [100, 86, 44, 0],
  );
  assert.ok(profileA.value > profileB.value);
  assert.ok(profileB.value > profileC.value);
  assert.ok(profileC.value > profileD.value);
});

test("third-party scaling remains monotonic and distinguishes light through heavy exposure", () => {
  assert.deepEqual(
    [1, 5, 10, 25, 50, 74].map(thirdPartyDeduction),
    [1, 5, 10, 18, 27, 30],
  );
  assert.equal(thirdPartyDeduction(25), 18);
  assert.equal(thirdPartyDeduction(74), 30);
  let previous = 0;
  for (let count = 0; count <= 150; count += 1) {
    const current = thirdPartyDeduction(count);
    assert.ok(current >= previous, `${count} domains: ${current} must be >= ${previous}`);
    previous = current;
  }
});

test("adding a unique tracker in every category never increases the score", () => {
  const categories: readonly TrackerCategory[] = [
    "advertising",
    "analytics",
    "social",
    "fingerprinting",
    "other",
  ];
  for (const category of categories) {
    let previous = 100;
    for (let count = 0; count <= 25; count += 1) {
      const score = calculatePrivacyScore({
        ...baseInput,
        thirdPartyDomainCount: 25,
        trackers: Array.from({ length: count }, (_, index) => tracker(category, index)),
        cookies: cookies(),
      }).value;
      assert.ok(score <= previous, `${category} count ${count}: ${score} must be <= ${previous}`);
      previous = score;
    }
    const deductions = [0, 1, 5, 20].map((count) => 100 - calculatePrivacyScore({
      ...baseInput,
      thirdPartyDomainCount: 0,
      trackers: Array.from({ length: count }, (_, index) => tracker(category, index)),
      cookies: cookies(),
    }).value);
    assert.ok(deductions[0]! < deductions[1]!, `${category}: 0 and 1 must differ`);
    assert.ok(deductions[1]! < deductions[2]!, `${category}: 1 and 5 must differ`);
    assert.ok(deductions[2]! < deductions[3]!, `${category}: 5 and 20 must differ`);
  }
});

test("adding each scored cookie risk never increases the score", () => {
  const variants = [
    (count: number) => cookies(count, 0, 0),
    (count: number) => cookies(0, count, 0),
    (count: number) => cookies(0, 0, count),
  ];
  for (const variant of variants) {
    let previous = 100;
    for (let count = 0; count <= 30; count += 1) {
      const score = calculatePrivacyScore({
        ...baseInput,
        thirdPartyDomainCount: 0,
        trackers: [],
        cookies: variant(count),
      }).value;
      assert.ok(score <= previous, `cookie count ${count}: ${score} must be <= ${previous}`);
      previous = score;
    }
  }
});

test("tracker domains are unique and category severity is reflected", () => {
  const duplicate: TrackerFinding = {
    ...tracker("advertising", 0),
    domain: "AD.TRACKER.TEST.",
  };
  const unique = calculatePrivacyScore({
    ...baseInput,
    thirdPartyDomainCount: 1,
    trackers: [{ ...tracker("advertising", 0), domain: "ad.tracker.test" }, duplicate],
    cookies: cookies(),
  });
  assert.equal(unique.value, 93);
  assert.equal(unique.deductions.find((item) => item.code === "advertising-trackers")?.count, 1);

  const singleScore = (category: TrackerCategory): number => calculatePrivacyScore({
    ...baseInput,
    thirdPartyDomainCount: 1,
    trackers: [tracker(category, 0)],
    cookies: cookies(),
  }).value;
  assert.ok(singleScore("fingerprinting") < singleScore("advertising"));
  assert.ok(singleScore("advertising") < singleScore("analytics"));
  assert.ok(singleScore("analytics") < singleScore("other"));
});

test("tracker request repetition does not multiply unique-domain deductions", () => {
  const once = calculatePrivacyScore({
    ...baseInput,
    thirdPartyDomainCount: 1,
    trackers: [{ ...tracker("advertising", 0), requestCount: 1 }],
    cookies: cookies(),
  });
  const repeated = calculatePrivacyScore({
    ...baseInput,
    thirdPartyDomainCount: 1,
    trackers: [{ ...tracker("advertising", 0), requestCount: 10_000 }],
    cookies: cookies(),
  });
  assert.equal(repeated.value, once.value);
  assert.deepEqual(repeated.deductions, once.deductions);
});

test("extreme evidence is bounded to the 0–100 score range", () => {
  const score = calculatePrivacyScore({
    ...baseInput,
    thirdPartyDomainCount: 10_000,
    trackers: trackerSet([
      ...Array<TrackerCategory>(100).fill("advertising"),
      ...Array<TrackerCategory>(100).fill("analytics"),
      ...Array<TrackerCategory>(100).fill("social"),
      ...Array<TrackerCategory>(100).fill("fingerprinting"),
      ...Array<TrackerCategory>(100).fill("other"),
    ]),
    cookies: cookies(10_000, 10_000, 10_000),
  });
  assert.equal(score.value, 0);
  assert.ok(score.totalDeductions > 100);
  assert.ok(score.value >= 0 && score.value <= 100);
  assert.deepEqual(
    score.deductions
      .filter((deduction) => deduction.code.endsWith("-trackers"))
      .map((deduction) => deduction.points),
    [38, 35, 32, 29, 24],
  );
});

test("partial or unavailable evidence stays numeric and provisional", () => {
  const partial = calculatePrivacyScore({
    ...baseInput,
    coverage: "partial",
    thirdPartyDomainCount: 0,
    trackers: [],
    cookies: cookies(),
  });
  const unavailable = calculatePrivacyScore({
    ...baseInput,
    thirdPartyDomainCount: 0,
    trackers: [],
    cookies: emptyCookieSummary("unavailable"),
  });
  assert.equal(partial.value, 100);
  assert.equal(partial.provisional, true);
  assert.equal(unavailable.value, 100);
  assert.equal(unavailable.provisional, true);
  assert.equal(unavailable.basis, "observed-signals");
});

test("HTTP is monotonic negative evidence except on loopback development pages", () => {
  const shared = {
    coverage: "full-navigation" as const,
    thirdPartyDomainCount: 0,
    trackers: [],
    cookies: cookies(),
  };
  const https = calculatePrivacyScore({ ...shared, protocol: "https:" as const, hostname: "example.test" });
  const http = calculatePrivacyScore({ ...shared, protocol: "http:" as const, hostname: "example.test" });
  assert.equal(https.value, 100);
  assert.equal(http.value, 90);
  assert.ok(http.value <= https.value);
  assert.equal(
    calculatePrivacyScore({ ...shared, protocol: "http:" as const, hostname: "localhost" }).value,
    100,
  );
});

test("unknown domains receive only the generic cross-site exposure deduction", () => {
  const score = calculatePrivacyScore({
    ...baseInput,
    thirdPartyDomainCount: 1,
    trackers: [],
    cookies: cookies(),
  });
  assert.equal(score.value, 99);
  assert.deepEqual(score.deductions.map((deduction) => deduction.code), ["third-party-exposure"]);
});
