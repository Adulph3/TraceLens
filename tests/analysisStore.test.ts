import assert from "node:assert/strict";
import test from "node:test";

import { AnalysisStore } from "../src/core/analysisStore.ts";

test("aggregates per-tab requests without retaining full URLs", () => {
  let now = 1_000;
  const store = new AnalysisStore(() => now);
  assert.equal(
    store.commitNavigation(
      7,
      "https://shop.example.co.uk/product?secret=yes",
      "document-7",
      true,
    ),
    true,
  );

  now += 1;
  assert.equal(
    store.recordResource({
      tabId: 7,
      topLevelDocumentId: "document-7",
      url: "https://cdn.example.co.uk/image.png?user=42",
      type: "image",
    }),
    true,
  );
  assert.equal(
    store.recordResource({
      tabId: 7,
      topLevelDocumentId: "document-7",
      url: "https://stats.google-analytics.com/collect?uid=sensitive",
      type: "xmlhttprequest",
    }),
    true,
  );
  assert.equal(
    store.recordResource({
      tabId: 7,
      topLevelDocumentId: "document-7",
      url: "https://assets.unlisted-service.test/script.js?token=x",
      type: "script",
    }),
    true,
  );

  const snapshot = store.snapshot(7);
  assert.ok(snapshot);
  assert.equal(snapshot.totalRequests, 4);
  assert.equal(snapshot.firstPartyRequests, 2);
  assert.equal(snapshot.thirdPartyRequests, 2);
  assert.deepEqual(snapshot.requestsByType, {
    main_frame: 1,
    image: 1,
    xmlhttprequest: 1,
    script: 1,
  });
  assert.deepEqual(snapshot.thirdParties, [
    {
      domain: "google-analytics.com",
      requestCount: 1,
      classification: "known-tracker",
      company: "Google",
      category: "analytics",
    },
    {
      domain: "unlisted-service.test",
      requestCount: 1,
      classification: "unknown-third-party",
    },
  ]);
  assert.equal(JSON.stringify(snapshot).includes("sensitive"), false);
  assert.equal(JSON.stringify(snapshot).includes("/collect"), false);
});

test("never calls an unknown third party a tracker", () => {
  const store = new AnalysisStore(() => 10);
  store.commitNavigation(1, "https://first.example/", "document-1", true);
  store.recordResource({
    tabId: 1,
    topLevelDocumentId: "document-1",
    url: "https://new-service.invalid/x",
    type: "script",
  });
  assert.equal(store.snapshot(1)?.thirdParties[0]?.classification, "unknown-third-party");
});

test("navigation atomically resets the previous report, including same-host reloads", () => {
  let now = 100;
  const store = new AnalysisStore(() => now);
  store.commitNavigation(3, "https://one.example/a", "document-a", true);
  store.recordResource({
    tabId: 3,
    topLevelDocumentId: "document-a",
    url: "https://doubleclick.net/a",
    type: "script",
  });
  const firstGeneration = store.snapshot(3)?.generation;

  now = 200;
  store.commitNavigation(3, "https://one.example/b", "document-b", true);
  const reloaded = store.snapshot(3);
  assert.ok(reloaded);
  assert.notEqual(reloaded.generation, firstGeneration);
  assert.equal(reloaded.totalRequests, 1);
  assert.deepEqual(reloaded.thirdParties, []);

  now = 300;
  store.commitNavigation(3, "https://two.example/", "document-c", false);
  const changed = store.snapshot(3);
  assert.ok(changed);
  assert.equal(changed.hostname, "two.example");
  assert.equal(changed.totalRequests, 0);
  assert.equal(changed.coverage, "partial");
});

test("partial sessions are explicit and never replace a matching full session", () => {
  const store = new AnalysisStore(() => 50);
  const partial = store.ensurePartialSession(
    9,
    "https://already-loaded.example/private?q=x",
    "document-partial",
  );
  assert.equal(partial?.coverage, "partial");
  assert.equal(
    store.ensurePartialSession(
      9,
      "https://already-loaded.example/other",
      "document-partial",
    )?.generation,
    partial?.generation,
  );

  store.commitNavigation(9, "https://already-loaded.example/", "document-full", true);
  assert.equal(
    store.ensurePartialSession(
      9,
      "https://already-loaded.example/",
      "document-full",
    )?.coverage,
    "full-navigation",
  );
});

test("late main confirmation upgrades only the untouched commit-created partial state", () => {
  const store = new AnalysisStore(() => 50);
  store.commitNavigation(1, "https://ordered.example/", "document-1", false, true);
  assert.equal(store.confirmLateMainRequest(1, "document-1"), true);
  assert.equal(store.snapshot(1)?.coverage, "full-navigation");
  assert.equal(store.snapshot(1)?.totalRequests, 1);

  store.commitNavigation(2, "https://limited.example/", "document-2", false, true);
  store.markPartial(2);
  assert.equal(store.confirmLateMainRequest(2, "document-2"), false);
  assert.equal(store.snapshot(2)?.coverage, "partial");

  store.commitNavigation(3, "https://wrong-document.example/", "document-3", false, true);
  assert.equal(store.confirmLateMainRequest(3, "stale-document"), false);
  assert.equal(store.snapshot(3)?.coverage, "partial");
});

test("tab close, unsupported navigation, and expiry destroy in-memory state", () => {
  let now = 1_000;
  const store = new AnalysisStore(() => now);
  store.commitNavigation(1, "https://one.example/", "document-1", true);
  store.commitNavigation(2, "https://two.example/", "document-2", true);
  assert.equal(store.size, 2);

  store.remove(1);
  assert.equal(store.snapshot(1), null);
  assert.equal(store.commitNavigation(2, "about:config", "document-2b", false), false);
  assert.equal(store.snapshot(2), null);

  store.commitNavigation(3, "https://three.example/", "document-3", true);
  now = 10_000;
  assert.equal(store.removeExpired(5_000), 1);
  assert.equal(store.size, 0);
});

test("stale async snapshots can be detected by generation", () => {
  const store = new AnalysisStore(() => 1);
  store.commitNavigation(5, "https://first.example/", "document-first", true);
  const snapshot = store.snapshot(5);
  assert.ok(snapshot);
  store.commitNavigation(5, "https://second.example/", "document-second", true);
  assert.equal(store.isCurrent(5, snapshot.generation, snapshot.documentId), false);
});

test("rejects resources from a stale or unattributed top-level document", () => {
  const store = new AnalysisStore(() => 1);
  store.commitNavigation(6, "https://current.example/", "current-document", true);

  assert.equal(
    store.recordResource({
      tabId: 6,
      topLevelDocumentId: "stale-document",
      url: "https://doubleclick.net/late",
      type: "script",
    }),
    false,
  );
  assert.equal(store.snapshot(6)?.totalRequests, 1);
});
