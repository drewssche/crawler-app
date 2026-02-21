import type { EventItem } from "../api/events";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

type Resolver = (item: EventItem) => string;

const EVENT_TYPE_ROUTES: Record<string, Resolver> = {
  "auth.request_access": (item) => {
    const email = asString(item.meta?.email);
    return email ? `/users?tab=pending&highlight_email=${encodeURIComponent(email.toLowerCase())}` : "/users?tab=pending";
  },
};

export function resolveEventDestination(item: EventItem): string {
  if (item.target_path && item.target_path.trim()) return item.target_path;

  const direct = EVENT_TYPE_ROUTES[item.event_type];
  if (direct) return direct(item);

  if (item.channel === "action") {
    const logId = asNumber(item.meta?.audit_log_id);
    if (logId !== null) return `/logs?highlight_log_id=${logId}`;
    return "/logs";
  }

  return "/events";
}

