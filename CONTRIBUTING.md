# Contributing to TraceLens

Thank you for helping improve TraceLens. The project is a Firefox-first, local-only privacy analyzer, so privacy properties are product requirements rather than optional implementation details.

## Prerequisites

- Node.js 24 LTS is recommended; Node.js 22.18 or newer is supported by the package configuration.
- npm, using the committed `package-lock.json`.
- Firefox Desktop 153 or newer for the real-browser test.

Install exactly the locked dependency graph:

```sh
npm ci
```

Do not use `npm install` merely to run the project: it can rewrite the lockfile. A deliberate dependency update should include and explain its lockfile changes.

## Development commands

```sh
npm run typecheck
npm run lint
npm test
npm run test:score
npm run data:validate
npm run data:generate
npm run data:check
npm run build
npm run validate:firefox
npm run test:firefox
```

`npm run build` recreates `dist/`. To try the result manually, open `about:debugging` in Firefox, select **This Firefox**, choose **Load Temporary Add-on**, and select `dist/manifest.json`.

`npm run test:firefox` launches a disposable Firefox profile and loopback fixture. It must never point at or modify a contributor's normal browser profile. `npm run package` creates an unsigned local archive under the ignored `artifacts/` directory; it does not publish anything.

## Coding expectations

- Keep TypeScript strict, lint-clean, and covered by focused tests.
- Preserve deterministic behavior and explicit failure states.
- Keep untrusted strings out of `innerHTML`; use DOM creation and `textContent`.
- Keep runtime dependencies minimal and review both their licenses and transitive graph.
- Do not commit generated `dist/`, archives, coverage, profiles, logs, or exported reports.
- Update architecture, privacy, security, and limitation documentation when behavior changes.
- Avoid site-specific scoring exceptions. Score changes need invariant/property tests and a clear mathematical explanation.

## Non-negotiable privacy constraints

TraceLens analysis must remain local and memory-only by default. Contributions must not add:

- a backend, telemetry, analytics, cloud processing, remote AI, or runtime classification API;
- automatic browsing-history, URL, report, or analysis persistence;
- request/response bodies, request headers, authorization data, cookie names or values, form data, or browser-storage collection;
- automatic export or synchronization;
- remote executable code or remotely updated tracker logic.

Reports may be persisted only after the user explicitly selects **Save Report**, and they must remain local. Any proposal for remote networking, telemetry, external APIs, or broader sensitive-data access requires explicit architectural and privacy review before implementation; compatibility with TraceLens's core rules must be demonstrated, not assumed.

## Tracker database changes

Read `src/data/README.md` before proposing a rule. Edit `trackerProvenance.json`, never the generated runtime file. Every addition or correction must include authoritative public evidence, provenance, the verification date, expected organization/category, exact domain scope, licensing considerations, an original explanation, and tests. Run the data validation/generation/check sequence and inspect the generated change. Do not submit source prose, source code, third-party lists, URLs from private browsing, screenshots, logs, or exports that expose browsing activity.

Unknown third parties must remain unknown unless evidence supports a bundled classification. Schema 1.0 rejects external dataset redistribution. Do not import a third-party protection list until its exact license, redistribution and modification rights, attribution requirements, compatibility, version, integrity hash, update process, and deterministic transformation pipeline have been reviewed and the provenance schema has been deliberately extended.

## Issues and pull requests

Before opening an issue, search for an existing report and reduce the problem to non-sensitive reproduction steps. Never attach real exported reports or browsing logs without sanitizing them.

Pull requests should:

1. Explain the problem and scope.
2. Describe privacy, security, and data-lifecycle effects.
3. Include tests for behavior changes.
4. Update relevant documentation.
5. Pass the complete validation sequence above.
6. Keep unrelated formatting or dependency changes out of the patch.

Security vulnerabilities and sensitive privacy failures belong in the private process described in `SECURITY.md`, not in a public issue.
