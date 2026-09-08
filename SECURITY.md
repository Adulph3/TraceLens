# Security policy

TraceLens processes browsing-related metadata, so vulnerabilities that expose, retain, mix, or transmit that data are treated as security issues.

## Supported versions

TraceLens is currently pre-1.0. Until a stable release policy exists, only the latest code on the default branch and the newest published release, if any, are supported with security fixes. Older snapshots may not receive patches.

## Reporting a vulnerability

Use GitHub's **Private vulnerability reporting** feature for the eventual repository when it is available. Do not open a public issue containing exploit details or sensitive data.

If private vulnerability reporting is not yet enabled, open a minimal public issue asking a maintainer to establish a private contact channel. Include no vulnerability details, secrets, real browsing data, cookie material, private URLs, or identifying screenshots in that issue. The project currently publishes no dedicated security email address.

A useful private report includes:

- affected version or commit;
- impact and affected privacy/security guarantee;
- minimal reproduction using synthetic or public test data;
- relevant platform and Firefox version;
- a suggested fix, if known.

Never collect additional user data to demonstrate an issue. Remove tokens, cookie values, private hostnames, query strings, profile paths, and account information before sharing diagnostics.

## Sensitive issues

Examples include:

- browsing domains, URLs, cookies, headers, credentials, or reports leaving the device unexpectedly;
- analysis surviving navigation, tab closure, extension shutdown, or another documented deletion boundary;
- cross-tab or cross-document data mixing;
- report export without explicit user action;
- script injection, unsafe HTML generation, or message-sender authorization bypass;
- unauthorized remote code, telemetry, analytics, backend, cloud, or AI/API communication;
- extraction of cookie values, authorization headers, request bodies, or browser-storage contents;
- dependency or build compromise affecting the shipped archive.

## Responsible disclosure

Please allow maintainers a reasonable opportunity to reproduce, fix, and validate an issue before public disclosure. Maintainers should minimize access to submitted material, communicate remediation status when practical, credit reporters who request credit, and publish an appropriately scoped advisory after a fix is available. No response-time guarantee is offered while the project is pre-1.0.
