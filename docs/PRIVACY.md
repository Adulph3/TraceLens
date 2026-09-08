# TraceLens privacy statement

TraceLens analyzes browsing activity locally inside Firefox. It has no server, telemetry, analytics, advertising, account, synchronization, or cloud feature. It does not transmit browsing data.

## Data processed temporarily

For the current document in an observed tab, TraceLens temporarily holds:

- the top-level hostname and HTTP/HTTPS scheme
- aggregate request totals and resource types
- first-party and third-party counts
- third-party registrable domains and request counts
- bundled-list tracker classification, company, and category
- the start and last-activity times for the current analysis session
- tab/document/frame IDs and a session generation used only to isolate live documents
- a single pending main-request ID, destination hostname, and time per tab to distinguish redirects and ambiguous overlapping navigations
- a runtime-salted SHA-256 fingerprint of the current document location per tab, used only to distinguish a real same-document route change from a no-op History API call

When a report is requested, Firefox's Cookies API necessarily returns complete cookie objects. TraceLens immediately projects those objects to aggregate flag counts and releases them. It never retains or exposes cookie names, values, paths, expiry timestamps, or the original objects.

The packaged content script checks geolocation, notification, camera, and microphone permission status only while preparing a report. It never requests a permission or activates those capabilities.

TraceLens does not inspect, configure, or bypass content blockers. Browser privacy tools can change which request attempts are generated or exposed to its non-blocking listener. The score reflects only the resulting local observations and cannot certify request delivery or blocker effectiveness.

## Data never retained

TraceLens does not retain full visited URLs, paths, query strings, fragments, headers, bodies, credentials, form fields, passwords, titles, favicons, cookie names or values, localStorage, sessionStorage, or a history of prior reports. The current-location fingerprint is one-way, salted freshly each extension runtime, never exported, and removed with its tab session. A pending request's attribution ID is transient and deleted on commit, verified completed-tab reconciliation, failure, tab close, or expiry; there is no request log. All internal attribution IDs are excluded from exports.

TraceLens never uses `browser.storage.local`, `browser.storage.sync`, IndexedDB, localStorage, or another persistent database for analysis.

## Deletion

The current tab session is deleted when:

- a top-level navigation starts (whether the request or navigation event arrives first), and again when a new document commits
- a History API or fragment navigation changes the current route (a no-op call with the unchanged URL is not treated as navigation)
- the tab closes or is replaced
- it has had no observed activity for one hour (checked once per minute)
- web-origin permissions are removed
- the extension unloads, reloads, is disabled, or is removed
- Firefox exits or restarts

All of these states live only in JavaScript memory.

## Optional export

TraceLens creates an export only after the user presses **Save Report** and chooses JSON or HTML. The browser download API writes the sanitized report to the location chosen by the user. The temporary in-memory Blob URL is revoked, and TraceLens retains no export copy or recent-files list.

The export can include the hostname, timestamps, current observed-evidence score and explanations, observation coverage, tracker/company/category findings, third-party domains and counts, aggregate request counts, aggregate cookie metadata, browser permission status, caveats, and limitations. Missing evidence is never extrapolated: unavailable cookie metadata contributes no cookie deductions. A Blob URL is released on completion/interruption, checked immediately after download registration, and subject to a five-minute fallback expiry.

It cannot include cookie names or values, full URLs, sensitive URL parameters, authorization data, headers, bodies, passwords, form data, browser-storage values, or internal tab/request/store identifiers.

The exported file and normal Firefox/operating-system download-history metadata are controlled by the user and browser after export; TraceLens does not delete the file the user chose to save.

## Private browsing

The MVP declares `incognito: not_allowed`, so Firefox does not expose private-window browsing to TraceLens.
