import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { URL } from "node:url";
import { Blob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const bundle = await build({ entryPoints: ["src/background/index.ts"], bundle: true, write: false, format: "iife", platform: "browser" });
const code = bundle.outputFiles[0].text;

function harness() {
  const handlers = new Map();
  const tabs = new Map();
  const downloads = [];
  const cookieQueries = [];
  const intervals = [];
  const event = (name) => ({ addListener: (listener) => handlers.set(name, listener) });
  const sender = { id: "test-extension", url: "moz-extension://test/popup/popup.html" };
  const state = { cookieReader: async () => [], permissionReader: async () => ({ type: "SITE_PERMISSIONS_RESULT", items: [{ name: "geolocation", state: "prompt" }] }) };
  const browser = {
    runtime: { id: sender.id, getURL: (path) => `moz-extension://test/${path}`, onMessage: event("message") },
    webRequest: {
      onBeforeRequest: event("request"),
      onErrorOccurred: event("requestError"),
    },
    webNavigation: {
      onBeforeNavigate: event("before"), onCommitted: event("commit"),
      onHistoryStateUpdated: event("history"), onReferenceFragmentUpdated: event("fragment"),
      onErrorOccurred: event("error"),
      getFrame: async ({ tabId }) => {
        const tab = tabs.get(tabId);
        return tab ? { url: tab.url, parentFrameId: -1, documentId: tab.documentId } : null;
      },
    },
    tabs: {
      onRemoved: event("removed"), onReplaced: event("replaced"), onUpdated: event("updated"),
      get: async (id) => { if (!tabs.has(id)) throw new Error("Closed"); return tabs.get(id); },
      sendMessage: (...args) => state.permissionReader(...args),
    },
    cookies: { getAll: async (query) => { cookieQueries.push(query); return state.cookieReader(query); } },
    permissions: { onRemoved: event("permissionRemoved") },
    downloads: {
      onChanged: event("downloadChanged"),
      download: async (options) => { downloads.push(options); return downloads.length; },
      search: async () => [{ state: "complete" }],
    },
  };
  runInNewContext(code, {
    browser, URL, Blob, crypto: webcrypto, TextEncoder,
    setInterval: (callback) => intervals.push(callback),
    window: { setTimeout: () => 1, clearTimeout: () => {} },
  });
  const emit = (name, ...args) => handlers.get(name)(...args);
  const navigate = (id, url, documentId, network = true) => {
    emit("before", { tabId: id, frameId: 0, url });
    tabs.set(id, { id, url, documentId, cookieStoreId: "firefox-default" });
    if (network) emit("request", {
      tabId: id,
      frameId: 0,
      url,
      type: "main_frame",
      requestId: `navigation-${id}-${documentId}`,
    });
    emit("commit", { tabId: id, frameId: 0, url, documentId });
  };
  // runtime messages have a separate sender argument.
  const send = (data, origin = sender) => handlers.get("message")(data, origin);
  return { emit, navigate, send, tabs, downloads, state, cookieQueries, intervals };
}

test("background uses real API shapes, isolates tabs/documents, and resets routes", async () => {
  const h = harness();
  h.navigate(1, "https://one.example/private?secret=x", "doc-1");
  h.navigate(2, "https://two.example/", "doc-2");
  h.emit("request", { tabId: 1, frameId: 0, documentId: "doc-1", type: "script", url: "https://doubleclick.net/a" });
  const one = await h.send({ type: "GET_REPORT", tabId: 1 });
  const two = await h.send({ type: "GET_REPORT", tabId: 2 });
  assert.equal(one.ok, true);
  assert.equal(one.report.counts.advertising, 1);
  assert.equal(two.report.counts.trackers, 0);
  assert.equal(JSON.stringify(one.report).includes("secret"), false);
  assert.equal(h.cookieQueries.some(q => q.partitionKey?.topLevelSite === "https://one.example"), true);
  assert.equal(h.cookieQueries.some(q => q.url.includes("secret")), false);
  h.emit("history", { tabId: 1, frameId: 0, documentId: "doc-1", url: "https://one.example/route" });
  await delay(20);
  const route = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(route.report.requests.total, 0);
  assert.equal(route.report.score.value, 100);
  assert.notEqual(route.generation, one.generation);
  const staleSave = await h.send({ type: "SAVE_REPORT", tabId: 1, format: "json", expectedGeneration: one.generation });
  assert.equal(staleSave.ok, false);
  assert.equal(h.downloads.length, 0);
  h.navigate(1, "https://one.example/new", "doc-new");
  h.emit("request", { tabId: 1, documentId: "doc-1", type: "script", url: "https://doubleclick.net/late" });
  const fresh = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(fresh.report.counts.trackers, 0);
  h.emit("removed", 1);
  h.tabs.delete(1);
  assert.equal((await h.send({ type: "GET_REPORT", tabId: 1 })).ok, false);
});

test("same-document updates recover from Firefox navigation-start ordering", async () => {
  const h = harness();
  h.navigate(1, "https://one.example/route", "doc-1");
  h.emit("before", {
    tabId: 1,
    frameId: 0,
    url: "https://one.example/route#section",
  });
  h.tabs.set(1, {
    id: 1,
    url: "https://one.example/route#section",
    documentId: "doc-1",
    cookieStoreId: "firefox-default",
  });
  h.emit("fragment", {
    tabId: 1,
    frameId: 0,
    documentId: "doc-1",
    url: "https://one.example/route#section",
  });
  await delay(20);

  const route = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(route.ok, true);
  assert.equal(route.report.requests.total, 0);
  assert.equal(route.report.score.value, 100);
});

test("a no-op History API update preserves a fully observed navigation", async () => {
  const h = harness();
  const url = "https://weather.example/";
  h.navigate(1, url, "doc-1");
  h.emit("request", {
    tabId: 1,
    frameId: 0,
    documentId: "doc-1",
    type: "script",
    url: "https://doubleclick.net/observed",
  });
  const before = await h.send({ type: "GET_REPORT", tabId: 1 });

  h.emit("history", {
    tabId: 1,
    frameId: 0,
    documentId: "doc-1",
    url,
  });
  await delay(20);
  const after = await h.send({ type: "GET_REPORT", tabId: 1 });

  assert.equal(after.ok, true);
  assert.equal(after.generation, before.generation);
  assert.equal(after.report.observation.coverage, "full-navigation");
  assert.equal(after.report.requests.total, 2);
  assert.equal(after.report.score.value, 93);
});

test("genuine same-host reloads establish a new complete generation", async () => {
  const h = harness();
  const url = "https://reload.example/";
  h.navigate(1, url, "doc-before");
  h.emit("request", {
    tabId: 1,
    documentId: "doc-before",
    type: "script",
    url: "https://doubleclick.net/old",
  });
  const before = await h.send({ type: "GET_REPORT", tabId: 1 });

  h.navigate(1, url, "doc-after");
  const after = await h.send({ type: "GET_REPORT", tabId: 1 });

  assert.notEqual(after.generation, before.generation);
  assert.equal(after.report.observation.coverage, "full-navigation");
  assert.equal(after.report.requests.total, 1);
  assert.equal(after.report.counts.trackers, 0);
  assert.equal(after.report.score.value, 100);
});

test("a stale subresource racing a pending reload cannot poison main-frame coverage", async () => {
  const h = harness();
  const url = "https://reload.example/";
  h.navigate(1, url, "doc-before");

  h.emit("request", {
    tabId: 1,
    frameId: 0,
    url,
    type: "main_frame",
    requestId: "reload-main",
  });
  h.emit("request", {
    tabId: 1,
    documentId: "doc-before",
    type: "script",
    url: "https://stale-third-party.example/late",
  });
  h.emit("before", { tabId: 1, frameId: 0, url });
  h.tabs.set(1, {
    id: 1,
    url,
    documentId: "doc-after",
    cookieStoreId: "firefox-default",
  });
  h.emit("commit", { tabId: 1, frameId: 0, url, documentId: "doc-after" });

  const report = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(report.report.observation.coverage, "full-navigation");
  assert.equal(report.report.requests.total, 1);
  assert.equal(report.report.counts.thirdPartyDomains, 0);
  assert.equal(report.report.score.value, 100);
});

test("a late main request reconciles when Firefox reports the tab complete", async () => {
  const h = harness();
  const url = "https://one.example/new";
  h.emit("before", { tabId: 1, frameId: 0, url });
  h.tabs.set(1, {
    id: 1,
    url,
    documentId: "doc-new",
    cookieStoreId: "firefox-default",
    status: "loading",
  });
  h.emit("commit", { tabId: 1, frameId: 0, url, documentId: "doc-new" });
  h.emit("request", {
    tabId: 1,
    frameId: 0,
    url,
    type: "main_frame",
    requestId: "late-request",
  });
  assert.equal((await h.send({ type: "GET_REPORT", tabId: 1 })).ok, false);
  h.tabs.get(1).status = "complete";

  const report = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(report.ok, true);
  assert.equal(report.report.observation.coverage, "partial");
  assert.equal(report.report.requests.total, 0);
  assert.equal(report.report.score.value, 100);
});

test("commit-before-request delivery confirms coverage from event timestamps", async () => {
  const h = harness();
  const url = "https://reverse-order.example/";
  h.emit("before", { tabId: 1, frameId: 0, url, timeStamp: 100 });
  h.tabs.set(1, {
    id: 1,
    url,
    documentId: "doc-reverse",
    cookieStoreId: "firefox-default",
    status: "loading",
  });
  h.emit("commit", {
    tabId: 1,
    frameId: 0,
    url,
    documentId: "doc-reverse",
    timeStamp: 200,
  });
  h.emit("request", {
    tabId: 1,
    frameId: 0,
    url,
    type: "main_frame",
    requestId: "delivered-late",
    timeStamp: 150,
  });

  const report = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(report.report.observation.coverage, "full-navigation");
  assert.equal(report.report.requests.total, 1);
  assert.equal(report.report.score.value, 100);
});

test("a request that began after commit cannot promote partial coverage", async () => {
  const h = harness();
  const url = "https://restored.example/";
  h.emit("before", { tabId: 1, frameId: 0, url, timeStamp: 100 });
  h.tabs.set(1, {
    id: 1,
    url,
    documentId: "doc-partial",
    cookieStoreId: "firefox-default",
    status: "complete",
  });
  h.emit("commit", {
    tabId: 1,
    frameId: 0,
    url,
    documentId: "doc-partial",
    timeStamp: 200,
  });
  h.emit("request", {
    tabId: 1,
    frameId: 0,
    url,
    type: "main_frame",
    requestId: "newer-request",
    timeStamp: 250,
  });

  const report = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(report.report.score.value, 100);
});

test("only the packaged popup can request reports or explicit downloads", async () => {
  const h = harness();
  h.navigate(1, "https://one.example/", "doc-1");
  assert.equal(h.send({ type: "GET_REPORT", tabId: 1 }, { id: "test-extension", tab: { id: 1 }, url: "https://one.example/" }), undefined);
  const report = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(h.downloads.length, 0);
  const saved = await h.send({ type: "SAVE_REPORT", tabId: 1, format: "html", expectedGeneration: report.generation });
  assert.equal(saved.ok, true);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].saveAs, true);
  assert.match(h.downloads[0].url, /^blob:/);
});

