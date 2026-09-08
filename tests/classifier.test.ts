import assert from "node:assert/strict";
import test from "node:test";

import { classifyTracker, validateTrackerDatabase } from "../src/core/classifier.ts";

test("matches bundled tracker rules on exact and subdomain hosts", () => {
  assert.deepEqual(classifyTracker("stats.google-analytics.com"), {
    id: "google-analytics",
    domain: "google-analytics.com",
    company: "Google",
    category: "analytics",
  });
  assert.equal(classifyTracker("google-analytics.com.attacker.example"), null);
  assert.equal(classifyTracker("ordinary.example"), null);
  assert.equal(classifyTracker("adnxs.com"), null);
});

test("bundled tracker database contains no duplicate ids or domains", () => {
  assert.deepEqual(validateTrackerDatabase(), []);
});

test("database validation reports conflicting entries", () => {
  const badRules = [
    { id: "one", domain: "tracker.example", company: "One", category: "analytics" as const },
    { id: "one", domain: "tracker.example", company: "Two", category: "advertising" as const },
  ];
  assert.deepEqual(validateTrackerDatabase(badRules), [
    "Duplicate tracker id: one",
    "Duplicate tracker domain: tracker.example (one and one)",
  ]);
});
