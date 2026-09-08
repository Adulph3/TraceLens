import { classifyTracker } from "./classifier.ts";
import { isThirdPartyHostname, parsePageUrl, parseWebUrl, siteKey } from "../shared/domains.ts";
import type {
  ObservationCoverage,
  ThirdPartyFinding,
  TrackerCategory,
} from "../shared/types.ts";

const MAX_THIRD_PARTY_DOMAINS = 1_000;

const RESOURCE_TYPES = new Set([
  "beacon",
  "csp_report",
  "font",
  "image",
  "imageset",
  "main_frame",
  "media",
  "object",
  "object_subrequest",
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
]);

export interface ObservedResource {
  tabId: number;
  topLevelDocumentId: string;
  url: string;
  type: string;
}

interface DomainAggregate {
  domain: string;
  requestCount: number;
  classification: ThirdPartyFinding["classification"];
  company?: string;
  category?: TrackerCategory;
}

interface TabSession {
  tabId: number;
  generation: number;
  documentId: string;
  hostname: string;
  protocol: "http:" | "https:";
  startedAt: number;
  lastActivityAt: number;
  coverage: ObservationCoverage;
  lateMainConfirmationAllowed: boolean;
  totalRequests: number;
  firstPartyRequests: number;
  thirdPartyRequests: number;
  requestsByType: Map<string, number>;
  thirdParties: Map<string, DomainAggregate>;
  overflowRequests: number;
}

export interface SessionSnapshot {
  tabId: number;
  generation: number;
  documentId: string;
  hostname: string;
  protocol: "http:" | "https:";
  startedAt: number;
  coverage: ObservationCoverage;
  totalRequests: number;
  firstPartyRequests: number;
  thirdPartyRequests: number;
  requestsByType: Record<string, number>;
  thirdParties: ThirdPartyFinding[];
  overflowRequests: number;
}

