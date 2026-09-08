import { TRACKER_DATABASE } from "../data/trackerDatabase.ts";
import { hostnameMatchesDomain } from "../shared/domains.ts";
import type { TrackerRule } from "../shared/types.ts";

const RULES_BY_SPECIFICITY = [...TRACKER_DATABASE].sort(
  (left, right) => right.domain.length - left.domain.length,
);

export function classifyTracker(hostname: string): TrackerRule | null {
  return RULES_BY_SPECIFICITY.find((rule) => hostnameMatchesDomain(hostname, rule.domain)) ?? null;
}

export function validateTrackerDatabase(
  rules: readonly TrackerRule[] = TRACKER_DATABASE,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const domains = new Map<string, TrackerRule>();

  for (const rule of rules) {
    if (ids.has(rule.id)) {
      errors.push(`Duplicate tracker id: ${rule.id}`);
    }
    ids.add(rule.id);

    const prior = domains.get(rule.domain);
    if (prior !== undefined) {
      errors.push(
        `Duplicate tracker domain: ${rule.domain} (${prior.id} and ${rule.id})`,
      );
    }
    domains.set(rule.domain, rule);
  }

  return errors;
}
