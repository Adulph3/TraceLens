import assert from "node:assert/strict";
import test from "node:test";

import { AnalysisStore } from "../src/core/analysisStore.ts";
import { emptyCookieSummary } from "../src/core/cookies.ts";
import {
  buildPrivacyReport,
  createPermissionSummary,
  normalizePermissionState,
  unavailablePermissionSummary,
} from "../src/core/report.ts";

test("report exposes only aggregate session data and separates unknown domains", () => {
  const store = new AnalysisStore(() => 1_000);
  store.commitNavigation(42, "https://shop.example/path?secret=yes", "document-42", true);
  store.recordResource({
    tabId: 42,
    topLevelDocumentId: "document-42",
    type: "script",
    url: "https://doubleclick.net/ad?user=secret",
  });
  store.recordResource({
    tabId: 42,
    topLevelDocumentId: "document-42",
    type: "image",
    url: "https://images.ordinary-cdn.test/pixel?token=secret",
  });
  const snapshot = store.snapshot(42);
  assert.ok(snapshot);

  const report = buildPrivacyReport(
    snapshot,
    emptyCookieSummary("available"),
    unavailablePermissionSummary(),
    2_000,
  );

  assert.equal(report.hostname, "shop.example");
  assert.equal(report.counts.trackers, 1);
  assert.equal(report.counts.advertising, 1);
  assert.equal(report.counts.unknownThirdPartyDomains, 1);
  assert.equal(report.thirdParties[0]?.classification, "known-tracker");
  assert.equal(report.thirdParties[1]?.classification, "unknown-third-party");
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes('"tabId"'), false);
  assert.equal(serialized.includes('"generation"'), false);
  assert.equal(serialized.includes('"documentId"'), false);
});

test("partial coverage and unavailable cookies remain informational score metadata", () => {
  const store = new AnalysisStore(() => 1_000);
  store.commitNavigation(7, "https://partial.example/", "document-7", false);
  store.recordResource({
    tabId: 7,
    topLevelDocumentId: "document-7",
    type: "script",
    url: "https://doubleclick.net/ad",
  });
  const snapshot = store.snapshot(7);
  assert.ok(snapshot);

  const report = buildPrivacyReport(
    snapshot,
    emptyCookieSummary("unavailable"),
    unavailablePermissionSummary(),
    2_000,
  );
  assert.equal(report.observation.coverage, "partial");
  assert.match(report.observation.note, /Partial observation/u);
  assert.equal(report.score.value, 93);
  assert.equal(report.score.basis, "observed-signals");
  assert.equal(report.score.provisional, true);
  assert.deepEqual(
    report.score.deductions.map((deduction) => deduction.code),
    ["third-party-exposure", "advertising-trackers"],
  );
});

test("normalizes the Notifications API default state as prompt", () => {
  assert.equal(normalizePermissionState("default"), "prompt");
  assert.equal(normalizePermissionState("granted"), "granted");
  assert.equal(normalizePermissionState("unexpected"), "unsupported");
});

test("permission summary reports available, partial, and unavailable honestly", () => {
  const available = createPermissionSummary([
    { name: "geolocation", state: "prompt" },
    { name: "notifications", state: "denied" },
  ]);
  assert.equal(available.status, "available");

  const partial = createPermissionSummary([
    { name: "geolocation", state: "granted" },
    { name: "camera", state: "unsupported" },
  ]);
  assert.equal(partial.status, "partial");

  const unavailable = createPermissionSummary([
    { name: "camera", state: "unsupported" },
    { name: "microphone", state: "unavailable" },
  ]);
  assert.equal(unavailable.status, "unavailable");
});
