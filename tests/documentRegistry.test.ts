import assert from "node:assert/strict";
import test from "node:test";

import { DocumentRegistry } from "../src/core/documentRegistry.ts";

test("attributes only requests from the current top-level document tree", () => {
  const registry = new DocumentRegistry();
  assert.equal(registry.registerCommitted(4, 0, "top-a"), true);
  assert.equal(registry.registerCommitted(4, 8, "child-a", "top-a"), true);
  assert.equal(registry.registerCommitted(4, 9, "grandchild-a", "child-a"), true);

  assert.equal(
    registry.topLevelForRequest({
      tabId: 4,
      type: "script",
      documentId: "grandchild-a",
      parentDocumentId: "child-a",
      documentLifecycle: "active",
    }),
    "top-a",
  );
  assert.equal(
    registry.topLevelForRequest({
      tabId: 4,
      type: "sub_frame",
      documentId: "not-committed-yet",
      parentDocumentId: "child-a",
      documentLifecycle: "active",
    }),
    "top-a",
  );
});

test("rejects stale, unknown, and inactive documents", () => {
  const registry = new DocumentRegistry();
  registry.registerCommitted(2, 0, "top-old");
  registry.registerCommitted(2, 5, "child-old", "top-old");
  registry.registerCommitted(2, 0, "top-current");

  for (const documentLifecycle of ["prerender", "cached", "pending_deletion"] as const) {
    assert.equal(
      registry.topLevelForRequest({
        tabId: 2,
        type: "image",
        documentId: "top-current",
        documentLifecycle,
      }),
      null,
    );
  }

  assert.equal(
    registry.topLevelForRequest({ tabId: 2, type: "script", documentId: "top-old" }),
    null,
  );
  assert.equal(
    registry.topLevelForRequest({ tabId: 2, type: "script", documentId: "unknown" }),
    null,
  );
});

test("replacing a sub-frame removes its prior document and descendants", () => {
  const registry = new DocumentRegistry();
  registry.registerCommitted(3, 0, "top");
  registry.registerCommitted(3, 7, "child-old", "top");
  registry.registerCommitted(3, 8, "nested-old", "child-old");
  registry.registerCommitted(3, 7, "child-new", "top");

  assert.equal(
    registry.topLevelForRequest({ tabId: 3, type: "script", documentId: "nested-old" }),
    null,
  );
  assert.equal(
    registry.topLevelForRequest({ tabId: 3, type: "script", documentId: "child-new" }),
    "top",
  );
});

test("bounds retained document attribution nodes per tab", () => {
  const registry = new DocumentRegistry();
  registry.registerCommitted(10, 0, "top");
  for (let frameId = 1; frameId < 1_000; frameId += 1) {
    assert.equal(registry.registerCommitted(10, frameId, `child-${frameId}`, "top"), true);
  }
  assert.equal(registry.registerCommitted(10, 1_001, "over-limit", "top"), false);
  assert.equal(
    registry.topLevelForRequest({ tabId: 10, type: "script", documentId: "over-limit" }),
    null,
  );
});
