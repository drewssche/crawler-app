import { apiGet, apiPost } from "./client";

export type EventItem = {
  id: number;
  event_type: string;
  channel: "notification" | "action" | string;
  severity: "info" | "warning" | "danger" | string;
  title: string;
  body: string | null;
  target_path: string | null;
  target_ref: string | null;
  actor_user_id: number | null;
  target_user_id: number | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
  is_read: boolean;
  read_at: string | null;
  is_dismissed: boolean;
  dismissed_at: string | null;
  is_handled: boolean;
  handled_at: string | null;
};

export type CenterEventsResponse = {
  notifications: EventItem[];
  actions: EventItem[];
  notifications_unread: number;
  actions_unread: number;
};

export type EventFeedResponse = {
  items: EventItem[];
  total: number;
  page: number;
  page_size: number;
};

export async function getCenterEvents(
  actionsSecurityOnly: boolean,
  options?: { notificationsLimit?: number; actionsLimit?: number; signal?: AbortSignal },
) {
  const qs = new URLSearchParams({
    notifications_limit: String(options?.notificationsLimit ?? 20),
    actions_limit: String(options?.actionsLimit ?? 20),
    actions_security_only: String(actionsSecurityOnly),
  });
  return apiGet<CenterEventsResponse>(`/events/center?${qs.toString()}`, { signal: options?.signal });
}

export async function getEventsFeed(params: {
  channel: "all" | "notification" | "action";
  includeDismissed: boolean;
  onlyUnread: boolean;
  securityOnly: boolean;
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}) {
  const qs = new URLSearchParams({
    channel: params.channel,
    include_dismissed: String(params.includeDismissed),
    only_unread: String(params.onlyUnread),
    security_only: String(params.securityOnly),
    page: String(params.page),
    page_size: String(params.pageSize),
  });
  return apiGet<EventFeedResponse>(`/events/feed?${qs.toString()}`, { signal: params.signal });
}

export async function markEventRead(eventId: number, value: boolean = true) {
  return apiPost<{ ok: boolean; is_read: boolean }>(`/events/${eventId}/read`, { value });
}

export async function setEventDismissed(eventId: number, value: boolean) {
  return apiPost<{ ok: boolean; is_dismissed: boolean }>(`/events/${eventId}/dismiss`, { value });
}

export async function setEventHandled(eventId: number, value: boolean) {
  return apiPost<{ ok: boolean; is_handled: boolean }>(`/events/${eventId}/handled`, { value });
}

export async function markAllEventsRead(channel: "all" | "notification" | "action", securityOnly: boolean = false) {
  return apiPost<{ updated: number }>("/events/read-all", {
    channel,
    security_only: securityOnly,
  });
}
