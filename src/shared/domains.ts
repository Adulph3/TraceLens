import { getDomain } from "tldts";

const WEB_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

export interface ParsedWebUrl {
  hostname: string;
  protocol: "http:" | "https:" | "ws:" | "wss:";
}

export interface ParsedPageUrl {
  hostname: string;
  protocol: "http:" | "https:";
}

export function parseWebUrl(rawUrl: string): ParsedWebUrl | null {
  try {
    const parsed = new URL(rawUrl);
    if (!WEB_PROTOCOLS.has(parsed.protocol) || parsed.hostname.length === 0) {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
    if (hostname.length === 0) {
      return null;
    }

    return {
      hostname,
      protocol: parsed.protocol as ParsedWebUrl["protocol"],
    };
  } catch {
    return null;
  }
}

export function parsePageUrl(rawUrl: string): ParsedPageUrl | null {
  const parsed = parseWebUrl(rawUrl);
  if (parsed === null || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return null;
  }
  return { hostname: parsed.hostname, protocol: parsed.protocol };
}

export function siteKey(hostname: string): string {
  const registrableDomain = getDomain(hostname, { allowPrivateDomains: true });
  return registrableDomain?.toLowerCase() ?? hostname.toLowerCase();
}

export function isThirdPartyHostname(requestHostname: string, pageHostname: string): boolean {
  return siteKey(requestHostname) !== siteKey(pageHostname);
}

export function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}