test("restored pages and unavailable cookies still produce observed-evidence scores", async () => {
  const h = harness();
  h.navigate(1, "https://restored.example/", "restored", false);
  const restored = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(restored.report.score.value, 100);
  h.emit("commit", {
    tabId: 1,
    frameId: 0,
    url: "https://stale.example/",
    documentId: "stale-document",
  });
  const stillRestored = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(stillRestored.report.hostname, "restored.example");
  assert.equal(stillRestored.report.score.value, 100);
  h.navigate(1, "https://restored.example/", "new", true);
  h.state.cookieReader = async () => { throw new Error("No access"); };
  const unavailable = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(unavailable.report.cookies.status, "unavailable");
  assert.equal(unavailable.report.score.value, 100);
});

test("a partial report score changes as current-document evidence arrives", async () => {
  const h = harness();
  h.navigate(1, "https://live.example/", "live-document", false);
  const initial = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(initial.report.observation.coverage, "partial");
  assert.equal(initial.report.score.value, 100);

  h.emit("request", {
    tabId: 1,
    documentId: "live-document",
    type: "script",
    url: "https://doubleclick.net/live-ad",
  });
  const updated = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(updated.generation, initial.generation);
  assert.equal(updated.report.observation.coverage, "partial");
  assert.equal(updated.report.score.value, 93);
  assert.deepEqual(
    Array.from(updated.report.score.deductions, (deduction) => deduction.code),
    ["third-party-exposure", "advertising-trackers"],
  );
});

