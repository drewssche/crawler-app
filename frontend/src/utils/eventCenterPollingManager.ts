import { getCenterEvents, type CenterEventsResponse } from "../api/events";
import { API_BASE, getToken } from "../api/client";
import { publishEventCenterUnreadFromData } from "./eventCenterUnreadStore";

export type EventCenterPollSnapshot = {
  data: CenterEventsResponse;
  updatedAt: number;
};

type Listener = (snapshot: EventCenterPollSnapshot) => void;

const REFRESH_MS = 15_000;
const TOP_LIMIT = 20;
const SSE_RECONNECT_MS = 3_000;
const SSE_CONNECT_TIMEOUT_MS = 5_000;
const SSE_MAX_OPEN_FAILURES = 2;
const PUSH_MODE = String(import.meta.env.VITE_EVENT_CENTER_PUSH_MODE ?? "auto").toLowerCase();
const SSE_PATH = String(import.meta.env.VITE_EVENT_CENTER_SSE_PATH ?? "/events/center/stream");
const SSE_TOKEN_QUERY_PARAM = String(import.meta.env.VITE_EVENT_CENTER_SSE_TOKEN_QUERY_PARAM ?? "").trim();

let snapshot: EventCenterPollSnapshot | null = null;
let inFlight: Promise<EventCenterPollSnapshot> | null = null;
let pollTimer: number | null = null;
let sse: EventSource | null = null;
let sseReconnectTimer: number | null = null;
let sseConnectTimeout: number | null = null;
let sseOpened = false;
let sseOpenFailures = 0;
let usePush = false;
let pushDisabledForSession = false;
const listeners = new Set<Listener>();

function emit(next: EventCenterPollSnapshot) {
  listeners.forEach((listener) => listener(next));
}

async function fetchPollData(): Promise<EventCenterPollSnapshot> {
  if (inFlight) return inFlight;
  inFlight = getCenterEvents(false, {
    notificationsLimit: TOP_LIMIT,
    actionsLimit: TOP_LIMIT,
  })
    .then((data) => {
      publishEventCenterUnreadFromData(data);
      const next = { data, updatedAt: Date.now() };
      snapshot = next;
      emit(next);
      return next;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function startPolling() {
  if (pollTimer !== null) return;
  void fetchPollData();
  pollTimer = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    void fetchPollData();
  }, REFRESH_MS);
}

function stopPolling() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function normalizeSsePayload(raw: unknown): CenterEventsResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const data = (obj.data && typeof obj.data === "object") ? (obj.data as Record<string, unknown>) : obj;
  if (!Array.isArray(data.notifications) || !Array.isArray(data.actions)) return null;
  const notificationsUnread = Number(data.notifications_unread ?? 0);
  const actionsUnread = Number(data.actions_unread ?? 0);
  return {
    notifications: data.notifications as CenterEventsResponse["notifications"],
    actions: data.actions as CenterEventsResponse["actions"],
    notifications_unread: Number.isFinite(notificationsUnread) ? notificationsUnread : 0,
    actions_unread: Number.isFinite(actionsUnread) ? actionsUnread : 0,
  };
}

function emitSnapshot(data: CenterEventsResponse) {
  publishEventCenterUnreadFromData(data);
  const next = { data, updatedAt: Date.now() };
  snapshot = next;
  emit(next);
}

function shouldUsePush() {
  if (pushDisabledForSession) return false;
  if (PUSH_MODE === "off" || PUSH_MODE === "poll") return false;
  if (typeof EventSource === "undefined") return false;
  return true;
}

function buildSseUrl() {
  const base = API_BASE.replace(/\/+$/, "");
  const path = SSE_PATH.startsWith("/") ? SSE_PATH : `/${SSE_PATH}`;
  const url = new URL(`${base}${path}`);
  url.searchParams.set("notifications_limit", String(TOP_LIMIT));
  url.searchParams.set("actions_limit", String(TOP_LIMIT));
  url.searchParams.set("actions_security_only", "false");
  if (SSE_TOKEN_QUERY_PARAM) {
    const token = getToken();
    if (token) {
      url.searchParams.set(SSE_TOKEN_QUERY_PARAM, token);
    }
  }
  return url.toString();
}

function clearSseTimers() {
  if (sseReconnectTimer !== null) {
    window.clearTimeout(sseReconnectTimer);
    sseReconnectTimer = null;
  }
  if (sseConnectTimeout !== null) {
    window.clearTimeout(sseConnectTimeout);
    sseConnectTimeout = null;
  }
}

function stopSse() {
  clearSseTimers();
  sseOpened = false;
  if (sse) {
    sse.close();
    sse = null;
  }
}

function scheduleSseReconnect() {
  if (listeners.size === 0) return;
  if (!usePush) return;
  if (pushDisabledForSession) return;
  if (sseReconnectTimer !== null) return;
  sseReconnectTimer = window.setTimeout(() => {
    sseReconnectTimer = null;
    startSse();
  }, SSE_RECONNECT_MS);
}

function startSse() {
  if (!usePush) return;
  if (sse) return;
  try {
    sse = new EventSource(buildSseUrl(), { withCredentials: true });
  } catch {
    startPolling();
    scheduleSseReconnect();
    return;
  }
  sseOpened = false;
  sseConnectTimeout = window.setTimeout(() => {
    sseConnectTimeout = null;
    if (sseOpened) return;
    sseOpenFailures += 1;
    if (sseOpenFailures >= SSE_MAX_OPEN_FAILURES) {
      pushDisabledForSession = true;
      usePush = false;
    }
    stopSse();
    startPolling();
    scheduleSseReconnect();
  }, SSE_CONNECT_TIMEOUT_MS);

  sse.onopen = () => {
    sseOpened = true;
    sseOpenFailures = 0;
    if (sseConnectTimeout !== null) {
      window.clearTimeout(sseConnectTimeout);
      sseConnectTimeout = null;
    }
    stopPolling();
  };

  sse.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as unknown;
      const normalized = normalizeSsePayload(parsed);
      if (!normalized) return;
      emitSnapshot(normalized);
      stopPolling();
    } catch {
      // Ignore malformed push payload and keep transport alive.
    }
  };

  sse.onerror = () => {
    if (!sseOpened) {
      sseOpenFailures += 1;
      if (sseOpenFailures >= SSE_MAX_OPEN_FAILURES) {
        pushDisabledForSession = true;
        usePush = false;
      }
    }
    stopSse();
    startPolling();
    scheduleSseReconnect();
  };
}

function ensureRunning() {
  usePush = shouldUsePush();
  if (usePush) {
    startPolling();
    startSse();
    return;
  }
  startPolling();
}

function stopIfIdle() {
  if (listeners.size > 0) return;
  stopPolling();
  stopSse();
  usePush = false;
}

export function refreshEventCenterPollingNow(): Promise<EventCenterPollSnapshot> {
  return fetchPollData();
}

export function subscribeEventCenterPolling(listener: Listener, options?: { emitCurrent?: boolean }): () => void {
  listeners.add(listener);
  if (options?.emitCurrent !== false && snapshot) {
    listener(snapshot);
  }
  ensureRunning();
  return () => {
    listeners.delete(listener);
    stopIfIdle();
  };
}
