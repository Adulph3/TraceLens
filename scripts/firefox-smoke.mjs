import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { setTimeout, clearTimeout } from "node:timers";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { connect, createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Test infrastructure only: a disposable Firefox profile and loopback fixture.
// No test server or automation code is included in dist/.
const profile = await mkdtemp(join(tmpdir(), "tracelens-firefox-"));
const portProbe = createTcpServer();
await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const server = createServer((request, response) => {
  const script = request.url === "/asset.js" || request.url === "/late.js";
  response.setHeader("Content-Type", script ? "text/javascript" : "text/html");
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/asset.js") return response.end("window.fixtureReady = true;");
  if (request.url === "/late.js") return response.end("window.lateFixtureReady = true;");
  if (request.url === "/page") {
    response.setHeader("Set-Cookie", "fixture=not-a-secret; Path=/; SameSite=Lax");
    return response.end('<!doctype html><title>TraceLens fixture</title><script src="/asset.js"></script><iframe src="/child"></iframe><script>history.replaceState(history.state,"",location.href);setTimeout(()=>{const script=document.createElement("script");script.src="http://127.0.0.2:"+location.port+"/late.js";document.head.append(script)},3500)</script>');
  }
  if (request.url === "/child") return response.end('<!doctype html><script src="/asset.js"></script>');
  response.end("<!doctype html><title>Clean fixture</title>");
});
await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await writeFile(join(profile, "user.js"), [
  `user_pref("marionette.port", ${port});`,
  'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("browser.aboutwelcome.enabled", false);',
  'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
  'user_pref("toolkit.telemetry.enabled", false);',
  'user_pref("extensions.openPopupWithoutUserGesture.enabled", true);',
].join("\n"));
const firefox = spawn(process.env.FIREFOX_BINARY ?? "/usr/bin/firefox", [
  "--headless", "--no-remote", "--profile", profile,
  "--marionette", "--remote-allow-system-access", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let stderr = "";
firefox.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
let socket;
try {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      socket = await new Promise((resolve, reject) => {
        const candidate = connect(port, "127.0.0.1");
        candidate.once("connect", () => resolve(candidate));
        candidate.once("error", reject);
      });
      break;
    } catch { await delay(100); }
  }
  if (!socket) throw new Error(`Firefox did not start: ${stderr}`);
  let buffer = Buffer.alloc(0);
  let nextId = 0;
  const pending = new Map();
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const colon = buffer.indexOf(58);
      if (colon === -1) return;
      const length = Number(buffer.subarray(0, colon).toString());
      if (buffer.length < colon + 1 + length) return;
      const message = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length));
      buffer = buffer.subarray(colon + 1 + length);
      if (Array.isArray(message)) {
        const [, id, error, result] = message;
        const waiter = pending.get(id);
        pending.delete(id);
        if (error) waiter?.reject(new Error(JSON.stringify(error)));
        else waiter?.resolve(result);
      }
    }
  });
  const command = (name, args = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 20000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timeout); resolve(value); },
      reject: (error) => { clearTimeout(timeout); reject(error); },
    });
    const json = JSON.stringify([0, id, name, args]);
    socket.write(`${Buffer.byteLength(json)}:${json}`);
  });
  const execute = async (script, args = [], async = false) => {
    const result = await command(async ? "WebDriver:ExecuteAsyncScript" : "WebDriver:ExecuteScript", {
      script, args, sandbox: "default", newSandbox: true,
    });
    return result.value;
  };
  await command("WebDriver:NewSession", { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  const companionAddon = process.env.TRACELENS_TEST_ADDON;
  if (companionAddon !== undefined) {
    await command("Addon:Install", { path: resolve(companionAddon), temporary: true });
  }
  await command("Addon:Install", { path: resolve("dist"), temporary: true });
  await command("Marionette:SetContext", { value: "chrome" });
  if (companionAddon !== undefined) {
    const companionActive = await execute(
      'return WebExtensionPolicy.getByID("uBlock0@raymondhill.net")?.active === true;',
    );
    assert.equal(companionActive, true, "uBlock Origin companion add-on is active");
  }
  const base = await execute('return WebExtensionPolicy.getByID("tracelens@adulph3").getURL("");');
  await command("Marionette:SetContext", { value: "content" });
  await command("WebDriver:Navigate", { url: `${base}popup/popup.html` });
  const evaluate = (body, args = []) => execute(`
    const done = arguments[arguments.length - 1];
    const api = window.wrappedJSObject.browser;
    (async () => { ${body} })().then(done, error => done({ testError: String(error) }));
  `, args, true);
  const getReport = (tabId) => evaluate(
    'return api.runtime.sendMessage({type:"GET_REPORT", tabId:arguments[0]});',
    [tabId],
  );
  const waitForReport = async (tabId, predicate, description) => {
    let result;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      result = await getReport(tabId);
      if (predicate(result)) return result;
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(result)}`);
  };
  const tab = await evaluate('return api.tabs.create({url: arguments[0], active: false});', [`${origin}/page`]);
  assert.ok(tab.id, JSON.stringify(tab));
  const report = await waitForReport(
    tab.id,
    (candidate) => candidate.ok === true && candidate.report.requests.total >= 4,
    "initial fixture analysis",
  );
  assert.equal(report.ok, true);
  assert.ok(report.report.requests.total >= 4, "main frame, script, iframe, child script are observed");
  assert.equal(report.report.cookies.status, "available");
  assert.equal(report.report.cookies.total, 1);
  assert.equal(report.report.cookies.partitioned, 0);
  assert.equal(report.report.score.value, 100);
  // Drive the actual popup rendering against the fixture tab in this test view.
  const setup = await evaluate(`
    const id = arguments[0];
    api.tabs.query = async () => [{id}];
    document.getElementById("refresh").focus();
    document.getElementById("refresh").click();
    return true;
  `, [tab.id]);
  assert.equal(setup, true, JSON.stringify(setup));
  await delay(400);
  await execute('document.getElementById("refresh").focus(); document.getElementById("refresh").click();');
  await delay(400);
  const ui = await execute(`return {
    visible: !document.getElementById("report").hidden,
    score: document.getElementById("score").textContent,
    arc: getComputedStyle(document.getElementById("score-progress")).strokeDasharray,
    focus: document.activeElement.id,
    totalDeductions: document.getElementById("total-deductions").textContent,
    equation: document.getElementById("score-equation-result").textContent,
    limitations: document.getElementById("limitations-list").children.length,
    busy: document.getElementById("popup-main").getAttribute("aria-busy")
  };`);
  assert.equal(ui.visible, true);
  assert.equal(ui.score, "100");
  assert.match(ui.arc, /^100(?:px)?[, ]/);
  assert.equal(ui.focus, "refresh");
  assert.equal(ui.totalDeductions, "−0");
  assert.equal(ui.equation, "max(0, 100 − 0) = 100");
  assert.ok(ui.limitations >= 4);
  assert.equal(ui.busy, "false");
  let liveUi = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    liveUi = await execute(`return {
      score: document.getElementById("score").textContent,
      thirdParties: document.getElementById("third-party-count").textContent,
      requests: document.getElementById("request-count").textContent,
      totalDeductions: document.getElementById("total-deductions").textContent,
      equation: document.getElementById("score-equation-result").textContent,
    };`);
    if (liveUi.score === "99" && liveUi.thirdParties === "1") break;
    await delay(100);
  }
  assert.equal(liveUi.score, "99", JSON.stringify(liveUi));
  assert.equal(liveUi.thirdParties, "1", JSON.stringify(liveUi));
  assert.equal(liveUi.totalDeductions, "−1", JSON.stringify(liveUi));
  assert.equal(liveUi.equation, "max(0, 100 − 1) = 99", JSON.stringify(liveUi));
  assert.ok(Number(liveUi.requests) >= 5, JSON.stringify(liveUi));
  const desktopLayout = await execute(`
    document.getElementById("hostname").textContent =
      "an-extremely-long-unbroken-subdomain-for-popup-layout-testing.example.com";
    return {
      bodyWidth: document.body.getBoundingClientRect().width,
      bodyHeight: document.body.getBoundingClientRect().height,
      clientWidth: document.body.clientWidth,
      clientHeight: document.body.clientHeight,
      scrollWidth: document.body.scrollWidth,
      scrollHeight: document.body.scrollHeight,
      overflowY: getComputedStyle(document.body).overflowY,
      cardsFit: [...document.querySelectorAll("main section, main details")].every((card) =>
        card.getBoundingClientRect().right <= document.body.getBoundingClientRect().right),
    };
  `);
  assert.equal(desktopLayout.bodyWidth, 420);
  assert.ok(desktopLayout.scrollWidth <= desktopLayout.clientWidth, JSON.stringify(desktopLayout));
  assert.equal(desktopLayout.bodyHeight, 600);
  assert.ok(desktopLayout.scrollHeight > desktopLayout.clientHeight, JSON.stringify(desktopLayout));
  assert.equal(desktopLayout.overflowY, "auto");
  assert.equal(desktopLayout.cardsFit, true, JSON.stringify(desktopLayout));

  const popupOpened = await evaluate("await api.browserAction.openPopup(); return true;");
  assert.equal(popupOpened, true, JSON.stringify(popupOpened));
  await command("Marionette:SetContext", { value: "chrome" });
  let panelLayout = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    panelLayout = await execute(`
      const browser = [...document.querySelectorAll("browser.webextension-popup-browser")]
        .find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      if (!browser) return null;
      const panel = browser.closest("panel");
      const panelRect = panel?.getBoundingClientRect();
      const browserRect = browser.getBoundingClientRect();
      return {
        panelWidth: panelRect?.width ?? browserRect.width,
        panelHeight: panelRect?.height ?? browserRect.height,
        contentWidth: browserRect.width,
        contentHeight: browserRect.height,
      };
    `);
    if (panelLayout?.contentWidth >= 380) break;
    await delay(100);
  }
  assert.ok(panelLayout, "browser-action popup panel opened");
  assert.ok(panelLayout.contentWidth >= 380 && panelLayout.contentWidth <= 422,
    JSON.stringify(panelLayout));
  assert.ok(panelLayout.contentHeight >= 100 && panelLayout.contentHeight <= 600,
    JSON.stringify(panelLayout));
  await execute(`
    const panel = [...document.querySelectorAll("browser.webextension-popup-browser")]
      .find((candidate) => candidate.getBoundingClientRect().width > 0)?.closest("panel");
    panel?.hidePopup();
  `);
  await command("Marionette:SetContext", { value: "content" });

  // An iframe provides an actual 320px CSS viewport, including media queries.
  await execute(`
    const frame = document.createElement("iframe");
    frame.id = "narrow-test";
    frame.style.width = "320px";
    frame.style.border = "0";
    frame.src = location.href;
    document.body.append(frame);
  `);
  await delay(300);
  await evaluate(`
    const frame = document.getElementById("narrow-test");
    const id = arguments[0];
    frame.contentWindow.wrappedJSObject.browser.tabs.query = async () => [{id}];
    frame.contentDocument.getElementById("refresh").click();
  `, [tab.id]);
  await delay(300);
  const reflow = await execute(`
    const frame = document.getElementById("narrow-test");
    frame.contentDocument.getElementById("hostname").textContent =
      "another-extremely-long-unbroken-subdomain-for-constrained-layout-testing.example.com";
    const body = frame.contentDocument.body;
    return {
      viewportWidth: frame.contentWindow.innerWidth,
      width: body.getBoundingClientRect().width,
      clientWidth: body.clientWidth,
      scrollWidth: body.scrollWidth,
    };
  `);
  assert.equal(reflow.viewportWidth, 320);
  assert.ok(reflow.width >= 300 && reflow.width <= 320, JSON.stringify(reflow));
  assert.ok(reflow.scrollWidth <= reflow.clientWidth, JSON.stringify(reflow));

  await evaluate(`
    const targetTabId = arguments[0];
    const trace = window.wrappedJSObject.__reloadLifecycle = [];
    let latestCommittedUrl = null;
    api.webNavigation.onBeforeNavigate.addListener((details) => {
      if (details.tabId === targetTabId && details.frameId === 0) trace.push("before");
    });
    api.webRequest.onBeforeRequest.addListener((details) => {
      if (details.tabId === targetTabId && details.type === "main_frame") trace.push("main-request");
    }, {urls:["*://*/*"]});
    api.webNavigation.onCommitted.addListener((details) => {
      if (details.tabId === targetTabId && details.frameId === 0) {
        latestCommittedUrl = details.url;
        trace.push("commit");
      }
    });
    api.webNavigation.onHistoryStateUpdated.addListener((details) => {
      if (details.tabId === targetTabId && details.frameId === 0) {
        trace.push(details.url === latestCommittedUrl ? "history-same-url" : "history-changed-url");
      }
    });
    return true;
  `, [tab.id]);
  await evaluate('await api.tabs.reload(arguments[0]); return true;', [tab.id]);
  let normalReload;
  try {
    normalReload = await waitForReport(
      tab.id,
      (candidate) => candidate.ok === true &&
        candidate.generation !== report.generation &&
        candidate.report.observation.coverage === "full-navigation" &&
        candidate.report.score.value === 100 &&
        candidate.report.requests.total >= 4,
      "normal reload with a no-op History API update",
    );
  } catch (error) {
    const lifecycle = await execute('return window.wrappedJSObject.__reloadLifecycle;');
    throw new Error(`Reload regression failed; lifecycle=${JSON.stringify(lifecycle)}`, {
      cause: error,
    });
  }
  await evaluate('await api.tabs.reload(arguments[0], {bypassCache:true}); return true;', [tab.id]);
  const hardReload = await waitForReport(
    tab.id,
    (candidate) => candidate.ok === true &&
      candidate.generation !== normalReload.generation &&
      candidate.report.observation.coverage === "full-navigation" &&
      candidate.report.score.value === 100 &&
      candidate.report.requests.total >= 4,
    "cache-bypassing reload with a no-op History API update",
  );
  assert.notEqual(hardReload.generation, normalReload.generation);
  await evaluate('await api.tabs.update(arguments[0], {url:arguments[1]});', [tab.id, `${origin}/clean`]);
  const clean = await waitForReport(
    tab.id,
    (candidate) => candidate.ok === true && candidate.generation !== report.generation,
    "clean-page navigation analysis",
  );
  assert.equal(clean.ok, true);
  assert.notEqual(clean.generation, report.generation);
  assert.ok(clean.report.requests.total < report.report.requests.total);
  await evaluate('await api.tabs.update(arguments[0], {url:arguments[1]});', [tab.id, `${origin}/clean#route`]);
  const fragment = await waitForReport(
    tab.id,
    (candidate) => candidate.ok === true &&
      candidate.generation !== clean.generation &&
      candidate.report.observation.coverage === "partial" &&
      typeof candidate.report.score.value === "number" &&
      candidate.report.counts.trackers === 0,
    "fragment-navigation reset",
  );
  assert.equal(typeof fragment.report.score.value, "number");
  assert.notEqual(fragment.generation, clean.generation);
  await execute('document.getElementById("refresh").click();');
  await delay(300);
  const partialUi = await execute(`return {
    heading: document.getElementById("score-details-heading").textContent,
    eyebrow: document.getElementById("score-details-eyebrow").textContent,
    score: document.getElementById("score").textContent,
    status: document.getElementById("score-alert-title").textContent,
    statusVisible: !document.getElementById("partial-alert").hidden,
  };`);
  assert.equal(partialUi.heading, "Score details");
  assert.equal(partialUi.eyebrow, "Observed evidence");
  assert.match(partialUi.score, /^\d{1,3}$/u);
  assert.equal(partialUi.status, "Partial observation");
  assert.equal(partialUi.statusVisible, true);
  const staleSave = await evaluate('return api.runtime.sendMessage({type:"SAVE_REPORT",tabId:arguments[0],format:"json",expectedGeneration:arguments[1]});', [tab.id, report.generation]);
  assert.equal(staleSave.ok, false);
  await evaluate('await api.tabs.remove(arguments[0]);', [tab.id]);
  const closed = await evaluate('return api.runtime.sendMessage({type:"GET_REPORT", tabId:arguments[0]});', [tab.id]);
  assert.equal(closed.ok, false);

  let remoteResult = "";
  const remoteUrl = process.argv[2];
  if (remoteUrl !== undefined) {
    const remoteSettleMs = Number(process.env.TRACELENS_REMOTE_SETTLE_MS ?? 10_000);
    const remoteTab = await evaluate(
      'return api.tabs.create({url:arguments[0],active:false});',
      [remoteUrl],
    );
    const remoteFresh = await waitForReport(
      remoteTab.id,
      (candidate) => candidate.ok === true &&
        typeof candidate.report.score.value === "number" &&
        candidate.report.requests.total >= 1,
      "remote fresh-navigation analysis",
    );
    await delay(remoteSettleMs);
    const remoteFreshSettled = await getReport(remoteTab.id);
    assert.equal(remoteFreshSettled.ok, true, JSON.stringify(remoteFreshSettled));
    await evaluate(
      'await api.tabs.reload(arguments[0], {bypassCache:true}); return true;',
      [remoteTab.id],
    );
    const remoteReload = await waitForReport(
      remoteTab.id,
      (candidate) => candidate.ok === true &&
        candidate.generation !== remoteFresh.generation &&
        typeof candidate.report.score.value === "number" &&
        candidate.report.requests.total >= 1,
      "remote cache-bypassing reload analysis",
    );
    assert.notEqual(remoteReload.generation, remoteFresh.generation);
    await delay(remoteSettleMs);
    const remoteSettled = await getReport(remoteTab.id);
    assert.equal(remoteSettled.ok, true, JSON.stringify(remoteSettled));
    const settledCandidates = [remoteFreshSettled.report, remoteSettled.report];
    const observed = settledCandidates.sort((left, right) =>
      right.counts.thirdPartyDomains - left.counts.thirdPartyDomains ||
      right.requests.total - left.requests.total,
    )[0];
    const phase = observed === remoteFreshSettled.report ? "fresh" : "reload";
    remoteResult = ` Remote observation ${JSON.stringify({
      url: remoteUrl,
      phase,
      companionAddon: companionAddon === undefined ? "none" : "uBlock Origin active",
      coverage: observed.observation.coverage,
      requests: observed.requests.total,
      thirdPartyRequests: observed.requests.thirdParty,
      thirdPartyDomains: observed.counts.thirdPartyDomains,
      trackers: observed.counts.trackers,
      categories: {
        advertising: observed.counts.advertising,
        analytics: observed.counts.analytics,
        social: observed.counts.social,
        fingerprinting: observed.counts.fingerprinting,
        other: observed.counts.other,
      },
      cookies: observed.cookies.status === "available" ? {
        total: observed.cookies.total,
        persistent: observed.cookies.persistent,
        sameSiteNone: observed.cookies.sameSite.none,
        nonSecure: observed.cookies.nonSecure,
      } : "unavailable",
      score: observed.score.value,
      totalDeductions: observed.score.totalDeductions,
    })}.`;
    await evaluate('await api.tabs.remove(arguments[0]);', [remoteTab.id]);
  }

  process.stdout.write(`Firefox smoke passed: live observed score 100→99 without manual refresh, numeric partial score, request/iframe attribution, no-op History API preservation, numeric scores after fresh, normal, and cache-bypassing navigation, cookies, actual popup ${panelLayout.contentWidth}x${panelLayout.contentHeight}, desktop 420px and constrained 320px reflow, long-domain wrapping, navigation/fragment reset, stale-save rejection, tab close.${remoteResult}\n`);
} finally {
  socket?.destroy();
  firefox.kill("SIGTERM");
  await new Promise((resolve) => firefox.exitCode !== null ? resolve() : firefox.once("exit", resolve));
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
