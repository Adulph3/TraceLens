# v0.1.0 seed-rule provenance audit

Review date: 2026-09-06

This ledger records the disposition of all 51 rules that existed before TraceLens added per-entry provenance. The original file supplied a domain, company, and category but no evidence, selection date, source manifest, or derivation history. Git history could not fill that gap because the project had no commits.

`Retained` means the exact domain and category are now supported by provider documentation in `trackerProvenance.json`. `Removed` means that this review did not establish evidence strong and precise enough for the original rule scope and category. Removal is not a claim that the domain is harmless; it remains unknown to TraceLens unless a later evidence-backed contribution adds it.

| Original domain | Original category | Decision | Audit reason |
| --- | --- | --- | --- |
| `doubleclick.net` | Advertising | Retained | Google documents domain cookies and user matching in real-time advertising bidding. |
| `googlesyndication.com` | Advertising | Retained | Google documents its subdomain as the source of AdSense ad tags. |
| `googleadservices.com` | Advertising | Retained | Google Ads documents conversion-measurement requests to this domain. |
| `adnxs.com` | Advertising | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `adsrvr.org` | Advertising | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `criteo.com` | Advertising | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `criteo.net` | Advertising | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `taboola.com` | Advertising | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `outbrain.com` | Advertising | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `rubiconproject.com` | Advertising | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `openx.net` | Advertising | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `pubmatic.com` | Advertising | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `amazon-adsystem.com` | Advertising | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `casalemedia.com` | Advertising | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `smartadserver.com` | Advertising | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `yieldmo.com` | Advertising | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `teads.tv` | Advertising | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `sharethrough.com` | Advertising | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `media.net` | Advertising | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `google-analytics.com` | Analytics | Retained | Google documents Google Analytics event collection at subdomains of this domain. |
| `googletagmanager.com` | Analytics | Removed | A tag-container request alone does not establish tracker behavior or the behavior of tags it may load. |
| `segment.com` | Analytics | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `segment.io` | Analytics | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `mixpanel.com` | Analytics | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `amplitude.com` | Analytics | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `hotjar.com` | Analytics | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `clarity.ms` | Analytics | Retained | Microsoft documents the Clarity tracking-code collection endpoint on this domain. |
| `nr-data.net` | Analytics | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `fullstory.com` | Analytics | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `heap.io` | Analytics | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `mouseflow.com` | Analytics | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `luckyorange.com` | Analytics | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `quantserve.com` | Analytics | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `chartbeat.com` | Analytics | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `scorecardresearch.com` | Analytics | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `connect.facebook.net` | Social | Removed | Provider privacy documentation supported Meta Pixel behavior, but this review did not establish a provider citation tying that behavior to this exact hostname. |
| `facebook.com` | Social | Removed | The broad platform domain would classify ordinary Facebook resources as trackers. |
| `platform.twitter.com` | Social | Removed | A functional social-widget request alone is insufficient to establish tracker behavior. |
| `syndication.twitter.com` | Social | Removed | A functional social-widget request alone is insufficient to establish tracker behavior. |
| `ads-twitter.com` | Social | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `snap.licdn.com` | Social | Retained | LinkedIn documents this as an Insight Tag domain used for reporting, retargeting, and audience insights. |
| `ct.pinterest.com` | Social | Removed | No qualifying exact-domain evidence was recorded in the source or established for this release review. |
| `analytics.tiktok.com` | Social | Removed | The located provider endpoint documentation was explicitly marked outdated, so it was not used as current release evidence. |
| `fingerprint.com` | Fingerprinting | Removed | The broad provider-site scope did not prove that every matching subdomain performs browser fingerprinting. |
| `fingerprintjs.com` | Fingerprinting | Removed | The broad provider-site scope did not prove that every matching subdomain performs browser fingerprinting. |
| `demdex.net` | Other known tracker | Retained | Adobe documents the domain's Audience Manager and identity-service data synchronization and ID requests. |
| `krxd.net` | Other known tracker | Removed | No qualifying exact-domain identity-correlation evidence was recorded in the source or established for this release review. |
| `rlcdn.com` | Other known tracker | Removed | No qualifying exact-domain identity-correlation evidence was recorded in the source or established for this release review. |
| `liveramp.com` | Other known tracker | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `tapad.com` | Other known tracker | Removed | The broad provider-site scope was not justified by exact service-endpoint evidence. |
| `id5-sync.com` | Other known tracker | Removed | No qualifying exact-domain identity-correlation evidence was recorded in the source or established for this release review. |

## Totals

- Original rules: 51
- Retained unchanged: 7
- Category or domain corrections: 0
- Removed: 44
- Newly added: 0
- Final runtime rules: 7

The review intentionally did not import an external tracker dataset. Provider pages are linked as evidence; their prose, code examples, and databases are not copied into TraceLens.
