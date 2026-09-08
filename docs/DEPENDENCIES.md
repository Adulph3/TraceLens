# Dependency and supply-chain policy

## Runtime dependency boundary

TraceLens has one direct production package, `tldts` 7.4.11. Its transitive runtime package is `tldts-core` 7.4.11. They provide registrable-domain and public-suffix parsing so TraceLens can compare first- and third-party destinations correctly, including multi-label public suffixes.

The build uses esbuild to compile the required code and public-suffix data into `background.js`. Firefox does not load `node_modules`, contact npm, download rules, or call a dependency service at runtime. The unsigned archive contains only the built extension files, the project `LICENSE`, and `THIRD_PARTY_NOTICES.md`. Both runtime packages are MIT-licensed and their notice is preserved there.

## Tracker evidence references

The tracker database is TraceLens-authored factual curation, not an imported dependency or a redistributed third-party dataset. `src/data/trackerProvenance.json` links to provider technical documentation as evidence; no external prose, code sample, or tracker list is copied into source or the extension archive. Those links are build-time documentation only and are never contacted by the extension. The runtime generator emits no evidence URLs.

The TraceLens-authored selection, explanations, and metadata are covered by the project license. External pages remain under their publishers' terms. The current sources impose no dataset attribution requirement because no dataset is incorporated; provider names and document titles are nevertheless recorded for auditability. This is a description of the current dependency boundary, not a legal guarantee. See `src/data/README.md` for the policy that must be completed before any future dataset import.

`package-lock.json` is part of the reproducible dependency boundary. CI and contributor instructions use `npm ci` rather than resolving a fresh graph.

## Development dependencies

TypeScript, ESLint, esbuild, Firefox type definitions, and Node type definitions are build-time/test-time tools. `web-ext` and its `addons-linter` dependency validate and package the extension. Development dependencies and `node_modules` are not copied into `dist/` or the extension archive.

## Known validator advisory

The current full development audit reports three high-severity findings in `image-size`, reached through `web-ext` → `addons-linter`. [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) covers denial-of-service behavior in the ICNS parser; [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) covers JXL and HEIF parsers. The affected parser is not shipped in TraceLens, and TraceLens uses an SVG icon.

`scripts/validator-guard.cjs` disables the affected ICNS, JXL/JXL-stream, and HEIF parser paths before `web-ext` loads. `tests/validatorGuard.test.mjs` verifies the guard. All supported Firefox validation and packaging commands preload it. This workaround must remain until the upstream dependency graph provides a reviewed fix; removing or bypassing it requires security review.

At the latest local review, `npm audit --omit=dev` reported zero production vulnerabilities. The development findings above remain visible and are not waived as runtime findings.

## Updating dependencies

Dependency updates should:

1. Be narrowly scoped and explain the need.
2. Review package ownership, license, release history, install scripts, and lockfile changes.
3. Run both production and full audits.
4. Run typecheck, lint, unit/property tests, build, guarded Firefox validation, real Firefox smoke, and archive inspection.
5. Confirm that the archive contains no package manager files, development tools, absolute local paths, or unexpected executable code.
