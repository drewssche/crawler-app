import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { markEventRead, setEventDismissed, setEventHandled, type EventItem } from "../../api/events";
import { apiPost } from "../../api/client";
import { useAuth } from "../../hooks/auth";
import { runEventPrimaryAction } from "../../utils/eventPrimaryAction";
import { formatApiTime } from "../../utils/datetime";
import { UI_BULLET } from "../../utils/uiText";
import { getEventRelevance } from "../../utils/relevance";
import { getMonitoringFocusMeta, loadMonitoringContext, type FocusHistoryResponse } from "../../utils/monitoringContext";
import { getAuditActionCatalogCached, getUserAndTrustCatalogsCached } from "../../utils/catalogCache";
import { loadUserContextByEmail, loadUserContextById } from "../../utils/userContext";
import { refreshEventCenterPollingNow, subscribeEventCenterPolling } from "../../utils/eventCenterPollingManager";
import Button from "../ui/Button";
import Card from "../ui/Card";
import ContextQuickActions from "../ui/ContextQuickActions";
import EmptyState from "../ui/EmptyState";
import EventCardActions from "../ui/EventCardActions";
import RelevanceBadge from "../ui/RelevanceBadge";
import SlidePanel from "../ui/SlidePanel";
import ToastHost, { type ToastItem } from "../ui/ToastHost";
import UserActionPanel, { type ActionCatalogItem, type BulkAction, type TrustPolicy, type TrustPolicyCatalogItem } from "../users/UserActionPanel";
import type { UserDetailsResponse } from "../users/UserDetailsDrawer";
import { UserStatusPills } from "../users/UserStatusPills";
import { buildAuthSecurityQuickActions } from "../users/userContextQuickActions";
import MonitoringContextCard from "../monitoring/MonitoringContextCard";
import EventMetaPills from "../ui/EventMetaPills";

type Props = {
  collapsed: boolean;
  onToggle: () => void;
};

const POLL_TOP_LIMIT = 20;

function mergeWithTopWindow(previous: EventItem[], freshTop: EventItem[], targetLimit: number): EventItem[] {
  const limit = Math.max(POLL_TOP_LIMIT, targetLimit);
  const top = freshTop.slice(0, Math.min(freshTop.length, limit));
  if (limit <= POLL_TOP_LIMIT) return top;
  const topIds = new Set(top.map((x) => x.id));
  const extras = previous.filter((x) => !topIds.has(x.id)).slice(0, Math.max(0, limit - top.length));
  return [...top, ...extras];
}

function eventRenderKey(item: EventItem): string {
  return [
    item.id,
    item.is_read ? 1 : 0,
    item.is_dismissed ? 1 : 0,
    item.is_handled ? 1 : 0,
    item.severity,
    item.channel,
    item.title || "",
    item.body || "",
    item.created_at || "",
  ].join("|");
}

function areEventListsEqual(a: EventItem[], b: EventItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (eventRenderKey(a[i]) !== eventRenderKey(b[i])) return false;
  }
  return true;
}

