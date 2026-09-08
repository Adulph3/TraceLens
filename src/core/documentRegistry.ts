export type DocumentLifecycle =
  | "prerender"
  | "active"
  | "cached"
  | "pending_deletion";

export interface RequestDocumentContext {
  tabId: number;
  type: string;
  documentId?: string;
  parentDocumentId?: string;
  documentLifecycle?: DocumentLifecycle;
}

interface DocumentNode {
  frameId: number;
  parentDocumentId: string | null;
}

/**
 * Tracks only the live document hierarchy for a tab. The UUIDs are Firefox
 * process-local attribution tokens; they are never added to a report or export.
 */
export class DocumentRegistry {
  readonly #documentsByTab = new Map<number, Map<string, DocumentNode>>();

  registerCommitted(
    tabId: number,
    frameId: number,
    documentId: string,
    parentDocumentId?: string,
  ): boolean {
    if (tabId < 0 || frameId < 0 || documentId.length === 0) {
      return false;
    }

    if (frameId === 0) {
      this.#documentsByTab.set(
        tabId,
        new Map([[documentId, { frameId: 0, parentDocumentId: null }]]),
      );
      return true;
    }

    const documents = this.#documentsByTab.get(tabId);
    if (
      documents === undefined ||
      parentDocumentId === undefined ||
      this.#rootFor(documents, parentDocumentId) === null
    ) {
      return false;
    }

    this.#removeFrameAndDescendants(documents, frameId);
    if (documents.size >= 1_000) {
      return false;
    }
    documents.set(documentId, { frameId, parentDocumentId });
    return true;
  }

  ensureTopLevel(tabId: number, documentId: string): void {
    const documents = this.#documentsByTab.get(tabId);
    if (documents?.get(documentId)?.frameId === 0) {
      return;
    }
    this.registerCommitted(tabId, 0, documentId);
  }

  topLevelForRequest(context: RequestDocumentContext): string | null {
    if (
      context.tabId < 0 ||
      (context.documentLifecycle !== undefined &&
        context.documentLifecycle !== "active")
    ) {
      return null;
    }

    const documents = this.#documentsByTab.get(context.tabId);
    if (documents === undefined) {
      return null;
    }

    if (context.documentId !== undefined && documents.has(context.documentId)) {
      return this.#rootFor(documents, context.documentId);
    }

    // A sub-frame document request can arrive before its onCommitted event.
    // Attribute that request through its already-committed parent only.
    if (
      context.type === "sub_frame" &&
      context.parentDocumentId !== undefined &&
      documents.has(context.parentDocumentId)
    ) {
      return this.#rootFor(documents, context.parentDocumentId);
    }

    return null;
  }

  remove(tabId: number): void {
    this.#documentsByTab.delete(tabId);
  }

  clear(): void {
    this.#documentsByTab.clear();
  }

  removeWithoutSession(hasSession: (tabId: number) => boolean): void {
    for (const tabId of this.#documentsByTab.keys()) {
      if (!hasSession(tabId)) {
        this.#documentsByTab.delete(tabId);
      }
    }
  }

  #rootFor(documents: Map<string, DocumentNode>, documentId: string): string | null {
    const visited = new Set<string>();
    let currentId: string | null = documentId;

    while (currentId !== null && !visited.has(currentId)) {
      visited.add(currentId);
      const node = documents.get(currentId);
      if (node === undefined) {
        return null;
      }
      if (node.frameId === 0) {
        return currentId;
      }
      currentId = node.parentDocumentId;
    }

    return null;
  }

  #removeFrameAndDescendants(
    documents: Map<string, DocumentNode>,
    frameId: number,
  ): void {
    const removed = new Set(
      [...documents]
        .filter(([, node]) => node.frameId === frameId)
        .map(([documentId]) => documentId),
    );

    let changed = true;
    while (changed) {
      changed = false;
      for (const [documentId, node] of documents) {
        if (
          node.parentDocumentId !== null &&
          removed.has(node.parentDocumentId) &&
          !removed.has(documentId)
        ) {
          removed.add(documentId);
          changed = true;
        }
      }
    }

    for (const documentId of removed) {
      documents.delete(documentId);
    }
  }
}
