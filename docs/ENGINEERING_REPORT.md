# TraceLens MVP engineering report

Date: 2026-09-06

## Recovered state

At resumption, the repository already contained the TypeScript Firefox extension, in-memory request aggregation, public-suffix party detection, a bundled tracker seed list, cookie and permission summaries, deterministic scoring, popup UI, allowlisted JSON/HTML exports, core unit tests, build configuration, and privacy documentation. The interrupted work was navigation/document isolation and a popup accessibility pass. The generated `dist/` directory lagged behind source changes.

The workspace initially had an empty `.git` path rather than repository metadata. A local `main` repository was initialized during release preparation, but it still has no commits and no remotes. All source remains uncommitted and nothing has been published.

## Completed MVP behavior

- Firefox 153+ Manifest V2 extension with a persistent, memory-only background page.
- Per-tab request counts reduced immediately to resource type and registrable-domain aggregates.
- First-party/third-party determination from bundled public-suffix data.
- Known advertising, analytics, social, and other tracker matches from a seven-rule provider-documented bundled list; unmatched third parties remain unknown. The category model still supports future fingerprinting rules, but no fingerprinting rule met this release's evidence threshold.
- Current-page unpartitioned and top-level-partition cookie flag summaries, including a First-Party Isolation retry. Names and values are projected away immediately.
- On-demand geolocation, notification, camera, and microphone permission status without prompting. Unsupported or unavailable states are explicit and permissions are not scored.
- Deterministic live 0–100 score with an explanation and cap for every deduction observed so far. Partial coverage and unavailable cookie evidence are disclosed without hiding the number.
- Responsive, keyboard-aware popup with once-per-second local live refresh, compact observation status, visible limitations, complete hostname wrapping, tracker/third-party details, and a working score ring.
- Explicit local Save Report flow for static HTML and JSON. Each export is rebuilt from current background state through a field allowlist; stale popup generations are rejected.

## Runtime architecture and lifecycle

`background/index.ts` owns all sensitive state. `AnalysisStore` keeps one bounded aggregate session per tab. `DocumentRegistry` keeps a bounded live document hierarchy so late requests cannot cross a navigation boundary. Short-lived pending-request and recent-commit records reconcile Firefox request/navigation callback reordering and mark overlaps incomplete. A main-request callback delivered after commit confirms complete coverage only when its Firefox event timestamp proves the request began before the same-host commit, navigation-start was observed, the document still matches, and no other coverage limitation intervened. Blob URLs exist only for explicit exports.

Navigation follows this lifecycle:

1. A top-level request or navigation-start event deletes the prior tab session and document tree.
2. Commit creates a fresh session tied to Firefox's document UUID.
3. Subresource events count only when their live document hierarchy reaches that UUID.
4. Effective History and fragment route changes reset route aggregates and start partial coverage. A same-document event whose document ID and salted current-location fingerprint are unchanged is a no-op and preserves the observed navigation.
5. Navigation failure, tab close/replacement, host-permission removal, one-hour inactivity, extension unload, or browser exit deletes applicable memory state.
6. Popup cookie/permission reads are accepted only if document, URL, and generation still match afterward.

No browser storage API, IndexedDB, local/session storage, backend, or automatic report history is used.

### Tracker database provenance resolution

The original 51-rule seed supplied domains, companies, and categories without per-entry evidence, selection dates, or reproducible derivation. Because there was no earlier Git history and no named source dataset, those classifications could not be treated as inherited provenance. The 2026-09-06 audit retained seven unchanged rules with provider documentation that names the exact domain and supports the category; 44 unsupported or overbroad rules were removed. No rules were corrected or added. `src/data/SEED_AUDIT.md` records every disposition.

`src/data/trackerProvenance.json` is now the human-review source. Each record includes normalized domain, category, organization, evidence title/type/URL/date, an exact-scope explanation, and a provenance/redistribution statement. The records are manual factual curation: TraceLens does not copy provider prose or code and does not import, transform, or redistribute any external tracker dataset. External documentation remains at its source and under its publisher's terms.

`scripts/generate-tracker-database.mjs` validates exact schema shape, IDs, DNS normalization and registrability, categories, evidence URLs/types/dates, duplicates, and the no-dataset-redistribution policy. It deterministically sorts and emits only the four runtime fields. `data:check` detects stale output and runs in both the build and CI. Evidence URLs and tooling are absent from the extension package, and Firefox performs no rule or provenance network request.

### weather.com incomplete-evidence defect

