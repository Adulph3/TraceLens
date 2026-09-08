import type {
  QuerySitePermissionsRequest,
  SitePermissionFinding,
  SitePermissionName,
  SitePermissionsResponse,
} from "../shared/types.ts";
import { normalizePermissionState } from "../core/report.ts";

const PERMISSIONS: readonly SitePermissionName[] = [
  "geolocation",
  "notifications",
  "camera",
  "microphone",
];

browser.runtime.onMessage.addListener((message: unknown) => {
  if (!isPermissionQuery(message)) {
    return undefined;
  }
  return querySitePermissions();
});

async function querySitePermissions(): Promise<SitePermissionsResponse> {
  const items = await Promise.all(PERMISSIONS.map(queryPermission));
  return { type: "SITE_PERMISSIONS_RESULT", items };
}

async function queryPermission(name: SitePermissionName): Promise<SitePermissionFinding> {
  if (navigator.permissions === undefined) {
    return { name, state: "unavailable" };
  }

  try {
    const status = await navigator.permissions.query({ name } as PermissionDescriptor);
    return { name, state: normalizePermissionState(status.state) };
  } catch {
    if (name === "notifications" && "Notification" in globalThis) {
      return { name, state: normalizePermissionState(Notification.permission) };
    }
    return { name, state: "unsupported" };
  }
}

function isPermissionQuery(message: unknown): message is QuerySitePermissionsRequest {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "QUERY_SITE_PERMISSIONS"
  );
}