test("async cookie/permission results are discarded across navigation", async () => {
  const h = harness();
  h.navigate(1, "https://old.example/", "old");
  let release;
  h.state.permissionReader = () => new Promise(resolve => { release = resolve; });
  const pending = h.send({ type: "GET_REPORT", tabId: 1 });
  while (!release) await Promise.resolve();
  h.navigate(1, "https://new.example/", "new");
  h.state.permissionReader = async () => ({ type: "SITE_PERMISSIONS_RESULT", items: [] });
  release({ type: "SITE_PERMISSIONS_RESULT", items: [{ name: "camera", state: "granted" }] });
  const report = await pending;
  assert.equal(report.report.hostname, "new.example");
  assert.equal(report.report.permissions.items.length, 0);
});

test("main-request-first ordering retains coverage and overlapping requests fail closed", async () => {
  const h = harness();
  const url = "https://one.example/";
  h.tabs.set(1, { id: 1, url, documentId: "new" });
  h.emit("request", { tabId: 1, frameId: 0, url, type: "main_frame", requestId: "first" });
  h.emit("before", { tabId: 1, frameId: 0, url });
  h.emit("commit", { tabId: 1, frameId: 0, url, documentId: "new" });
  assert.equal((await h.send({ type: "GET_REPORT", tabId: 1 })).report.score.value, 100);
  h.emit("request", { tabId: 1, frameId: 0, url, type: "main_frame", requestId: "a" });
  h.emit("request", { tabId: 1, frameId: 0, url, type: "main_frame", requestId: "b" });
  h.emit("before", { tabId: 1, frameId: 0, url });
  h.emit("commit", { tabId: 1, frameId: 0, url, documentId: "new" });
  assert.equal((await h.send({ type: "GET_REPORT", tabId: 1 })).report.score.value, 100);
});

