import assert from "node:assert/strict";
import test from "node:test";

import { emptyCookieSummary, summarizeCookies } from "../src/core/cookies.ts";

test("cookie objects are projected into counts only", () => {
  const summary = summarizeCookies([
    {
      secure: true,
      httpOnly: true,
      session: false,
      hostOnly: true,
      sameSite: "strict",
    },
    {
      secure: false,
      httpOnly: false,
      session: true,
      hostOnly: false,
      sameSite: "no_restriction",
      partitioned: true,
    },
  ]);

  assert.deepEqual(summary, {
    status: "available",
    scope: "cookies-applicable-to-current-page",
    total: 2,
    session: 1,
    persistent: 1,
    secure: 1,
    nonSecure: 1,
    httpOnly: 1,
    scriptAccessible: 1,
    hostOnly: 1,
    domainScoped: 1,
    partitioned: 1,
    sameSite: { strict: 1, lax: 0, none: 1, unspecified: 0 },
    caveat:
      "Snapshot of unpartitioned and current top-level partition cookies applicable to this page. It does not show which cookies this load created or sent, and names and values are never retained.",
  });
  assert.equal("value" in summary, false);
  assert.equal("name" in summary, false);
});

test("unavailable cookie summary contains no guessed counts", () => {
  const summary = emptyCookieSummary("unavailable");
  assert.equal(summary.status, "unavailable");
  assert.equal(summary.total, 0);
});
