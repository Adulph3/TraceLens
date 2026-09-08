import type { ExportFormat, PrivacyReport } from "../shared/types.ts";

export interface ExportArtifact {
  content: string;
  filename: string;
  mimeType: "application/json" | "text/html";
}

export function createExportArtifact(
  report: PrivacyReport,
  format: ExportFormat,
): ExportArtifact {
  const safeReport = copyExportFields(report);
  const timestamp = safeReport.analyzedAt.replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  const safeHostname = sanitizeFilenamePart(safeReport.hostname);
  const basename = `tracelens-${safeHostname}-${timestamp}`;

  if (format === "json") {
    return {
      content: `${JSON.stringify(safeReport, null, 2)}\n`,
      filename: `${basename}.json`,
      mimeType: "application/json",
    };
  }

  return {
    content: renderHtmlReport(safeReport),
    filename: `${basename}.html`,
    mimeType: "text/html",
  };
}

function copyExportFields(report: PrivacyReport): PrivacyReport {
  return {
    schemaVersion: report.schemaVersion,
    product: report.product,
    hostname: report.hostname,
    analyzedAt: report.analyzedAt,
    observation: {
      startedAt: report.observation.startedAt,
      coverage: report.observation.coverage,
      note: report.observation.note,
    },
    score: {
      version: report.score.version,
      basis: report.score.basis,
      baseline: report.score.baseline,
      value: report.score.value,
      totalDeductions: report.score.totalDeductions,
      provisional: report.score.provisional,
      deductions: report.score.deductions.map((deduction) => ({
        code: deduction.code,
        points: deduction.points,
        count: deduction.count,
        cap: deduction.cap,
        explanation: deduction.explanation,
      })),
      disclaimer: report.score.disclaimer,
    },
    requests: {
      total: report.requests.total,
      firstParty: report.requests.firstParty,
      thirdParty: report.requests.thirdParty,
      byType: copyRequestTypes(report.requests.byType),
    },
    counts: {
      trackers: report.counts.trackers,
      advertising: report.counts.advertising,
      analytics: report.counts.analytics,
      social: report.counts.social,
      fingerprinting: report.counts.fingerprinting,
      other: report.counts.other,
      thirdPartyDomains: report.counts.thirdPartyDomains,
      unknownThirdPartyDomains: report.counts.unknownThirdPartyDomains,
    },
    trackers: report.trackers.map((tracker) => ({
      domain: tracker.domain,
      company: tracker.company,
      category: tracker.category,
      requestCount: tracker.requestCount,
      evidence: tracker.evidence,
    })),
    thirdParties: report.thirdParties.map((thirdParty) => ({
      domain: thirdParty.domain,
      requestCount: thirdParty.requestCount,
      classification: thirdParty.classification,
      ...(thirdParty.company === undefined ? {} : { company: thirdParty.company }),
      ...(thirdParty.category === undefined ? {} : { category: thirdParty.category }),
    })),
    cookies: {
      status: report.cookies.status,
      scope: report.cookies.scope,
      total: report.cookies.total,
      session: report.cookies.session,
      persistent: report.cookies.persistent,
      secure: report.cookies.secure,
      nonSecure: report.cookies.nonSecure,
      httpOnly: report.cookies.httpOnly,
      scriptAccessible: report.cookies.scriptAccessible,
      hostOnly: report.cookies.hostOnly,
      domainScoped: report.cookies.domainScoped,
      partitioned: report.cookies.partitioned,
      sameSite: {
        strict: report.cookies.sameSite.strict,
        lax: report.cookies.sameSite.lax,
        none: report.cookies.sameSite.none,
        unspecified: report.cookies.sameSite.unspecified,
      },
      caveat: report.cookies.caveat,
    },
    permissions: {
      source: report.permissions.source,
      status: report.permissions.status,
      items: report.permissions.items.map((item) => ({
        name: item.name,
        state: item.state,
      })),
      caveat: report.permissions.caveat,
    },
    privacyNotice: report.privacyNotice,
    limitations: [...report.limitations],
  };
}

function copyRequestTypes(byType: Record<string, number>): Record<string, number> {
  const knownTypes = [
    "beacon",
    "csp_report",
    "font",
    "image",
    "imageset",
    "main_frame",
    "media",
    "object",
    "object_subrequest",
    "other",
    "ping",
    "script",
    "speculative",
    "stylesheet",
    "sub_frame",
    "web_manifest",
    "websocket",
    "xml_dtd",
    "xmlhttprequest",
    "xslt",
  ];
  return Object.fromEntries(
    knownTypes
      .filter((type) => typeof byType[type] === "number")
      .map((type) => [type, byType[type] as number]),
  );
}

