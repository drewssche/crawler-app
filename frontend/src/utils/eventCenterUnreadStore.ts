import { getCenterEvents, type CenterEventsResponse } from "../api/events";

export type EventCenterUnreadSnapshot = {
  notificationsUnread: number;
  actionsUnread: number;
  totalUnread: number;
  updatedAt: number;
};

type Listener = (snapshot: EventCenterUnreadSnapshot) => void;

const TTL_MS = 15_000;

let snapshot: EventCenterUnreadSnapshot | null = null;
let inFlight: Promise<EventCenterUnreadSnapshot> | null = null;
const listeners = new Set<Listener>();

function toSnapshot(data: { notifications_unread?: number; actions_unread?: number }): EventCenterUnreadSnapshot {
  const notificationsUnread = Number(data.notifications_unread || 0);
  const actionsUnread = Number(data.actions_unread || 0);
  return {
    notificationsUnread,
    actionsUnread,
    totalUnread: notificationsUnread + actionsUnread,
    updatedAt: Date.now(),
  };
}

function emit(next: EventCenterUnreadSnapshot) {
  listeners.forEach((listener) => listener(next));
}

export function publishEventCenterUnreadFromData(data: Pick<CenterEventsResponse, "notifications_unread" | "actions_unread">): EventCenterUnreadSnapshot {
  const next = toSnapshot(data);
  snapshot = next;
  emit(next);
  return next;
}

export function getEventCenterUnreadSnapshot(): EventCenterUnreadSnapshot | null {
  return snapshot;
}

export async function getEventCenterUnreadShared(force = false): Promise<EventCenterUnreadSnapshot> {
  const now = Date.now();
  if (!force && snapshot && now - snapshot.updatedAt < TTL_MS) {
    return snapshot;
  }
  if (inFlight) return inFlight;
  inFlight = getCenterEvents(false, { notificationsLimit: 1, actionsLimit: 1 })
    .then((center) => publishEventCenterUnreadFromData(center))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function subscribeEventCenterUnread(listener: Listener): () => void {
  listeners.add(listener);
  if (snapshot) {
    listener(snapshot);
  }
  return () => {
    listeners.delete(listener);
  };
}