Aggregate-only instrumentation in a disposable Firefox profile reproduced the reported state on weather.com. Firefox delivered one main request, one top-level navigation start, and one matching document commit, so the navigation boundary was fully observed. The page then emitted a top-level `onHistoryStateUpdated` event whose document ID and URL were unchanged. TraceLens treated every History API notification as a new route, discarded the complete generation, and created a partial generation. Repeated reload testing also exposed an intermittent callback order where Firefox delivered the main-request listener after `onCommitted`, even though its event timestamp showed that the request began first.

The fix preserves a session only for a cryptographically matched no-op same-document event. A real path, query, or fragment change still clears route aggregates and starts partial coverage. Commit-before-request delivery can confirm the boundary only through an earlier Firefox event timestamp, an observed navigation start, matching hostname/document, and an untouched commit-created partial state. Counts alone never promote coverage, genuinely late requests remain partial, stale document IDs cannot confirm another document, and any independent coverage limitation disables promotion.

### Observed-evidence scoring redesign

The previous model compressed materially different sites into similar scores. Its generic third-party component reached a 15-point ceiling at only 15 unique domains, so 15 and 74 domains were identical. Tracker categories were merged into one opaque 60-point pool, and the three cookie components saturated after only five matching cookies each. Those early plateaus obscured the difference between moderate and heavy observed exposure.

Score model 2.0 still calculates a number for every supported current-page snapshot, including partial observations and reports without cookie metadata. It subtracts only evidence present in that snapshot. Coverage remains visible metadata, and `score.provisional` identifies partial coverage or missing cookies without suppressing `score.value`. Every score carries the machine-readable `observed-signals` basis and warns that a high score can reflect limited evidence.

The popup replaces the former blocking “Incomplete evidence” state with a compact partial-observation or cookie-unavailable notice. While visible it refreshes from the local background once per second, updating the score, counts, deductions, and export generation as new evidence arrives. No scan or page reload is required.

## Firefox permissions

| Permission | MVP use |
| --- | --- |
| `webRequest` | Observe request target, type, tab, request identity during navigation, and document attribution. No headers, bodies, blocking, or modification. |
| `*://*/*` | Observe supported HTTP(S) pages and their arbitrary HTTP(S)/WebSocket subresources; inject the permission-status content script on web pages. |
| `cookies` | Read cookie objects applicable to the current page on demand and immediately reduce them to flag counts. |
| `webNavigation` | Delete/reset analysis at navigation boundaries, follow document/frame UUIDs, and verify the current document. |
| `downloads` | Start a local HTML/JSON file only after Save Report and monitor completion so the Blob URL can be revoked. |

Private browsing is disabled. The extension requests no `storage`, `history`, `tabs`, `scripting`, `webRequestBlocking`, native messaging, clipboard, or telemetry permission. Firefox exposes limited tab metadata to extension pages without the optional `tabs` permission when host access applies.

## Privacy score 2.0

Every current observed-evidence score starts at 100 and applies deterministic caps only to available signals:

- HTTP outside loopback: 10
- unique third-party domains, cap 30: first 10 × 1; next 20 × 0.5 rounded up within the band; next 30 × one-third rounded up within the band
- fingerprinting tracker domains: first 3 × 7, then 1 each, cap 38
- advertising tracker domains: first 3 × 6, then 1 each, cap 35
- social tracker domains: first 3 × 5, then 1 each, cap 32
- analytics tracker domains: first 3 × 4, then 1 each, cap 29
- other tracker domains: first 2 × 3, then 1 each, cap 24
- persistent cookies: 1 per 2 rounded up, cap 5
- `SameSite=None` cookies: 1 each, cap 6
- non-Secure cookies applicable to HTTPS: 1 each, cap 4

The exact equation is `max(0, 100 − sum(displayed deductions))`. The popup and both export formats show the baseline, every component, the raw deduction total, and the final equation. The steep first part of each tracker curve reflects category severity; the one-point tail keeps 1, 5, and 20 unique domains distinct without unbounded linear growth. At 1/5/20 domains, deductions are fingerprinting 7/23/38, advertising 6/20/35, social 5/17/32, analytics 4/14/29, and other 3/9/24. The respective caps are reached at 20 domains, preserving the category ordering at each checkpoint.

Tracker findings are normalized and deduplicated by domain before category scoring. Request repetition does not multiply tracker points. Third-party reach and known tracker behavior are separate observed concerns, so a known tracker participates in the generic bounded reach curve and exactly one behavior-category curve. Unknown domains receive only the generic third-party deduction and are never called trackers. Total request volume, permission status, secure/HTTP-only/partitioned cookie counts, and unsupported inferences are not scored. The three cookie components represent distinct longevity, cross-site-context, and transport-flag risks; the same underlying cookie can possess more than one independent flag, but no flag count is reused in another component.

