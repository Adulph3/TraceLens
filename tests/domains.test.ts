import assert from "node:assert/strict";
import test from "node:test";

import {
  hostnameMatchesDomain,
  isThirdPartyHostname,
  parsePageUrl,
  parseWebUrl,
  siteKey,
} from "../src/shared/domains.ts";

test("parses only supported web URLs and retains only hostname and protocol", () => {
  assert.deepEqual(
    parsePageUrl("https://user:secret@Sub.Example.COM:8443/private?token=secret#part"),
    { hostname: "sub.example.com", protocol: "https:" },
  );
  assert.deepEqual(parseWebUrl("wss://stream.example.com/socket?credential=x"), {
    hostname: "stream.example.com",
    protocol: "wss:",
  });
  assert.equal(parsePageUrl("wss://stream.example.com/socket"), null);
  assert.equal(parseWebUrl("file:///home/user/private.txt"), null);
  assert.equal(parseWebUrl("not a url"), null);
});

test("uses the bundled public suffix data for party boundaries", () => {
  assert.equal(siteKey("shop.example.co.uk"), "example.co.uk");
  assert.equal(siteKey("cdn.example.co.uk"), "example.co.uk");
  assert.equal(isThirdPartyHostname("cdn.example.co.uk", "shop.example.co.uk"), false);
  assert.equal(isThirdPartyHostname("example-cdn.co.uk", "shop.example.co.uk"), true);
  assert.equal(isThirdPartyHostname("127.0.0.1", "127.0.0.1"), false);
  assert.equal(isThirdPartyHostname("127.0.0.2", "127.0.0.1"), true);
});

test("tracker domain matching requires a DNS label boundary", () => {
  assert.equal(hostnameMatchesDomain("doubleclick.net", "doubleclick.net"), true);
  assert.equal(hostnameMatchesDomain("stats.doubleclick.net", "doubleclick.net"), true);
  assert.equal(hostnameMatchesDomain("notdoubleclick.net", "doubleclick.net"), false);
  assert.equal(hostnameMatchesDomain("doubleclick.net.attacker.example", "doubleclick.net"), false);
});
