import assert from "node:assert/strict";
import test from "node:test";

import { createExportArtifact } from "../src/core/export.ts";
import type { PrivacyReport } from "../src/shared/types.ts";

const report: PrivacyReport = {
  schemaVersion: "1.0",
  product: "TraceLens",
  hostname: "example.test",
  analyzedAt: "2026-09-04T10:11:12.345Z",
  observation: {
    startedAt: "2026-09-04T10:10:00.000Z",
    coverage: "full-navigation",
    note: "Observed from the start of this top-level navigation.",
  },
  score: {
    version: "2.0",
    basis: "observed-signals",
    baseline: 100,
    value: 96,
    totalDeductions: 4,
    provisional: false,
    deductions: [
      {
        code: "analytics-trackers",
        points: 4,
        count: 1,
        cap: 12,
        explanation: "One tracker & one concern.",
      },
    ],
    disclaimer: "This score reflects observed privacy signals and does not prove that a site is safe.",
  },
  requests: { total: 3, firstParty: 1, thirdParty: 2, byType: { main_frame: 1, script: 2 } },
  counts: {
    trackers: 1,
    advertising: 0,
    analytics: 1,
    social: 0,
    fingerprinting: 0,
    other: 0,
    thirdPartyDomains: 2,
    unknownThirdPartyDomains: 1,
  },
  trackers: [
    {
      domain: "google-analytics.com",
      company: "Google",
      category: "analytics",
      requestCount: 1,
      evidence: "bundled-domain-list",
    },
  ],
  thirdParties: [
    {
      domain: "google-analytics.com",
      requestCount: 1,
      classification: "known-tracker",
      company: "Google",
      category: "analytics",
    },
    { domain: "cdn.test", requestCount: 1, classification: "unknown-third-party" },
  ],
  cookies: {
    status: "available",
    scope: "cookies-applicable-to-current-page",
    total: 1,
    session: 0,
    persistent: 1,
    secure: 1,
    nonSecure: 0,
    httpOnly: 1,
    scriptAccessible: 0,
    hostOnly: 1,
    domainScoped: 0,
    partitioned: 0,
    sameSite: { strict: 1, lax: 0, none: 0, unspecified: 0 },
    caveat: "Metadata only.",
  },
  permissions: {
    source: "page-permissions-api",
    status: "available",
    items: [{ name: "geolocation", state: "prompt" }],
    caveat: "Status only.",
  },
  privacyNotice: "Nothing is automatically retained.",
  limitations: ["A limitation."],
};

test("JSON export uses an explicit allowlist and contains no hidden input fields", () => {
  const hostile = {
    ...report,
    currentUrl: "https://example.test/private?token=secret",
    authorization: "Bearer secret",
    cookies: { ...report.cookies, value: "cookie-secret", name: "session" },
  } as PrivacyReport;

  const artifact = createExportArtifact(hostile, "json");
  assert.equal(artifact.filename, "tracelens-example.test-20260904T101112Z.json");
  assert.equal(artifact.mimeType, "application/json");
  assert.equal(artifact.content.includes("cookie-secret"), false);
  assert.equal(artifact.content.includes("Bearer secret"), false);
  assert.equal(artifact.content.includes("/private"), false);
  assert.equal(artifact.content.includes('"currentUrl"'), false);
  const parsed = JSON.parse(artifact.content) as {
    cookies: object;
    score: { basis: string; value: number };
  };
  assert.equal("value" in parsed.cookies, false);
  assert.equal("name" in parsed.cookies, false);
  assert.equal(parsed.score.basis, "observed-signals");
  assert.equal(parsed.score.value, 96);
  assert.deepEqual(Object.keys(parsed), [
    "schemaVersion",
    "product",
    "hostname",
    "analyzedAt",
    "observation",
    "score",
    "requests",
    "counts",
    "trackers",
    "thirdParties",
    "cookies",
    "permissions",
    "privacyNotice",
    "limitations",
  ]);
});

test("HTML export escapes hostile strings and has no executable or remote content", () => {
  const hostile = {
    ...report,
    hostname: 'evil</title><script src="https://bad.test/x.js"></script>',
    limitations: ['<img src="https://bad.test/pixel" onerror="steal()">'],
  };
  const artifact = createExportArtifact(hostile, "html");
  assert.equal(artifact.mimeType, "text/html");
  assert.equal(artifact.content.includes("<script"), false);
  assert.equal(artifact.content.includes("<img"), false);
  assert.equal(artifact.content.includes("https://bad.test"), true);
  assert.equal(artifact.content.includes("&lt;script"), true);
  assert.match(artifact.content, /Observed third-party domain details/);
  assert.match(artifact.content, /Observed Privacy Score: 96\/100/);
  assert.match(artifact.content, /max\(0, starting score 100 − total deductions 4\) = 96/);
  assert.match(artifact.content, /Unknown third party \(not classified as a tracker\)/);
  assert.match(artifact.content, /Request breakdown/);
  assert.match(artifact.content, /Content-Security-Policy/);
  assert.match(artifact.content, /default-src 'none'; style-src 'unsafe-inline'/);
});