Unavailable cookie metadata adds no cookie deductions. Coverage remains report metadata and sets `provisional`, but never gates the score. Request observations represent attempts; they do not prove delivery or reveal contents. TraceLens listens non-blockingly at [`webRequest.onBeforeRequest`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onBeforeRequest), which fires before headers and is also the stage at which a blocking handler can cancel or redirect. TraceLens does not request blocking capability, inspect another extension, or bypass it. uBlock Origin documents that it uses `webRequestBlocking` to stop matching connections in its [permissions documentation](https://github.com/gorhill/ublock/wiki/Permissions). TraceLens cannot reliably distinguish another handler's later cancellation/redirect from delivery, and a blocker can prevent page code from generating follow-on attempts. Therefore blocker comparisons explain the score through the evidence TraceLens actually observed, not through an assumed blocker state.

Synthetic profiles verify ordering: sparse 100 > low 86 > moderate 44 > extreme 0. The extreme profile's displayed raw deductions can exceed 100; the documented zero floor remains mathematically explicit.

While the popup is visible, it requests a fresh current-tab report once per second. These messages remain inside the extension; they create no storage or network connection. New current-document requests and cookie metadata therefore update the displayed score automatically, without a scan button or reload.

## Save Report and data minimization

The background generates a fresh report only after the popup's Save Report action. The export allowlist includes hostname, timestamps, coverage, observed-signals score basis/value/deductions, aggregate requests, known tracker and third-party registrable domains, cookie flag counts, permission states, caveats, and limitations. It excludes full URLs and paths, query/fragment data, cookie names/values, headers, bodies, credentials, form/browser-storage values, and internal tab/document/request/store IDs.

HTML output escapes every dynamic string, contains no script or remote asset, and embeds a restrictive CSP. The Blob URL is revoked on completed/interrupted download, checked once immediately to close the terminal-event race, and has a five-minute fallback expiry. Firefox and the operating system control the user-chosen file and normal download-history metadata.

## Security, privacy, and performance review

- No `fetch`, `XMLHttpRequest`, runtime WebSocket/EventSource client, beacon, remote script, `eval`, `Function`, `innerHTML` assignment, storage API, telemetry, analytics SDK, AI API, external logging, rule updater, or evidence fetch exists in runtime source.
- Extension CSP denies outbound connections from extension pages. All executable code, tracker data, and public-suffix data are packaged.
- Report/save messages require the browser-provided extension ID and exact popup URL. Permission queries target the exact live document. Async results and stale save generations fail closed.
- HTML export escapes dynamic text; JSON/HTML both copy fields explicitly.
- Request URLs are parsed and immediately reduced; no headers or bodies are requested. Cookie objects are immediately projected to booleans/counts.
- Sessions and domain/document detail maps are bounded. Request work is constant-time aside from public-suffix parsing and a small local tracker-list lookup. Cleanup runs once per minute.
- The obvious-secret scan found no private keys, provider token prefixes, bearer credentials, or assigned API/access secrets.
- Runtime production dependencies (`tldts` and `tldts-core`) have no npm advisories. The full development tree reports three high findings from `web-ext` → `addons-linter` → `image-size` 2.0.2. The dependency has no patched release for the two parser denial-of-service advisories. It is absent from the extension archive, and project validation preloads a tested guard that disables ICNS, JXL/JXL-stream, and HEIF parsing. Replace/remove the guard when upstream ships a fixed line.

## Verification executed

- `npm run data:validate`: pass, seven complete source provenance records
- `npm run data:generate`: pass, deterministic minimal runtime database regenerated
- `npm run data:check`: pass, generated output current
- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm test`: pass, 62 declared tests across 12 test files including provenance-pipeline, background integration, and validator-guard coverage
- `npm run test:score`: pass; category curves check 0/1/5/20, exhaustive monotonic count sweeps, caps, duplicate domains, request repetition, score bounds, cookies, third parties, and synthetic ordering
- `npm run build`: pass
- `npm run validate:firefox`: pass, 0 errors, 0 warnings, 0 notices
- `npm run test:firefox`: pass on Firefox 154.0.1 using a disposable profile and loopback fixture
- Real-Firefox observed-score validation: pass; the visible popup changed from 100 to 99 after delayed third-party evidence without a manual refresh, displayed a numeric score for partial coverage, and retained numeric scores through fresh navigation, normal reload, and cache-bypassing reload
- The remote-site observations below were recorded before the provenance cleanup and are historical engineering evidence, not expected counts for the current seven-rule database.
- Simple-site validation: example.com produced 1 request, 0 third-party domains, 0 trackers, 0 cookies (and 0 scored cookie flags), score 100, full-navigation coverage
- YouTube without uBlock: settled fresh-load observation contained 35 requests, 15 third-party requests across 6 domains, 1 advertising tracker domain, and 7 cookies (6 persistent, 5 `SameSite=None`, 0 non-Secure), score 80. Coverage was partial and remained informational.
- YouTube with asserted-active uBlock Origin 1.74.0: settled fresh-load observation contained 41 request attempts, 21 third-party requests across 7 domains, 1 advertising tracker domain, and the same 7 cookies (6 persistent, 5 `SameSite=None`, 0 non-Secure), score 79. Coverage was partial. The one-point difference follows the one additional unique domain TraceLens observed; it is not a claim that those attempts were delivered. Individual live loads vary.
- Tracker-heavy weather.com validation: the settled fresh-load snapshot contained 214 requests, 114 third-party requests across 36 domains, 11 trackers (8 advertising, 2 analytics, 1 other), and 21 cookies (20 persistent, 0 `SameSite=None`, 15 non-Secure), score 35, full-navigation coverage
- Popup layout validation: actual Firefox toolbar panel content measured 420×280px; the full document used 420×600px with vertical scrolling, and the constrained reflow case passed at 320px without horizontal overflow
- `npm run package`: pass; unsigned `artifacts/tracelens-0.1.0.zip` is 76,849 bytes, includes only the 11 required built extension entries, project license, and third-party notice, and passes `unzip -t`
- Archive/source parity and privacy scan: pass; all packaged files match `dist`, all seven generated runtime domains are present, sampled removed domains are absent, and no provenance JSON/tooling/evidence URL, absolute local path, secret candidate, remote URL, or executable outbound-network primitive is packaged
- `npm audit --omit=dev`: pass, 0 runtime vulnerabilities
- full `npm audit`: 3 acknowledged development-only high findings described above

The Firefox smoke test exercises real top-level and iframe traffic, a delayed third-party signal and automatic score update, cookie projection, permissions, full and partial score UI, no-op History API handling, normal/cache-bypassing reloads, popup rendering, score arc, refresh focus, actual-panel sizing, 420px desktop and 320px constrained layouts, top-level and fragment reset, stale-save rejection, and tab-close cleanup. Its optional URL argument also checks a real remote page in the disposable profile without retaining a trace.

## Remaining product limitations

- Score model 2.0 is a transparent product heuristic, not an externally calibrated probability of harm or regulatory compliance rating. Its category labels are only as complete and current as the bundled seed list.
- The seven-rule tracker seed is deliberately conservative. It cannot detect every tracker, CNAME cloaking, path-based services, first-party-hosted tracking, or infer intent from an unknown domain. Evidence must be reverified as provider documentation and endpoints evolve.
- Category and third-party caps intentionally compress very large observations; counts beyond each ceiling remain visible even when they no longer lower the score.
- `webRequest` is not retroactive and Firefox does not associate every browser/service-worker request with a tab/document. Unattributable events are excluded and make coverage partial when they intersect a tracked session.
- Cookie totals are a current-page metadata snapshot, not a network cookie log; third-party cookies not applicable to the top-level URL are outside this MVP view.
- Permission state cannot show whether a capability was requested or used.
- Same-document route/fragment resets remain partial and discard prior-route aggregates; their numeric score starts again from the evidence observed for the new route.
- Save Report is desktop-first because Firefox Android does not support the requested save picker behavior.

## Recommended next milestone

Reverify every tracker citation before the next release and expand coverage only through equally precise evidence. If a public protection list is ever proposed, extend the currently manual-only schema only after its exact license, redistribution and modification rights, attribution, source version/hash, and deterministic transformation are reviewed. Then add broader Firefox compatibility testing and signed-release automation without introducing runtime networking or persistence.

## Release readiness decision

**TRACKER PROVENANCE BLOCKER: RESOLVED.** Every bundled runtime rule has a validated source record and provider evidence, unsupported seed rules were removed, and no third-party tracker dataset is redistributed. The project is locally ready for its first Git commit and subsequent public GitHub publication after maintainer review. No commit, remote, push, publication, upload, or AMO submission was performed.
