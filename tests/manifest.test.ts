import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("manifest permissions are limited to the MVP capabilities", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../src/manifest.json", import.meta.url), "utf8"),
  ) as {
    version: string;
    permissions: string[];
    background: { persistent: boolean };
    content_security_policy: string;
    incognito: string;
    browser_specific_settings: {
      gecko: {
        id: string;
        strict_min_version: string;
        data_collection_permissions: { required: string[] };
      };
    };
  };

  assert.equal(manifest.version, "0.1.1");
  assert.equal(manifest.browser_specific_settings.gecko.id, "tracelens@adulph3");
  assert.deepEqual(manifest.permissions, [
    "webRequest",
    "cookies",
    "downloads",
    "webNavigation",
    "*://*/*",
  ]);
  assert.equal(manifest.background.persistent, true);
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "153.0");
  assert.equal(manifest.incognito, "not_allowed");
  assert.deepEqual(
    manifest.browser_specific_settings.gecko.data_collection_permissions.required,
    ["none"],
  );
  assert.match(manifest.content_security_policy, /connect-src 'none'/);
  assert.equal(manifest.permissions.includes("storage"), false);
  assert.equal(manifest.permissions.includes("history"), false);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("webRequestBlocking"), false);
  assert.equal(manifest.permissions.includes("<all_urls>"), false);
});

test("runtime source contains no network client or unsafe execution primitive", async () => {
  const files = await sourceFiles(new URL("../src/", import.meta.url));
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /\bXMLHttpRequest\b/u);
  assert.doesNotMatch(source, /\bWebSocket\s*\(/u);
  assert.doesNotMatch(source, /\bEventSource\s*\(/u);
  assert.doesNotMatch(source, /\bsendBeacon\s*\(/u);
  assert.doesNotMatch(source, /\beval\s*\(/u);
  assert.doesNotMatch(source, /\bFunction\s*\(/u);
  assert.doesNotMatch(source, /\.innerHTML\s*=/u);
  assert.doesNotMatch(source, /requestBody|requestHeaders|responseHeaders/u);
  assert.doesNotMatch(source, /browser\.storage/u);
});

test("popup declares a stable desktop width and a constrained reflow mode", async () => {
  const css = await readFile(
    new URL("../src/popup/popup.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /body\s*\{[^}]*width:\s*420px;/su);
  assert.match(css, /body\s*\{[^}]*min-width:\s*380px;/su);
  assert.match(css, /body\s*\{[^}]*max-width:\s*420px;/su);
  assert.match(css, /html\.popup-constrained body\s*\{[^}]*width:\s*100%;/su);
  assert.doesNotMatch(css, /width:\s*min\([^;]*100vw/u);
});

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) {
        return sourceFiles(child);
      }
      return entry.name.endsWith(".ts") || entry.name.endsWith(".html")
        ? [child]
        : [];
    }),
  );
  return nested.flat();
}