function shortText(value: string | null | undefined, max = 120): string {
  if (!value) return "";
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function toastAccentBySeverity(severity: EventItem["severity"]): ToastItem["accent"] {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  if (severity === "info") return "info";
  return "neutral";
}


const CARD_MIN_HEIGHT = 132;
const HEADER_MIN_HEIGHT = 24;
const BODY_MIN_HEIGHT = 40;
const RELEVANCE_SLOT_WIDTH = 72;
function isSelfEvent(item: EventItem, currentUserEmail: string) {
  const relevance = getEventRelevance({
    body: item.body,
    targetEmail: typeof item.meta?.target_email === "string" ? item.meta.target_email : null,
    currentUserEmail,
  });
  return relevance === "self";
}

function NotificationCard({
  item,
  onOpenPanel,
  onOpenSource,
  onDismiss,
  currentUserEmail,
}: {
  item: EventItem;
  onOpenPanel: (item: EventItem) => void;
  onOpenSource: (item: EventItem) => void;
  onDismiss: (item: EventItem) => void;
  currentUserEmail: string;
}) {
  const unread = !item.is_read;
  const relevance = getEventRelevance({
    body: item.body,
    targetEmail: typeof item.meta?.target_email === "string" ? item.meta.target_email : null,
    currentUserEmail,
  });
  const effectiveUnread = unread && relevance !== "self";
  return (
    <Card
      className="interactive-row"
      style={{
        padding: 10,
        minHeight: 104,
        cursor: "pointer",
        borderColor: effectiveUnread ? "rgba(106,160,255,0.55)" : "#3333",
        background: effectiveUnread ? "rgba(106,160,255,0.08)" : "rgba(255,255,255,0.03)",
        transition: "border-color 0.15s ease, background 0.15s ease",
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => onOpenPanel(item)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: 0,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          gap: 6,
          lineHeight: 1.25,
          cursor: "pointer",
          minHeight: 84,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: 8,
            alignItems: "start",
            minHeight: HEADER_MIN_HEIGHT,
          }}
        >
          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 12,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                wordBreak: "break-word",
              }}
            >
              {item.title}
            </div>
            <div style={{ minHeight: 20, width: RELEVANCE_SLOT_WIDTH, display: "flex", alignItems: "center" }}>
              <RelevanceBadge relevance={relevance} />
            </div>
          </div>
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(item);
            }}
            size="sm"
            variant="ghost"
            style={{ padding: "0 6px", minHeight: 22 }}
            title="Скрыть уведомление"
          >
            ×
          </Button>
        </div>
        <div style={{ minHeight: BODY_MIN_HEIGHT }}>
          <div
            style={{
              opacity: 0.9,
              fontSize: 11,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              wordBreak: "break-word",
            }}
          >
            {item.body || "Без описания"}
          </div>
          <div style={{ opacity: 0.68, fontSize: 11, marginTop: 4 }}>Когда: {formatApiTime(item.created_at)}</div>
        </div>
        <div>
          <EventCardActions
            item={item}
            compact
            onOpen={onOpenSource}
            showReadToggle={false}
            showDismissToggle={false}
            showMoreMenu={false}
          />
        </div>
      </div>
    </Card>
  );
}

function ActionCard({
  item,
  onOpenPanel,
  onOpenSource,
  onDismiss,
  actionLabel,
  currentUserEmail,
}: {
  item: EventItem;
  onOpenPanel: (item: EventItem) => void;
  onOpenSource: (item: EventItem) => void;
  onDismiss: (item: EventItem) => void;
  actionLabel?: string;
  currentUserEmail: string;
}) {
  const unread = !item.is_read;
  const relevance = getEventRelevance({
    body: item.body,
    targetEmail: typeof item.meta?.target_email === "string" ? item.meta.target_email : null,
    currentUserEmail,
  });
  const effectiveUnread = unread && relevance !== "self";
  return (
    <Card
      className="interactive-row"
      style={{
        padding: 10,
        minHeight: CARD_MIN_HEIGHT,
        cursor: "pointer",
        borderColor: effectiveUnread ? "rgba(106,160,255,0.45)" : "#3333",
        background: effectiveUnread ? "rgba(106,160,255,0.07)" : "rgba(255,255,255,0.03)",
      }}
    >
      <div
        onClick={() => onOpenPanel(item)}
        style={{
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          gap: 6,
          cursor: "pointer",
          minHeight: CARD_MIN_HEIGHT - 20,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: 8,
            alignItems: "start",
            minHeight: HEADER_MIN_HEIGHT,
          }}
        >
          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {actionLabel || item.title}
            </div>
            <div style={{ minHeight: 20, width: RELEVANCE_SLOT_WIDTH, display: "flex", alignItems: "center" }}>
              <RelevanceBadge relevance={relevance} />
            </div>
          </div>
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(item);
            }}
            size="sm"
            variant="ghost"
            style={{ padding: "0 6px", minHeight: 22 }}
            title="Скрыть событие"
          >
            ×
          </Button>
        </div>
        <div style={{ minHeight: BODY_MIN_HEIGHT }}>
          <div
            style={{
              opacity: 0.78,
              fontSize: 12,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {item.body || "Без описания"}
          </div>
          <div style={{ opacity: 0.72, fontSize: 11, marginTop: 4 }}>{formatApiTime(item.created_at)}</div>
        </div>
        <div>
          <EventCardActions
            item={item}
            compact
            onOpen={onOpenSource}
            showReadToggle={false}
            showDismissToggle={false}
            showMoreMenu={false}
          />
        </div>
      </div>
    </Card>
  );
}