test("a failed main request clears only its matching pending navigation", async () => {
  const h = harness();
  const url = "https://failure.example/";
  h.emit("before", { tabId: 1, frameId: 0, url });
  h.emit("request", {
    tabId: 1,
    frameId: 0,
    url,
    type: "main_frame",
    requestId: "failed-request",
  });
  h.emit("requestError", {
    tabId: 1,
    type: "main_frame",
    requestId: "failed-request",
  });
  h.tabs.set(1, { id: 1, url: "https://old.example/", documentId: "old-doc" });
  const result = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.report.hostname, "old.example");
  assert.equal(result.report.score.value, 100);
});

test("First-Party Isolation retry preserves cookie scope and strips values", async () => {
  const h = harness();
  h.navigate(1, "https://shop.example.com/path?secret=x", "doc");
  h.state.cookieReader = async (query) => {
    if (!query.firstPartyDomain) throw new Error("FPI requires firstPartyDomain");
    return [{ name: "session", value: "sensitive-fixture", secure: true, httpOnly: true,
      session: true, hostOnly: true, sameSite: "lax",
      partitionKey: query.partitionKey ?? null }];
  };
  const result = await h.send({ type: "GET_REPORT", tabId: 1 });
  assert.equal(result.report.cookies.status, "available");
  assert.equal(result.report.cookies.partitioned, 1);
  assert.equal(JSON.stringify(result).includes("sensitive-fixture"), false);
  assert.ok(h.cookieQueries.some(q => q.firstPartyDomain === "example.com"));
});
