# TraceLens architecture

## Runtime components

### Background page

`src/background/index.ts` owns the sensitive lifecycle. It registers listeners at startup and holds in-memory state:

- `AnalysisStore`: one aggregate session per observed tab
- `DocumentRegistry`: up to 1,000 live/recent frame attribution nodes per tab, cleared with that tab's session
- temporary Blob URLs: one per active user-requested download, revoked on completion/interruption or after five minutes

A pending-navigation map holds a destination hostname, observation time, transient request ID, and ordering flags between a main-frame request and commit. Firefox can deliver that request callback on either side of navigation callbacks. Redirects with the same request ID update the destination; ambiguous overlapping navigations mark coverage partial. When the main-request callback arrives after commit, TraceLens confirms full-navigation coverage only if Firefox's event timestamp proves the request began before that same-host commit, `onBeforeNavigate` was observed, the document ID still matches, and no other coverage limitation intervened. A genuinely later or otherwise uncorrelated request remains partial. Coverage is informational and never gates the observed-evidence score. Failed navigations discard pending state and prior analysis.

The background also keeps one salted SHA-256 fingerprint of the current document location per live tab. This lets it distinguish an effective same-document route change from a page calling `history.replaceState()` with the already-current URL. The original URL is not retained, and the fingerprint is replaced or deleted at the next effective navigation boundary.

### Analysis core

`src/core/analysisStore.ts` parses each request URL and immediately drops everything except a normalized domain and aggregate counters. Third-party findings are collapsed to a registrable domain. A known tracker is collapsed to its canonical bundled rule domain. This avoids keeping potentially identifying random subdomain labels.

The public-suffix implementation and rules are compiled into `background.js`. No classification lookup leaves Firefox.

Sessions are capped at 1,000 detailed third-party domains per tab. Additional requests still count toward totals but do not create more domain entries. Reaching either the domain or document-node limit makes coverage partial. UUID nodes for replaced frames and descendants are removed; detached nodes are bounded and expire with the session.

### Content script

`src/content/index.ts` does no continuous collection. It responds only to a targeted message from the background page while a report is being prepared. It queries a fixed allowlist of permission descriptors without calling any permission-gated API and without triggering a prompt.

### Popup

The popup requests a copy of the current tab's report and renders with `textContent` and created DOM nodes. While visible, it requests a new local snapshot once per second so the score follows newly observed signals without a scan action. It never uses `innerHTML`. Closing the popup destroys its copy and timer.

### Export

`src/core/export.ts` constructs a new export DTO field by field. It never serializes an internal session object. JSON uses `JSON.stringify` on that allowlisted DTO. HTML escapes every dynamic string and contains no script or remote resource.

## Navigation model

1. The first main-request or `onBeforeNavigate` event deletes the old session and document tree.
2. A transient pending marker tolerates request/navigation event reordering; redirects update it.
3. `onCommitted` starts a clean session for the final document ID. A main-request callback delivered after commit can confirm the boundary only through its earlier Firefox event timestamp and matching recent commit record. A request that actually began after commit, an absent request, or an ambiguous request gives partial coverage.
4. Resource events are accepted only through the current document tree. Old, cached, and unattributed documents are excluded. No browsing request is blocked or modified.
5. History and fragment events clear aggregates and start partial coverage only when the current document location changes. A no-op History API update preserves the existing session; errors never restore prior analysis.

Async snapshots validate lifecycle revision, document ID, current URL, and session generation around cookie/permission queries. Permission messages target the exact document ID. Save requests must match the generation shown by the popup. Browser metadata is optional where Firefox omits a lifecycle field; document identity remains mandatory (Firefox 153+).

## Score model

Coverage remains part of every report but does not control score availability. Score model 2.0 always starts from 100 and subtracts only supported deductions from the current aggregate snapshot, with a zero floor. The progressive third-party-domain component retains separation between light (up to 10), moderate (11–30), and heavy (31–60+) cross-site reach. Bundled-list tracker domains are normalized, deduplicated, and scored once in their behavior category; raw request repetition is not scored. Cookie deductions use only available aggregate flag counts. Unavailable cookie metadata contributes no cookie deductions. The score carries an explicit `observed-signals` basis, and its provisional flag records partial request coverage or unavailable cookie evidence without hiding the numeric value.

TraceLens has a non-blocking `webRequest.onBeforeRequest` listener. It neither reads another extension's settings nor requests `webRequestBlocking`. A content blocker can suppress page code and therefore prevent follow-on requests from ever being generated; Firefox may also notify TraceLens of an attempted request before another handler cancels or redirects it. The report consequently describes observed request attempts, not confirmed delivery and not an audit of blocker effectiveness.

## Trust boundaries

- Web pages are untrusted.
- Report/save messages require both the extension's own sender ID and the exact packaged popup URL. Web content cannot forge these browser-provided fields.
- All runtime scripts are packaged.
- The extension CSP denies outbound connections from extension pages.
- The only intentional write outside memory is the browser download initiated by the user.