export default function SidebarRight({ collapsed, onToggle }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<EventItem[]>([]);
  const [actions, setActions] = useState<EventItem[]>([]);
  const notificationsRef = useRef<EventItem[]>([]);
  const actionsRef = useRef<EventItem[]>([]);
  const [actionLabels, setActionLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenTopNotificationIdsRef = useRef<Set<number>>(new Set());
  const seenTopActionIdsRef = useRef<Set<number>>(new Set());
  const [contextItem, setContextItem] = useState<EventItem | null>(null);
  const [monitoringFocus, setMonitoringFocus] = useState<FocusHistoryResponse | null>(null);
  const [monitoringFocusRangeMinutes, setMonitoringFocusRangeMinutes] = useState(60);
  const [monitoringErrorRows, setMonitoringErrorRows] = useState<Array<{ labels: string; value: number }>>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState("");
  const [contextUser, setContextUser] = useState<UserDetailsResponse | null>(null);
  const [contextAvailableActions, setContextAvailableActions] = useState<BulkAction[]>([]);
  const [actionCatalog, setActionCatalog] = useState<Record<BulkAction, ActionCatalogItem>>({} as Record<BulkAction, ActionCatalogItem>);
  const [trustPolicyCatalog, setTrustPolicyCatalog] = useState<Record<TrustPolicy, TrustPolicyCatalogItem>>({} as Record<TrustPolicy, TrustPolicyCatalogItem>);

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  const markLocalRead = useCallback((eventId: number) => {
    setNotifications((prev) => prev.map((x) => (x.id === eventId ? { ...x, is_read: true } : x)));
    setActions((prev) => prev.map((x) => (x.id === eventId ? { ...x, is_read: true } : x)));
    setContextItem((prev) => (prev && prev.id === eventId ? { ...prev, is_read: true } : prev));
  }, []);

  const openEventFromToast = useCallback(
    async (item: EventItem) => {
      await runEventPrimaryAction({
        item,
        navigate,
        onLocalRead: markLocalRead,
      });
    },
    [markLocalRead, navigate],
  );

  const openEventContextFromToast = useCallback(
    async (item: EventItem) => {
      if (!item.is_read) {
        try {
          await markEventRead(item.id, true);
          markLocalRead(item.id);
        } catch {
          // no-op
        }
      }
      setContextItem(item);
    },
    [markLocalRead],
  );

  const buildToastFromEvent = useCallback(
    (item: EventItem, kind: "notification" | "action"): ToastItem => {
      const prefix = kind === "notification" ? "Новое уведомление" : "Новое действие";
      const title = shortText(item.title, 72) || prefix;
      const bodyParts = [shortText(item.body, 110), `Когда: ${formatApiTime(item.created_at)}`].filter(Boolean);
      const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
      return {
        id: `evt-${item.id}`,
        title: title === prefix ? title : `${prefix}: ${title}`,
        body: bodyParts.join(UI_BULLET),
        accent: toastAccentBySeverity(item.severity),
        actionLabel: "Открыть",
        onAction: () => openEventFromToast(item),
        onClick: () => openEventFromToast(item),
        secondaryActionLabel: isDesktop ? "Открыть контекст" : undefined,
        onSecondaryAction: isDesktop ? () => openEventContextFromToast(item) : undefined,
      };
    },
    [openEventContextFromToast, openEventFromToast],
  );

  const applyPolledData = useCallback((data: { notifications: EventItem[]; actions: EventItem[] }) => {
    const nextNotifications = mergeWithTopWindow(notificationsRef.current, data.notifications, POLL_TOP_LIMIT);
    const nextActions = mergeWithTopWindow(actionsRef.current, data.actions, POLL_TOP_LIMIT);
    const notificationsChanged = !areEventListsEqual(notificationsRef.current, nextNotifications);
    const actionsChanged = !areEventListsEqual(actionsRef.current, nextActions);
    if (notificationsChanged) {
      notificationsRef.current = nextNotifications;
      setNotifications(nextNotifications);
    }
    if (actionsChanged) {
      actionsRef.current = nextActions;
      setActions(nextActions);
    }
    if (notificationsChanged || actionsChanged || error) {
      setError("");
      setLastUpdated(new Date().toLocaleTimeString());
    }

    const topNotification = data.notifications[0];
    if (topNotification) {
      const wasSeen = seenTopNotificationIdsRef.current.has(topNotification.id);
      if (!wasSeen && collapsed && !isSelfEvent(topNotification, user?.email ?? "")) {
        const toast = buildToastFromEvent(topNotification, "notification");
        setToasts((prev) => [toast, ...prev.filter((x) => x.id !== toast.id)]);
      }
      seenTopNotificationIdsRef.current.add(topNotification.id);
    }

    const topAction = data.actions[0];
    if (topAction) {
      const wasSeen = seenTopActionIdsRef.current.has(topAction.id);
      if (!wasSeen && collapsed && !isSelfEvent(topAction, user?.email ?? "")) {
        const toast = buildToastFromEvent(topAction, "action");
        setToasts((prev) => [toast, ...prev.filter((x) => x.id !== toast.id)]);
      }
      seenTopActionIdsRef.current.add(topAction.id);
    }
  }, [
    buildToastFromEvent,
    collapsed,
    user?.email,
    error,
  ]);

  useEffect(() => {
    return subscribeEventCenterPolling(
      (next) => {
        applyPolledData(next.data);
      },
      { emitCurrent: true },
    );
  }, [applyPolledData]);
  useEffect(() => {
    let active = true;
    getAuditActionCatalogCached()
      .then((actions) => {
        if (!active) return;
        const map: Record<string, string> = {};
        for (const item of actions || []) {
          map[item.action] = item.label;
        }
        setActionLabels(map);
      })
      .catch(() => {
        if (!active) return;
        setActionLabels({});
      });
    return () => {
      active = false;
    };
  }, []);

  const loadUserActionCatalogs = useCallback(async () => {
    const { actionCatalog: actions, trustPolicyCatalog: trust } = await getUserAndTrustCatalogsCached();
    setActionCatalog(actions);
    setTrustPolicyCatalog(trust);
  }, []);

  useEffect(() => {
    let active = true;
    loadUserActionCatalogs().catch(() => {
      if (!active) return;
      // Keep previous values on transient failure instead of downgrading UI to fallback mode.
    });
    return () => {
      active = false;
    };
  }, [loadUserActionCatalogs]);

  async function onOpenEventSource(item: EventItem) {
    await runEventPrimaryAction({
      item,
      navigate,
      onLocalRead: markLocalRead,
    });
  }

  async function onOpenEventPanel(item: EventItem) {
    const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
    if (!isDesktop) {
      await onOpenEventSource(item);
      return;
    }
    if (!item.is_read) {
      try {
        await markEventRead(item.id, true);
        markLocalRead(item.id);
      } catch {
        // no-op
      }
    }
    if (Object.keys(actionCatalog).length === 0 || Object.keys(trustPolicyCatalog).length === 0) {
      try {
        await loadUserActionCatalogs();
      } catch {
        // no-op
      }
    }
    setContextItem((prev) => (prev && prev.id === item.id ? prev : item));
  }

  async function onDismissEvent(item: EventItem) {
    try {
      await setEventDismissed(item.id, true);
      setNotifications((prev) => prev.filter((x) => x.id !== item.id));
      setActions((prev) => prev.filter((x) => x.id !== item.id));
    } catch {
      // no-op
    }
  }

  async function onMarkHandled(item: EventItem) {
    try {
      await Promise.all([markEventRead(item.id, true), setEventHandled(item.id, true)]);
      setNotifications((prev) => prev.map((x) => (x.id === item.id ? { ...x, is_read: true, is_handled: true } : x)));
      setActions((prev) => prev.map((x) => (x.id === item.id ? { ...x, is_read: true, is_handled: true } : x)));
      setContextItem((prev) => (prev && prev.id === item.id ? { ...prev, is_read: true, is_handled: true } : prev));
    } catch {
      // no-op
    }
  }

  async function runContextUserAction(payload: { action: BulkAction; role?: "viewer" | "editor" | "admin"; trust_policy?: TrustPolicy; reason?: string }) {
    if (!contextUser?.user?.id) return;
    await apiPost("/admin/users/bulk", {
      user_ids: [contextUser.user.id],
      action: payload.action,
      role: payload.role,
      trust_policy: payload.trust_policy,
      reason: payload.reason,
    });
    const refreshed = await loadUserContextById(contextUser.user.id);
    setContextUser(refreshed.details);
    setContextAvailableActions(refreshed.availableActions);
  }

  useEffect(() => {
    let active = true;
    async function loadContextData() {
      if (!contextItem) {
        setMonitoringFocus(null);
        setMonitoringErrorRows([]);
        setContextUser(null);
        setContextAvailableActions([]);
        setContextError("");
        setContextLoading(false);
        return;
      }
      setContextLoading(true);
      setContextError("");
      setContextUser(null);
      setContextAvailableActions([]);
      const { isMonitoring } = getMonitoringFocusMeta(contextItem);
      try {
        const tasks: Promise<unknown>[] = [];

        const targetEmail = (typeof contextItem.meta?.target_email === "string" ? contextItem.meta.target_email : "")
          || (typeof contextItem.meta?.email === "string" ? contextItem.meta.email : "");
        const normalizedEmail = targetEmail.trim().toLowerCase();
        if (normalizedEmail) {
          tasks.push(
            (async () => {
              const context = await loadUserContextByEmail(normalizedEmail);
              if (!context || !active) return;
              if (!active) return;
              setContextUser(context.details);
              setContextAvailableActions(context.availableActions);
            })(),
          );
        }

        if (isMonitoring) {
          tasks.push(
            (async () => {
              const ctx = await loadMonitoringContext(contextItem);
              if (!active) return;
              setMonitoringFocus(ctx.history);
              setMonitoringFocusRangeMinutes(ctx.rangeMinutes);
              setMonitoringErrorRows(ctx.errorRows);
            })(),
          );
        } else {
          setMonitoringFocus(null);
          setMonitoringErrorRows([]);
          setMonitoringFocusRangeMinutes(60);
        }

        if (tasks.length > 0) await Promise.all(tasks);
      } catch {
        if (!active) return;
        setMonitoringFocus(null);
        setMonitoringErrorRows([]);
        setContextUser(null);
        setContextAvailableActions([]);
        setContextError("Не удалось загрузить полный контекст события.");
      } finally {
        if (!active) return;
        setContextLoading(false);
      }
    }
    loadContextData();
    return () => {
      active = false;
    };
  }, [contextItem]);

  const isAuthSecurityContextEvent = Boolean(
    contextItem?.event_type?.startsWith("auth.") || contextItem?.event_type?.startsWith("security."),
  );

  const sectionHeader = useMemo(
    () => (
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", fontSize: 12, opacity: 0.85 }}>
        <Button
          onClick={() => {
            refreshEventCenterPollingNow().catch(() => {
              setError("Центр событий недоступен (только для администратора).");
            });
          }}
          size="sm"
          variant="secondary"
        >
          Обновить
        </Button>
        <Button onClick={() => navigate("/events")} size="sm" variant="ghost">Показать все</Button>
        <span>{lastUpdated ? `обновлено: ${lastUpdated}` : ""}</span>
      </div>
    ),
    [lastUpdated, navigate],
  );

  return (
    <>
      <ToastHost items={toasts} onClose={(id) => setToasts((prev) => prev.filter((x) => x.id !== id))} />
      <aside
        style={{
          border: "1px solid #3333",
          borderRadius: 12,
          height: "100%",
          boxSizing: "border-box",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "start center",
            paddingTop: 8,
            opacity: collapsed ? 1 : 0,
            transform: collapsed ? "translateX(0)" : "translateX(12px)",
            transition: "opacity 180ms ease, transform 180ms ease",
            pointerEvents: collapsed ? "auto" : "none",
          }}
        >
          <Button onClick={onToggle} variant="secondary" size="sm" title="Развернуть центр событий" style={{ minWidth: 34 }}>
            ◀
          </Button>
        </div>

        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: 12,
            display: "grid",
            gridTemplateRows: "auto auto minmax(0, 1fr)",
            gap: 10,
            opacity: collapsed ? 0 : 1,
            transform: collapsed ? "translateX(14px)" : "translateX(0)",
            transition: "opacity 180ms ease, transform 180ms ease",
            pointerEvents: collapsed ? "none" : "auto",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Центр событий</h3>
            <Button onClick={onToggle} size="sm" variant="secondary" title="Свернуть центр событий">
              ▶
            </Button>
          </div>

          {sectionHeader}

          <div style={{ overflow: "hidden", minHeight: 0, display: "grid", gridTemplateRows: "1fr 1px 1fr", gap: 10 }}>
            <div style={{ overflow: "auto", minHeight: 0, display: "grid", gap: 6, alignContent: "start", gridAutoRows: "max-content" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Уведомления</div>
              </div>
              {notifications.map((item) => (
                <NotificationCard
                  key={item.id}
                  item={item}
                  onOpenPanel={onOpenEventPanel}
                  onOpenSource={onOpenEventSource}
                  onDismiss={onDismissEvent}
                  currentUserEmail={user?.email ?? ""}
                />
              ))}
              {notifications.length === 0 && <EmptyState text="Новых уведомлений нет." />}
            </div>

            <div style={{ background: "#3333" }} />

            <div style={{ overflow: "auto", minHeight: 0, display: "grid", gap: 8, alignContent: "start", gridAutoRows: "max-content" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Лента действий</div>
              </div>

              {error && <div style={{ opacity: 0.8, fontSize: 13 }}>{error}</div>}
              {actions.map((item) => (
                <ActionCard
                  key={item.id}
                  item={item}
                  onOpenPanel={onOpenEventPanel}
                  onOpenSource={onOpenEventSource}
                  onDismiss={onDismissEvent}
                  actionLabel={typeof item.meta?.action === "string" ? actionLabels[item.meta.action] : undefined}
                  currentUserEmail={user?.email ?? ""}
                />
              ))}
              {actions.length === 0 && !error && <EmptyState text="Событий пока нет." />}
            </div>
          </div>
        </div>
      </aside>
      <SlidePanel open={contextItem !== null} onClose={() => setContextItem(null)}>
        <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Контекст события</div>
            <div style={{ fontSize: 12, opacity: 0.72 }}>
              {contextItem ? formatApiTime(contextItem.created_at) : ""}
            </div>
          </div>
          <Button onClick={() => setContextItem(null)} variant="ghost" size="sm">Закрыть</Button>
        </div>
        <div style={{ padding: 16, display: "grid", gap: 12, alignContent: "start" }}>
          {contextLoading && <div>Загрузка...</div>}
          {contextError && <div style={{ color: "#d55" }}>{contextError}</div>}
          {contextItem && (
            <>
              <Card style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>{contextItem.title}</div>
                <div style={{ fontSize: 13, opacity: 0.9 }}>{contextItem.body || "Без описания"}</div>
                <EventMetaPills
                  channel={contextItem.channel}
                  severity={contextItem.severity}
                  isRead={contextItem.is_read}
                  isHandled={contextItem.is_handled}
                />
              </Card>

              {contextUser && (
                <Card>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 700 }}>{contextUser.user.email}</div>
                      {user?.email && contextUser.user.email.toLowerCase() === user.email.toLowerCase() && (
                        <RelevanceBadge relevance="self" />
                      )}
                    </div>
                    <UserStatusPills
                      user={contextUser.user.is_approved ? contextUser.user : { ...contextUser.user, role: null }}
                      showApproveWhenFalse={false}
                      showBlockedWhenFalse={false}
                    />
                  </div>
                </Card>
              )}

              {contextUser && (
                <UserActionPanel
                  availableActions={contextAvailableActions}
                  actionCatalog={actionCatalog}
                  trustPolicyCatalog={trustPolicyCatalog}
                  onRunAction={runContextUserAction}
                />
              )}

              <MonitoringContextCard
                item={contextItem}
                focus={monitoringFocus}
                errorRows={monitoringErrorRows}
                rangeMinutes={monitoringFocusRangeMinutes}
                onOpenFocus={() => {
                  const params = new URLSearchParams();
                  const focusMetric = typeof contextItem.meta?.focus_metric === "string" ? contextItem.meta.focus_metric : "";
                  const focusPath = typeof contextItem.meta?.focus_path === "string" ? contextItem.meta.focus_path : "";
                  const highlightKey = typeof contextItem.meta?.highlight_key === "string" ? contextItem.meta.highlight_key : "summary";
                  if (highlightKey) params.set("highlight_key", highlightKey);
                  if (focusMetric) params.set("focus_metric", focusMetric);
                  if (focusPath) params.set("focus_path", focusPath);
                  const qs = params.toString();
                  navigate(qs ? `/monitoring?${qs}` : "/monitoring");
                }}
                onShowSimilar={() => {
                  const seed = contextItem.event_type.startsWith("monitoring.") ? "monitoring" : (contextItem.event_type || contextItem.title || "").trim();
                  navigate(`/events?similar=${encodeURIComponent(seed)}`);
                }}
                onMarkHandled={() => onMarkHandled(contextItem)}
              />
              {contextUser && isAuthSecurityContextEvent && (
                <ContextQuickActions
                  items={buildAuthSecurityQuickActions({
                    keyPrefix: "sidebar-auth",
                    ip: contextUser.user.last_ip || "",
                    sessionVariant: "secondary",
                    trustedVariant: "ghost",
                    ipVariant: "ghost",
                    onRevokeSessions: () => runContextUserAction({ action: "revoke_sessions" }),
                    onRevokeTrustedDevices: () => runContextUserAction({ action: "revoke_trusted_devices" }),
                    onOpenIpLogins: (ip) => navigate(`/logs?mode=login&ip=${encodeURIComponent(ip)}`),
                  })}
                />
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button variant="primary" onClick={() => onOpenEventSource(contextItem)}>Открыть источник</Button>
                <Button variant="secondary" onClick={() => onMarkHandled(contextItem)}>Отметить обработанным</Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await onDismissEvent(contextItem);
                    setContextItem(null);
                  }}
                >
                  Скрыть
                </Button>
              </div>
            </>
          )}
        </div>
      </SlidePanel>
    </>
  );
}






