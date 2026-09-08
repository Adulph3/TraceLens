# TraceLens

TraceLens is a Firefox-first, local privacy analyzer for understanding the privacy signals a page exposes while you browse. It observes current-page request metadata, distinguishes known tracker domains from unknown third parties, summarizes current-site cookie flags and browser permission states, and produces an explainable observed-evidence score.

TraceLens is an MVP under active pre-1.0 development. It does not detect every tracker, certify that a site is safe, or prove that an observed request was delivered.

The MVP is deliberately ephemeral:

> Your browsing analysis stays in memory and is discarded automatically. Reports are only saved when you explicitly export them.

There is no backend, account, telemetry, analytics, cloud processing, remote classifier, runtime AI/API call, runtime dependency/data download, browsing-history collection, or automatic report history. TraceLens does not capture cookie values, request bodies, authentication data, or request headers.

## Why TraceLens exists

Browser privacy behavior is difficult to inspect without developer tools, and raw network logs can expose more browsing data than a user wants to retain. TraceLens reduces current-tab observations immediately to bounded, domain-level aggregates and explains how those observations affect its score. Analysis is temporary by default; the only persistence path is an explicit local **Save Report** action.

## What the MVP analyzes

- Total, first-party, and third-party requests attributed to each tab
- Known advertising, analytics, social, fingerprinting, and other tracking domains
- Unknown third-party domains, clearly kept separate from proven tracker matches
- Current-site cookie metadata counts (never cookie names or values)
- Geolocation, notification, camera, and microphone permission status where Firefox exposes it without prompting
- A live, explainable score from 0–100 based only on signals observed so far

TraceLens never asks Firefox for request bodies or headers. It immediately reduces each observed URL to a domain and does not retain paths, query strings, fragments, credentials, titles, or favicons.

## Run locally

Requirements: Node.js 22.18+ and Firefox Desktop 153+. Document-specific request attribution and permission messaging require Firefox 153 APIs. The MVP is desktop-first because Firefox Android does not support the user-facing `saveAs` download picker used by **Save Report**.

```sh
npm ci
npm run data:check
npm run build
npm start
```

Or load `dist/manifest.json` from `about:debugging` → **This Firefox** → **Load Temporary Add-on** after running `npm run build`.

Useful checks:

```sh
npm run typecheck
npm run lint
npm test
npm run data:validate
npm run data:generate
npm run data:check
npm run build
npm run validate:firefox
npm run test:firefox
npm run package
```

`npm run package` writes the unsigned extension archive to `artifacts/`.

## Development status

- Firefox Desktop 153+ is the current supported browser target.
- The extension uses Firefox Manifest V2 and a persistent in-memory background page intentionally.
- Privacy Score 2.0 is stable for the MVP and remains an observed-evidence heuristic, not a universal site rating.
- Tracker coverage is a seven-rule, provider-documented seed set generated from validated per-entry provenance.
- The project is public on GitHub but has not been submitted to Mozilla Add-ons.

## Architecture

```text
Firefox request/navigation events
          │
          ▼
Persistent background page
  Map<tabId, temporary session>
          │
          ├── bundled tracker rules
          ├── bundled public-suffix data
          ├── on-demand cookie flag summary
          └── on-demand page permission query
          │
          ▼
Popup snapshot ── explicit Save Report ──► local JSON or HTML download
```

The Firefox-only MVP uses Manifest V2 intentionally. Firefox continues to support it, and its persistent background page lets analysis live in a plain JavaScript `Map` until the tab, browser, or extension session ends. Manifest V3 in Firefox uses unloadable event pages; avoiding data loss there would require `storage.session`. TraceLens requests no storage permission and never calls any browser storage API.

Rich tracker evidence stays in the source tree. A deterministic validation/generation step emits only ID, domain, company, and category into the runtime database. The build bundles all TypeScript, minimal tracker rules, and public-suffix data. Extension CSP sets `connect-src 'none'`, so extension pages cannot initiate remote network connections.

