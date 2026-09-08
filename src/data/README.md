# Bundled tracker database

TraceLens ships a deliberately small, local tracker database. Rich, reviewable source records live in `trackerProvenance.json`; `npm run data:generate` turns them into the minimal runtime-only `trackerDatabase.ts`. Firefox never fetches rules or evidence and the extension archive does not contain the provenance JSON or generator.

The 2026-09-06 release review reduced the original unprovenanced seed from 51 rules to seven provider-documented rules. The complete disposition is in `SEED_AUDIT.md`.

## Provenance schema

Every source entry contains:

- a stable kebab-case ID;
- a normalized lowercase ASCII domain;
- the organization/provider and one TraceLens category;
- at least one evidence record with type, title, public HTTPS URL, and verification date;
- a classification/domain-scope explanation; and
- a provenance method, external-dataset redistribution flag, and ownership/licensing note.

Schema 1.0 accepts only manual factual curation and requires `redistributesExternalDataset` to be `false`. TraceLens-authored selection, descriptions, and metadata are distributed under the project license. Linked provider documentation remains external and subject to its publisher's terms. A citation is not a copy of its source: no provider prose, code sample, or third-party tracker list is bundled. This describes the project's handling; it is not a legal guarantee about facts or external sites.

No external tracker dataset is redistributed, transformed, or incorporated in the current database. Consequently, there is no dataset attribution notice to add to the runtime package. A future dataset import requires separate license review, including redistribution, modification, attribution, compatibility, version, integrity hash, and transformation requirements, plus a schema/pipeline change reviewed before any data enters the extension.

## Evidence and classification standard

Rules match only an exact hostname or a subdomain at a DNS label boundary, and a rule is reported only when the request is third-party to the current top-level site. A third-party relationship by itself never creates a tracker classification. Unknown third parties remain explicitly unclassified.

Prefer evidence in this order:

1. provider technical or privacy documentation that names the exact domain and behavior;
2. reputable privacy/security research that directly supports the exact scope;
3. a reviewed public dataset only when its license and required notices permit the proposed redistribution and modification.

Random blogs, forums, SEO pages, domain-name inference, company reputation, and third-party status are insufficient. Broad company, platform, CDN, and shared-service domains need especially strong scope evidence. Categories describe the documented service behavior, not every activity of an organization:

- `advertising`: cross-site ad selection, delivery, attribution, conversion measurement, or exchange infrastructure;
- `analytics`: site measurement or behavioral analytics;
- `social`: social-platform reporting, conversion, retargeting, or audience infrastructure;
- `fingerprinting`: a service whose documented purpose includes device/browser fingerprinting;
- `other`: supported cross-site identity correlation or tracking that does not fit the preceding categories.

## Contributor workflow

1. Add or edit the complete record in `trackerProvenance.json`; never edit `trackerDatabase.ts` directly.
2. Confirm the evidence is public, authoritative, current enough, and explicitly supports the precise domain and category.
3. Explain domain scope and false-positive risk in original words. Do not paste source prose, code, lists, or browsing data.
4. Record the verification date and accurately state whether any external dataset is involved. Schema 1.0 rejects dataset redistribution.
5. Run `npm run data:validate`, then `npm run data:generate`, and inspect the generated diff.
6. Run `npm run data:check`, typecheck, lint, tests, score properties, build, Firefox validation, and the real-browser smoke test.

`data:validate` checks schema shape, required strings, dates, evidence type/URL, provenance policy, normalized registrable domains, IDs, categories, and duplicates. `data:generate` validates and deterministically sorts category/domain/ID before writing the runtime file. `data:check` validates again and fails when generated output is stale. The normal build and CI both run `data:check`, so unsupported or ungenerated changes cannot silently ship.

## Known limitations and updates

Seven rules provide high confidence, not comprehensive tracker coverage. Domain matching cannot recognize CNAME cloaking, path-specific or first-party-hosted tracking, newly introduced services, or behavioral differences within a matched parent domain. A retained provider could also change endpoints or documentation after its verification date.

Database updates are reviewed code/data changes, not automatic feeds. Reverify evidence before each release and whenever a cited page or provider behavior changes. Prefer removing or narrowing a questionable rule over retaining an unsupported classification. Runtime fetching, remote classifiers, telemetry, and automatic updates remain prohibited.