function renderHtmlReport(report: PrivacyReport): string {
  const score = `${report.score.value}/100`;
  const trackerRows =
    report.trackers.length === 0
      ? '<tr><td colspan="4">No bundled-list matches observed.</td></tr>'
      : report.trackers
          .map(
            (tracker) =>
              `<tr><td>${escapeHtml(tracker.domain)}</td><td>${escapeHtml(tracker.company)}</td><td>${escapeHtml(tracker.category)}</td><td>${tracker.requestCount}</td></tr>`,
          )
          .join("");
  const deductionItems =
    report.score.deductions.length === 0
      ? "<li>No deductions from the signals currently available.</li>"
      : report.score.deductions
          .map(
            (deduction) =>
              `<li><strong>−${deduction.points}</strong> ${escapeHtml(deduction.explanation)}</li>`,
          )
          .join("");
  const thirdPartyRows =
    report.thirdParties.length === 0
      ? '<tr><td colspan="3">No third-party domains observed.</td></tr>'
      : report.thirdParties
          .map(
            (finding) =>
              `<tr><td>${escapeHtml(finding.domain)}</td><td>${escapeHtml(finding.classification === "known-tracker" ? `Known ${finding.category ?? "other"}` : "Unknown third party (not classified as a tracker)")}</td><td>${finding.requestCount}</td></tr>`,
          )
          .join("");
  const requestTypeRows = Object.entries(report.requests.byType)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([type, count]) =>
        `<tr><td>${escapeHtml(titleCase(type.replace(/_/gu, "-")))}</td><td>${count}</td></tr>`,
    )
    .join("");
  const permissionItems =
    report.permissions.items.length === 0
      ? "<li>Unavailable on this page.</li>"
      : report.permissions.items
          .map(
            (permission) =>
              `<li>${escapeHtml(titleCase(permission.name))}: ${escapeHtml(permission.state)}</li>`,
          )
          .join("");
  const limitationItems = report.limitations
    .map((limitation) => `<li>${escapeHtml(limitation)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>TraceLens report — ${escapeHtml(report.hostname)}</title>
  <style>
    :root { color-scheme: light; font: 16px/1.5 system-ui, sans-serif; color: #172033; background: #f4f7f8; }
    body { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
    header, section { background: white; border: 1px solid #dce5e7; border-radius: 16px; padding: 24px; margin-bottom: 18px; }
    h1, h2 { margin-top: 0; } h1 { color: #0f766e; } .score { font-size: 2.5rem; font-weight: 750; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
    .metric { background: #f0fdfa; border-radius: 10px; padding: 12px; } .metric strong { display: block; font-size: 1.4rem; }
    table { border-collapse: collapse; width: 100%; } th, td { border-bottom: 1px solid #dce5e7; padding: 10px; text-align: left; }
    .notice { border-left: 4px solid #14b8a6; } .muted { color: #526273; }
  </style>
</head>
<body>
  <header>
    <p>TraceLens observed-signals privacy report</p>
    <h1>${escapeHtml(report.hostname)}</h1>
    <div class="score">Observed Privacy Score: ${score}</div>
    <p>${escapeHtml(report.score.disclaimer)}</p>
    <p class="muted">Observation started ${escapeHtml(report.observation.startedAt)} · Report generated ${escapeHtml(report.analyzedAt)} · ${escapeHtml(report.observation.note)}</p>
  </header>
  <section>
    <h2>Observed signals</h2>
    <div class="grid">
      <div class="metric"><strong>${report.requests.total}</strong>Total requests</div>
      <div class="metric"><strong>${report.counts.thirdPartyDomains}</strong>Third parties</div>
      <div class="metric"><strong>${report.counts.trackers}</strong>Known trackers</div>
      <div class="metric"><strong>${report.counts.advertising}</strong>Advertising</div>
      <div class="metric"><strong>${report.counts.analytics}</strong>Analytics</div>
      <div class="metric"><strong>${report.counts.social}</strong>Social tracking</div>
      <div class="metric"><strong>${report.counts.unknownThirdPartyDomains}</strong>Unknown third parties</div>
      <div class="metric"><strong>${report.cookies.status === "available" ? report.cookies.total : "Unavailable"}</strong>Current-site cookies</div>
    </div>
  </section>
  <section><h2>Score explanation</h2><p>max(0, starting score 100 − total deductions ${report.score.totalDeductions}) = ${report.score.value}.</p><ul>${deductionItems}</ul></section>
  <section>
    <h2>Known trackers</h2>
    <table><thead><tr><th>Domain</th><th>Company</th><th>Category</th><th>Requests</th></tr></thead><tbody>${trackerRows}</tbody></table>
  </section>
  <section>
    <h2>Observed third-party domain details</h2>
    <table><thead><tr><th>Domain</th><th>Classification</th><th>Requests</th></tr></thead><tbody>${thirdPartyRows}</tbody></table>
  </section>
  <section>
    <h2>Request breakdown</h2>
    <p>Total ${report.requests.total}; first-party ${report.requests.firstParty}; third-party ${report.requests.thirdParty}.</p>
    <table><thead><tr><th>Resource type</th><th>Requests</th></tr></thead><tbody>${requestTypeRows}</tbody></table>
  </section>
  <section>
    <h2>Cookie metadata</h2>
    <p>${report.cookies.status === "unavailable" ? "Cookie metadata is unavailable; counts are unknown." : `Total ${report.cookies.total}; session ${report.cookies.session}; persistent ${report.cookies.persistent}; secure ${report.cookies.secure}; non-secure ${report.cookies.nonSecure}; HTTP-only ${report.cookies.httpOnly}; script-accessible ${report.cookies.scriptAccessible}; host-only ${report.cookies.hostOnly}; domain-scoped ${report.cookies.domainScoped}; SameSite strict ${report.cookies.sameSite.strict}, lax ${report.cookies.sameSite.lax}, none ${report.cookies.sameSite.none}, unspecified ${report.cookies.sameSite.unspecified}; partitioned ${report.cookies.partitioned}.`}</p>
    <p class="muted">${escapeHtml(report.cookies.caveat)}</p>
  </section>
  <section><h2>Current browser permission status</h2><ul>${permissionItems}</ul><p class="muted">${escapeHtml(report.permissions.caveat)}</p></section>
  <section><h2>Limitations</h2><ul>${limitationItems}</ul><p class="muted">Score model ${escapeHtml(report.score.version)}.</p></section>
  <section class="notice"><strong>Local and ephemeral</strong><p>${escapeHtml(report.privacyNotice)}</p></section>
</body>
</html>\n`;
}

function sanitizeFilenamePart(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return sanitized.length > 0 ? sanitized : "site";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/-/gu, " ");
}