## Data lifecycle

```text
Top-level navigation starts  → delete that tab's prior session
Top-level navigation commits → create a new document session
Effective history/fragment route changes → reset aggregates; label coverage partial
No-op History API update   → preserve the current document session
Observed request             → keep domain-only aggregate in the tab session
Popup opens                  → create a read-only snapshot and refresh it while visible
Popup closes                 → popup snapshot disappears
Tab closes/replaces          → delete the tab session immediately
Session idle for one hour    → delete the tab session
Extension reload/restart     → JavaScript memory disappears naturally
Browser restart              → JavaScript memory disappears naturally
Save Report                  → build allowlisted export, download locally,
                               revoke temporary Blob URL, retain no export copy
```

If TraceLens starts after a page has already loaded, a page is restored without an observed main request, navigation attribution is ambiguous, or a safety limit is reached, it labels coverage as partial while still calculating a score from observed evidence. Effective History API/fragment route changes clear prior-route aggregates and begin a new observed-evidence score. A History API call that leaves both the document ID and URL unchanged is not a navigation and preserves the session. A failed navigation never restores the old report. If cookie metadata is unavailable, cookie deductions are omitted and the score continues from other observed signals. Unsupported permission descriptors are disclosed and are never scored.

## Score model 2.0

Every current observed-evidence score starts at 100 and loses points only for signals TraceLens has actually observed:

- Unencrypted HTTP: 10 points (loopback development hosts excluded)
- Unique third-party exposure, capped at 30: the first 10 domains cost 1 each; domains 11–30 cost 1 per 2 (rounded up within that band); domains 31–60 cost 1 per 3 (rounded up within that band)
- Unique bundled-list fingerprinting tracker domains: first 3 cost 7 each, then 1 each, cap 38
- Unique bundled-list advertising tracker domains: first 3 cost 6 each, then 1 each, cap 35
- Unique bundled-list social tracker domains: first 3 cost 5 each, then 1 each, cap 32
- Unique bundled-list analytics tracker domains: first 3 cost 4 each, then 1 each, cap 29
- Unique bundled-list other tracker domains: first 2 cost 3 each, then 1 each, cap 24
- Persistent cookies: 1 per 2 (rounded up), cap 5
- `SameSite=None` cookies: 1 each, cap 6
- Cookies without `Secure` on HTTPS: 1 each, cap 4

The score is `max(0, 100 − the sum of displayed deductions)`. Third-party reach and known tracker behavior are separate concerns, so a tracker domain contributes to the progressive third-party component and to exactly one category component. Tracker inputs are deduplicated by normalized domain; request repetition does not multiply tracker points. Permission status, total request volume, secure/HTTP-only/partitioned cookie counts, and unknown tracker intent are not scored. Unknown third parties receive only the generic cross-site exposure deduction and are never described as trackers.

Every applied deduction, the total, and the exact equation are displayed and exported. Coverage is informational and never gates the numeric score. A high score may reflect limited evidence; the score is not a complete or final site rating and does not prove a site safe. Browser privacy tools and content blockers can change which request attempts are generated or observed. TraceLens does not inspect or bypass them and cannot reliably prove whether an `onBeforeRequest` observation was later delivered, canceled, redirected, or blocked. While the popup is visible, it requests a fresh local snapshot once per second so newly observed signals update the score without a scan action.

## Save Report

Saving is optional and begins only when the user clicks **Save Report**. JSON and self-contained static HTML are supported. The explicit export allowlist contains:

- Hostname and analysis timestamps
- Observation coverage
- Observed score, observed-signals basis, model version, disclaimer, and each deduction
- Aggregate request counts and resource-type counts
- Known tracker domains, companies, categories, evidence type, and request counts
- Third-party registrable domains, classification, and request counts
- Aggregate cookie flag counts
- Supported page permission states and their caveat
- Privacy notice and product limitations