export class AnalysisStore {
  readonly #sessions = new Map<number, TabSession>();
  readonly #now: () => number;
  #nextGeneration = 1;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  commitNavigation(
    tabId: number,
    rawUrl: string,
    documentId: string,
    mainRequestObserved: boolean,
    allowLateMainConfirmation = false,
  ): boolean {
    const page = parsePageUrl(rawUrl);
    if (tabId < 0 || page === null || documentId.length === 0) {
      this.remove(tabId);
      return false;
    }

    const now = this.#now();
    const requestsByType = new Map<string, number>();
    if (mainRequestObserved) {
      requestsByType.set("main_frame", 1);
    }

    this.#sessions.set(tabId, {
      tabId,
      generation: this.#nextGeneration,
      documentId,
      hostname: page.hostname,
      protocol: page.protocol,
      startedAt: now,
      lastActivityAt: now,
      coverage: mainRequestObserved ? "full-navigation" : "partial",
      lateMainConfirmationAllowed:
        !mainRequestObserved && allowLateMainConfirmation,
      totalRequests: mainRequestObserved ? 1 : 0,
      firstPartyRequests: mainRequestObserved ? 1 : 0,
      thirdPartyRequests: 0,
      requestsByType,
      thirdParties: new Map(),
      overflowRequests: 0,
    });
    this.#nextGeneration += 1;
    return true;
  }

  ensurePartialSession(
    tabId: number,
    rawUrl: string,
    documentId: string,
  ): SessionSnapshot | null {
    const page = parsePageUrl(rawUrl);
    if (tabId < 0 || page === null || documentId.length === 0) {
      this.remove(tabId);
      return null;
    }

    const existing = this.#sessions.get(tabId);
    if (
      existing !== undefined &&
      existing.hostname === page.hostname &&
      existing.documentId === documentId
    ) {
      return this.snapshot(tabId);
    }

    const now = this.#now();
    this.#sessions.set(tabId, {
      tabId,
      generation: this.#nextGeneration,
      documentId,
      hostname: page.hostname,
      protocol: page.protocol,
      startedAt: now,
      lastActivityAt: now,
      coverage: "partial",
      lateMainConfirmationAllowed: false,
      totalRequests: 0,
      firstPartyRequests: 0,
      thirdPartyRequests: 0,
      requestsByType: new Map(),
      thirdParties: new Map(),
      overflowRequests: 0,
    });
    this.#nextGeneration += 1;
    return this.snapshot(tabId);
  }

  recordResource(resource: ObservedResource): boolean {
    if (resource.tabId < 0 || resource.type === "main_frame") {
      return false;
    }

    const session = this.#sessions.get(resource.tabId);
    const target = parseWebUrl(resource.url);
    if (
      session === undefined ||
      target === null ||
      resource.topLevelDocumentId !== session.documentId
    ) {
      return false;
    }

    session.totalRequests += 1;
    session.lastActivityAt = this.#now();
    const resourceType = normalizeResourceType(resource.type);
    session.requestsByType.set(
      resourceType,
      (session.requestsByType.get(resourceType) ?? 0) + 1,
    );

    const thirdParty = isThirdPartyHostname(target.hostname, session.hostname);
    if (!thirdParty) {
      session.firstPartyRequests += 1;
      return true;
    }

    session.thirdPartyRequests += 1;
    const tracker = classifyTracker(target.hostname);
    const aggregateKey = tracker?.domain ?? siteKey(target.hostname);
    const existing = session.thirdParties.get(aggregateKey);
    if (existing !== undefined) {
      existing.requestCount += 1;
      return true;
    }

    if (session.thirdParties.size >= MAX_THIRD_PARTY_DOMAINS) {
      session.overflowRequests += 1;
      session.coverage = "partial";
      session.lateMainConfirmationAllowed = false;
      return true;
    }

    session.thirdParties.set(aggregateKey, {
      domain: aggregateKey,
      requestCount: 1,
      classification: tracker === null ? "unknown-third-party" : "known-tracker",
      ...(tracker === null
        ? {}
        : { company: tracker.company, category: tracker.category }),
    });
    return true;
  }

  snapshot(tabId: number): SessionSnapshot | null {
    const session = this.#sessions.get(tabId);
    if (session === undefined) {
      return null;
    }

    return {
      tabId: session.tabId,
      generation: session.generation,
      documentId: session.documentId,
      hostname: session.hostname,
      protocol: session.protocol,
      startedAt: session.startedAt,
      coverage: session.coverage,
      totalRequests: session.totalRequests,
      firstPartyRequests: session.firstPartyRequests,
      thirdPartyRequests: session.thirdPartyRequests,
      requestsByType: Object.fromEntries(session.requestsByType),
      thirdParties: [...session.thirdParties.values()].map((finding) => ({ ...finding })),
      overflowRequests: session.overflowRequests,
    };
  }

  isCurrent(tabId: number, generation: number, documentId: string): boolean {
    const session = this.#sessions.get(tabId);
    return session?.generation === generation && session.documentId === documentId;
  }

  isDocumentCurrentOrMissing(tabId: number, documentId: string): boolean {
    const session = this.#sessions.get(tabId);
    return session === undefined || session.documentId === documentId;
  }

  has(tabId: number): boolean {
    return this.#sessions.has(tabId);
  }

  markPartial(tabId: number): void {
    const session = this.#sessions.get(tabId);
    if (session !== undefined) {
      session.coverage = "partial";
      session.lateMainConfirmationAllowed = false;
    }
  }

  confirmLateMainRequest(tabId: number, documentId: string): boolean {
    const session = this.#sessions.get(tabId);
    if (
      session === undefined ||
      session.documentId !== documentId ||
      session.coverage !== "partial" ||
      !session.lateMainConfirmationAllowed
    ) {
      return false;
    }

    session.coverage = "full-navigation";
    session.lateMainConfirmationAllowed = false;
    session.totalRequests += 1;
    session.firstPartyRequests += 1;
    session.requestsByType.set("main_frame", 1);
    session.lastActivityAt = this.#now();
    return true;
  }

  remove(tabId: number): void {
    this.#sessions.delete(tabId);
  }

  clear(): void {
    this.#sessions.clear();
  }

  removeExpired(maxAgeMs: number): number {
    const cutoff = this.#now() - maxAgeMs;
    let removed = 0;
    for (const [tabId, session] of this.#sessions) {
      if (session.lastActivityAt < cutoff) {
        this.#sessions.delete(tabId);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.#sessions.size;
  }
}

function normalizeResourceType(type: string): string {
  return RESOURCE_TYPES.has(type) ? type : "other";
}
