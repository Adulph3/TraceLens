import type { CookieSummary } from "../shared/types.ts";

export interface CookieMetadataInput {
  secure: boolean;
  httpOnly: boolean;
  session: boolean;
  hostOnly: boolean;
  sameSite?: string;
  partitioned?: boolean;
}

const COOKIE_CAVEAT =
  "Snapshot of unpartitioned and current top-level partition cookies applicable to this page. It does not show which cookies this load created or sent, and names and values are never retained.";

export function emptyCookieSummary(status: CookieSummary["status"]): CookieSummary {
  return {
    status,
    scope: "cookies-applicable-to-current-page",
    total: 0,
    session: 0,
    persistent: 0,
    secure: 0,
    nonSecure: 0,
    httpOnly: 0,
    scriptAccessible: 0,
    hostOnly: 0,
    domainScoped: 0,
    partitioned: 0,
    sameSite: { strict: 0, lax: 0, none: 0, unspecified: 0 },
    caveat: COOKIE_CAVEAT,
  };
}

export function summarizeCookies(cookies: readonly CookieMetadataInput[]): CookieSummary {
  const summary = emptyCookieSummary("available");

  for (const cookie of cookies) {
    summary.total += 1;
    if (cookie.session) summary.session += 1;
    else summary.persistent += 1;
    if (cookie.secure) summary.secure += 1;
    else summary.nonSecure += 1;
    if (cookie.httpOnly) summary.httpOnly += 1;
    else summary.scriptAccessible += 1;
    if (cookie.hostOnly) summary.hostOnly += 1;
    else summary.domainScoped += 1;
    if (cookie.partitioned === true) {
      summary.partitioned += 1;
    }

    switch (cookie.sameSite) {
      case "strict":
        summary.sameSite.strict += 1;
        break;
      case "lax":
        summary.sameSite.lax += 1;
        break;
      case "no_restriction":
      case "none":
        summary.sameSite.none += 1;
        break;
      default:
        summary.sameSite.unspecified += 1;
    }
  }

  return summary;
}