It never contains full URLs, paths, query parameters, cookie names or values, headers, authorization data, request/response bodies, form data, local storage, session storage, tab IDs, document IDs, cookie-store IDs, or request IDs. The HTML export has no scripts or remote resources and carries its own restrictive CSP. Saving a stale displayed report is rejected; refresh after navigation before saving.

Firefox and the operating system may keep the user-chosen downloaded file and normal download-history metadata. TraceLens does not retain a second copy.

## Firefox permissions

| Permission | Why it is required |
| --- | --- |
| `webRequest` | Observe domain, type, and tab attribution for requests; never headers, bodies, blocking, or modification. |
| `*://*/*` | See both the page origin and arbitrary web subresource origins. This excludes local `file:` browsing. |
| `cookies` | Read an on-demand cookie object list for the current page and immediately reduce it to flag counts. |
| `webNavigation` | Reset on navigation start, commit, and effective history/fragment route changes; identify the current document and its frames. |
| `downloads` | Create a local JSON or HTML file after the user clicks **Save Report**. |

Private browsing is disabled for the MVP. There are no `storage`, `history`, `tabs`, `scripting`, `webRequestBlocking`, `nativeMessaging`, or `downloads.open` permissions.

## Known limitations

- `webRequest` is not retroactive; a late-started observation can miss earlier traffic, but its numeric score remains available and is explicitly marked partial.
- The seven-rule tracker database is intentionally small and cannot identify every tracker; it favors precise provider-documented scope over breadth.
- Domain matching cannot detect CNAME cloaking, path-based endpoints, first-party-hosted trackers, or unknown tracking services.
- Firefox does not reliably attribute every browser/service-worker request to a tab.
- Requests without a recognized live document are excluded; totals describe observed requests, including attempts Firefox may subsequently block. They do not prove delivery or reveal transmitted contents.
- Content blockers can prevent page code and follow-on requests from being generated, while an early `onBeforeRequest` event can describe an attempt that another extension later cancels or redirects. Scores compare TraceLens observations, not blocker effectiveness or confirmed network delivery.
- Each tab is capped at 1,000 domain details and 1,000 document attribution nodes. Reaching a cap marks coverage partial; the score continues from retained observed evidence. Tabs idle for an hour are purged by a once-per-minute sweep.
- Cookie metadata covers cookies applicable to the current top-level page, not all third-party cookies involved in its load.
- Permission status does not show whether a page requested or used a capability, and some descriptors are unsupported on some pages.
- Firefox restricted/internal pages cannot be analyzed.
- The MVP's opt-in export flow targets Firefox Desktop; Firefox Android rejects downloads that request the `saveAs` picker.

See [Privacy](docs/PRIVACY.md), [Architecture](docs/ARCHITECTURE.md), [Security](SECURITY.md), [dependency and supply-chain policy](docs/DEPENDENCIES.md), the [tracker database policy](src/data/README.md), and the [original seed audit](src/data/SEED_AUDIT.md) for more detail.

## Development validation security

The shipped dependency tree contains only bundled `tldts`/`tldts-core`. `web-ext` and `addons-linter` are development tools and are excluded from the extension. Their current `image-size` dependency has parser denial-of-service advisories with no patched release in the installed line. `npm run validate:firefox` preloads a guard that disables ICNS, JXL (both variants), and HEIF parsing before the validator runs. TraceLens uses SVG icons. The full npm audit still reports this development-only chain; the runtime-only audit is clean. Use the guarded validation command for this project.

The Firefox smoke command uses a disposable profile and a loopback fixture server. It never opens the user's normal profile. See [the engineering report](docs/ENGINEERING_REPORT.md) for executed checks and remaining limitations.

## Contributing and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes, especially tracker database or privacy-architecture changes. Community participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and sensitive vulnerability reports should follow [SECURITY.md](SECURITY.md).

TraceLens source is available under the [MIT License](LICENSE). Bundled third-party notices are recorded separately in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
