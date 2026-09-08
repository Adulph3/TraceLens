import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import {
  generateRuntimeDatabase,
  normalizeDomain,
  readTrackerProvenance,
  runtimeRulesFromProvenance,
  validateTrackerProvenance,
} from "../scripts/generate-tracker-database.mjs";
import { TRACKER_DATABASE } from "../src/data/trackerDatabase.ts";

const validData = await readTrackerProvenance();

function cloneData() {
  return JSON.parse(JSON.stringify(validData));
}

test("every runtime rule is generated from valid source provenance", () => {
  assert.deepEqual(validateTrackerProvenance(validData), []);
  assert.deepEqual(TRACKER_DATABASE, runtimeRulesFromProvenance(validData));
});

test("source domains normalize predictably and non-normalized entries are rejected", () => {
  assert.equal(normalizeDomain(" Stats.GOOGLE-ANALYTICS.com... "), "stats.google-analytics.com");

  const data = cloneData();
  data.entries[0].domain = "DOUBLECLICK.NET.";
  assert.match(validateTrackerProvenance(data).join("\n"), /must already be lowercase ASCII/u);
});

test("duplicate domains and ids are rejected", () => {
  const data = cloneData();
  data.entries.push(cloneData().entries[0]);
  const errors = validateTrackerProvenance(data).join("\n");
  assert.match(errors, /\.id: duplicates/u);
  assert.match(errors, /\.domain: duplicates/u);
});

test("malformed domains and invalid categories are rejected", () => {
  const data = cloneData();
  data.entries[0].domain = "invalid..example";
  data.entries[0].category = "tracking";
  const errors = validateTrackerProvenance(data).join("\n");
  assert.match(errors, /must be a valid registrable domain or service hostname/u);
  assert.match(errors, /must be one of advertising, analytics, social, fingerprinting, other/u);
});

test("missing evidence and incomplete provenance are rejected", () => {
  const withoutEvidence = cloneData();
  withoutEvidence.entries[0].evidence = [];
  assert.match(validateTrackerProvenance(withoutEvidence).join("\n"), /at least one evidence/u);

  const incomplete = cloneData();
  delete incomplete.entries[0].provenance.note;
  assert.match(validateTrackerProvenance(incomplete).join("\n"), /provenance: expected exactly/u);
});

test("runtime generation is deterministic and excludes build-time provenance", async () => {
  const first = generateRuntimeDatabase(validData);
  const second = generateRuntimeDatabase(cloneData());
  assert.equal(first, second);
  assert.equal(first, await readFile(new URL("../src/data/trackerDatabase.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(first, /https:\/\//u);
  assert.doesNotMatch(first, /"(?:verifiedAt|provenance|evidence)":/u);
});
