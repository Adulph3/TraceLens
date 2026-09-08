import { readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { domainToASCII, fileURLToPath, pathToFileURL, URL } from "node:url";

import { getDomain } from "tldts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const provenancePath = join(root, "src/data/trackerProvenance.json");
export const runtimeDatabasePath = join(root, "src/data/trackerDatabase.ts");

export const TRACKER_CATEGORIES = Object.freeze([
  "advertising",
  "analytics",
  "social",
  "fingerprinting",
  "other",
]);

export const EVIDENCE_TYPES = Object.freeze([
  "provider-technical-documentation",
  "provider-privacy-documentation",
  "reputable-research",
  "licensed-dataset",
]);

const EXPECTED_TOP_LEVEL_KEYS = ["entries", "reviewedAt", "schemaVersion"];
const EXPECTED_ENTRY_KEYS = [
  "category",
  "domain",
  "evidence",
  "id",
  "note",
  "organization",
  "provenance",
];
const EXPECTED_EVIDENCE_KEYS = ["title", "type", "url", "verifiedAt"];
const EXPECTED_PROVENANCE_KEYS = ["method", "note", "redistributesExternalDataset"];
const CATEGORY_ORDER = new Map(TRACKER_CATEGORIES.map((category, index) => [category, index]));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function isNonemptyString(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

export function normalizeDomain(value) {
  if (typeof value !== "string") {
    return "";
  }

  return domainToASCII(value.trim().toLowerCase().replace(/\.+$/u, ""));
}

function isValidDomain(domain) {
  if (domain.length > 253 || !domain.includes(".") || isIP(domain) !== 0) {
    return false;
  }

  const labels = domain.split(".");
  if (labels.some((label) =>
    label.length === 0 ||
    label.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
  )) {
    return false;
  }

  return getDomain(domain, { allowPrivateDomains: true }) !== null;
}

function addError(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validateTrackerProvenance(data) {
  const errors = [];
  if (!hasExactKeys(data, EXPECTED_TOP_LEVEL_KEYS)) {
    return ["root: expected exactly schemaVersion, reviewedAt, and entries"];
  }

  if (data.schemaVersion !== "1.0") {
    addError(errors, "schemaVersion", "must equal 1.0");
  }
  if (!isIsoDate(data.reviewedAt)) {
    addError(errors, "reviewedAt", "must be a real YYYY-MM-DD date");
  }
  if (!Array.isArray(data.entries) || data.entries.length === 0) {
    addError(errors, "entries", "must be a non-empty array");
    return errors;
  }

  const ids = new Map();
  const domains = new Map();
  data.entries.forEach((entry, index) => {
    const path = `entries[${index}]`;
    if (!hasExactKeys(entry, EXPECTED_ENTRY_KEYS)) {
      addError(errors, path, `expected exactly ${EXPECTED_ENTRY_KEYS.join(", ")}`);
      return;
    }

    if (!isNonemptyString(entry.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.id)) {
      addError(errors, `${path}.id`, "must be a normalized kebab-case identifier");
    } else if (ids.has(entry.id)) {
      addError(errors, `${path}.id`, `duplicates ${ids.get(entry.id)}`);
    } else {
      ids.set(entry.id, path);
    }

    const normalizedDomain = normalizeDomain(entry.domain);
    if (!isNonemptyString(entry.domain) || normalizedDomain !== entry.domain) {
      addError(errors, `${path}.domain`, "must already be lowercase ASCII without whitespace or a trailing dot");
    } else if (!isValidDomain(entry.domain)) {
      addError(errors, `${path}.domain`, "must be a valid registrable domain or service hostname");
    } else if (domains.has(entry.domain)) {
      addError(errors, `${path}.domain`, `duplicates ${domains.get(entry.domain)}`);
    } else {
      domains.set(entry.domain, path);
    }

    if (!isNonemptyString(entry.organization)) {
      addError(errors, `${path}.organization`, "must be a non-empty string");
    }
    if (!TRACKER_CATEGORIES.includes(entry.category)) {
      addError(errors, `${path}.category`, `must be one of ${TRACKER_CATEGORIES.join(", ")}`);
    }
    if (!isNonemptyString(entry.note)) {
      addError(errors, `${path}.note`, "must explain the classification and exact domain scope");
    }

    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      addError(errors, `${path}.evidence`, "must contain at least one evidence reference");
    } else {
      entry.evidence.forEach((evidence, evidenceIndex) => {
        const evidencePath = `${path}.evidence[${evidenceIndex}]`;
        if (!hasExactKeys(evidence, EXPECTED_EVIDENCE_KEYS)) {
          addError(errors, evidencePath, `expected exactly ${EXPECTED_EVIDENCE_KEYS.join(", ")}`);
          return;
        }
        if (!EVIDENCE_TYPES.includes(evidence.type)) {
          addError(errors, `${evidencePath}.type`, `must be one of ${EVIDENCE_TYPES.join(", ")}`);
        }
        if (!isNonemptyString(evidence.title)) {
          addError(errors, `${evidencePath}.title`, "must be a non-empty string");
        }
        try {
          const url = new URL(evidence.url);
          if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
            throw new Error("not a public HTTPS reference");
          }
        } catch {
          addError(errors, `${evidencePath}.url`, "must be a public HTTPS URL without credentials");
        }
        if (!isIsoDate(evidence.verifiedAt)) {
          addError(errors, `${evidencePath}.verifiedAt`, "must be a real YYYY-MM-DD date");
        } else if (isIsoDate(data.reviewedAt) && evidence.verifiedAt > data.reviewedAt) {
          addError(errors, `${evidencePath}.verifiedAt`, "cannot be later than reviewedAt");
        }
      });
    }

    if (!hasExactKeys(entry.provenance, EXPECTED_PROVENANCE_KEYS)) {
      addError(errors, `${path}.provenance`, `expected exactly ${EXPECTED_PROVENANCE_KEYS.join(", ")}`);
    } else {
      if (entry.provenance.method !== "manual-factual-curation") {
        addError(errors, `${path}.provenance.method`, "must equal manual-factual-curation for schema 1.0");
      }
      if (entry.provenance.redistributesExternalDataset !== false) {
        addError(errors, `${path}.provenance.redistributesExternalDataset`, "schema 1.0 does not permit external dataset redistribution");
      }
      if (!isNonemptyString(entry.provenance.note)) {
        addError(errors, `${path}.provenance.note`, "must explain ownership and redistribution status");
      }
    }
  });

  return errors;
}

export function runtimeRulesFromProvenance(data) {
  return data.entries
    .map((entry) => ({
      id: entry.id,
      domain: entry.domain,
      company: entry.organization,
      category: entry.category,
    }))
    .sort((left, right) =>
      CATEGORY_ORDER.get(left.category) - CATEGORY_ORDER.get(right.category) ||
      compareAscii(left.domain, right.domain) ||
      compareAscii(left.id, right.id)
    );
}

export function generateRuntimeDatabase(data) {
  const errors = validateTrackerProvenance(data);
  if (errors.length > 0) {
    throw new Error(`Tracker provenance validation failed:\n${errors.join("\n")}`);
  }

  const rows = runtimeRulesFromProvenance(data).map((rule) =>
    `  ${JSON.stringify(rule)},`
  );
  return [
    "// Generated by scripts/generate-tracker-database.mjs from trackerProvenance.json.",
    "// Do not edit this runtime-only file directly; run `npm run data:generate`.",
    'import type { TrackerRule } from "../shared/types.ts";',
    "",
    "export const TRACKER_DATABASE: readonly TrackerRule[] = [",
    ...rows,
    "] as const;",
    "",
  ].join("\n");
}

export async function readTrackerProvenance() {
  return JSON.parse(await readFile(provenancePath, "utf8"));
}

async function main() {
  const mode = process.argv[2];
  if (!["--validate", "--write", "--check"].includes(mode) || process.argv.length !== 3) {
    throw new Error("Usage: node scripts/generate-tracker-database.mjs --validate|--write|--check");
  }

  const data = await readTrackerProvenance();
  const generated = generateRuntimeDatabase(data);
  if (mode === "--write") {
    await writeFile(runtimeDatabasePath, generated, "utf8");
  } else if (mode === "--check") {
    const current = await readFile(runtimeDatabasePath, "utf8");
    if (current !== generated) {
      throw new Error("Generated tracker database is stale; run `npm run data:generate`");
    }
  }

  process.stdout.write(`Tracker provenance valid: ${data.entries.length} rules (${mode.slice(2)}).\n`);
}

const invokedPath = process.argv[1] === undefined ? "" : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  await main();
}
