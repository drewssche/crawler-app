import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getEventsFeed, markAllEventsRead, markEventRead, setEventDismissed, setEventHandled, type EventItem } from "../api/events";
import { useAuth } from "../hooks/auth";
import { formatApiDateTime } from "../utils/datetime";
import { UI_BULLET } from "../utils/uiText";
import { runEventPrimaryAction } from "../utils/eventPrimaryAction";
import { eventChannelLabel, eventReadStatusLabel, eventSeverityLabel } from "../utils/eventLabels";
import { getEventRelevance } from "../utils/relevance";
import { apiPost } from "../api/client";
import { getMonitoringFocusMeta, loadMonitoringContext, type FocusHistoryResponse } from "../utils/monitoringContext";
import { getUserAndTrustCatalogsCached } from "../utils/catalogCache";
import { loadUserContextByEmail, loadUserContextById } from "../utils/userContext";
import { useIncrementalPager } from "../hooks/useIncrementalPager";
import { useWorkspaceInfiniteScroll } from "../hooks/useWorkspaceInfiniteScroll";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import ClearableInput from "../components/ui/ClearableInput";
import EmptyState from "../components/ui/EmptyState";
import EventCardActions from "../components/ui/EventCardActions";
import FiltersBar from "../components/ui/FiltersBar";
import RelevanceBadge from "../components/ui/RelevanceBadge";
import SegmentedControl from "../components/ui/SegmentedControl";
import SlidePanel from "../components/ui/SlidePanel";
import type { UserDetailsResponse } from "../components/users/UserDetailsDrawer";
import ContextQuickActions from "../components/ui/ContextQuickActions";
import UserActionPanel, {
  type ActionCatalogItem,
  type BulkAction,
  type TrustPolicy,
  type TrustPolicyCatalogItem,
} from "../components/users/UserActionPanel";
import { UserStatusPills } from "../components/users/UserStatusPills";
import MonitoringContextCard from "../components/monitoring/MonitoringContextCard";
import EventMetaPills from "../components/ui/EventMetaPills";
import { buildAuthSecurityQuickActions } from "../components/users/userContextQuickActions";

type ChannelFilter = "all" | "notification" | "action";
const PAGE_SIZE = 20;
const EVENT_CARD_MIN_HEIGHT = 148;
const EVENT_CARD_HEADER_MIN_HEIGHT = 26;
const EVENT_CARD_BODY_MIN_HEIGHT = 46;
function getTargetEmail(item: EventItem): string | null {
  const metaEmail = typeof item.meta?.target_email === "string" ? item.meta.target_email : null;
  const requestEmail = typeof item.meta?.email === "string" ? item.meta.email : null;
  const value = (metaEmail || requestEmail || "").trim().toLowerCase();
  return value || null;
}


export default function EventsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [rows, setRows] = useState<EventItem[]>([]);
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [onlyUnhandled, setOnlyUnhandled] = useState(false);
  const [securityOnly, setSecurityOnly] = useState(false);
  const [similar, setSimilar] = useState("");
  const [feedError, setFeedError] = useState("");
  const contextRequestSeqRef = useRef(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  const [drawerUser, setDrawerUser] = useState<UserDetailsResponse | null>(null);
  const [drawerEvent, setDrawerEvent] = useState<EventItem | null>(null);
  const [monitoringFocus, setMonitoringFocus] = useState<FocusHistoryResponse | null>(null);
  const [monitoringFocusRangeMinutes, setMonitoringFocusRangeMinutes] = useState(60);
  const [monitoringErrorRows, setMonitoringErrorRows] = useState<Array<{ labels: string; value: number }>>([]);
  const [drawerAvailableActions, setDrawerAvailableActions] = useState<BulkAction[]>([]);
  const [actionCatalog, setActionCatalog] = useState<Record<BulkAction, ActionCatalogItem>>({} as Record<BulkAction, ActionCatalogItem>);
  const [trustPolicyCatalog, setTrustPolicyCatalog] = useState<Record<TrustPolicy, TrustPolicyCatalogItem>>({} as Record<TrustPolicy, TrustPolicyCatalogItem>);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("similar");
    setSimilar((q || "").trim());
  }, [location.search]);

  useEffect(() => {
    let active = true;
    getUserAndTrustCatalogsCached()
      .then(({ actionCatalog: actions, trustPolicyCatalog: trust }) => {
        if (!active) return;
        setActionCatalog(actions);
        setTrustPolicyCatalog(trust);
      })
      .catch(() => {
        if (!active) return;
        setTrustPolicyCatalog({} as Record<TrustPolicy, TrustPolicyCatalogItem>);
        setActionCatalog({} as Record<BulkAction, ActionCatalogItem>);
      });
    return () => {
      active = false;
    };
  }, []);

  const { total, isLoading, hasMore, resetAndLoad, requestNextPage } = useIncrementalPager<EventItem>({
    fetchPage: (nextPage, signal) =>
      getEventsFeed({
        channel,
        includeDismissed,
        onlyUnread,
        securityOnly,
        page: nextPage,
        pageSize: PAGE_SIZE,
        signal,
      }),
    applyPage: (data, append) => {
      setRows((prev) => (append ? [...prev, ...data.items] : data.items));
    },
    onReset: () => {
      setRows([]);
      setFeedError("");
    },
    onError: (e) => {
      setFeedError(String(e));
    },
  });

  useEffect(() => {
    resetAndLoad();
  }, [channel, includeDismissed, onlyUnread, securityOnly, resetAndLoad]);

  async function openEvent(item: EventItem) {
    await runEventPrimaryAction({
      item,
      navigate,
      onLocalRead: (eventId) => {
        setRows((prev) => prev.map((x) => (x.id === eventId ? { ...x, is_read: true } : x)));
      },
    });
  }

  async function openEventContext(item: EventItem) {
    const requestSeq = ++contextRequestSeqRef.current;
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerError("");
    setDrawerUser(null);
    setDrawerEvent(item);
    setMonitoringFocus(null);
    setMonitoringErrorRows([]);
    setDrawerAvailableActions([]);
    if (!item.is_read) {
      try {
        await markEventRead(item.id, true);
        setRows((prev) => prev.map((x) => (x.id === item.id ? { ...x, is_read: true } : x)));
        setDrawerEvent((prev) => (prev ? { ...prev, is_read: true } : prev));
      } catch {
        // no-op
      }
    }

    const email = getTargetEmail(item);
    const { isMonitoring } = getMonitoringFocusMeta(item);
    try {
      const tasks: Promise<unknown>[] = [];

      if (email) {
        tasks.push(
          (async () => {
            const context = await loadUserContextByEmail(email);
            if (requestSeq !== contextRequestSeqRef.current) return;
            if (!context) return;
            setDrawerUser(context.details);
            setDrawerAvailableActions(context.availableActions);
          })(),
        );
      }

      if (isMonitoring) {
        tasks.push(
          (async () => {
            const ctx = await loadMonitoringContext(item);
            if (requestSeq !== contextRequestSeqRef.current) return;
            setMonitoringFocus(ctx.history);
            setMonitoringFocusRangeMinutes(ctx.rangeMinutes);
            setMonitoringErrorRows(ctx.errorRows);
          })(),
        );
      } else {
        setMonitoringFocusRangeMinutes(60);
      }

      if (tasks.length > 0) {
        await Promise.all(tasks);
      }
    } catch (e) {
      if (requestSeq !== contextRequestSeqRef.current) return;
      setDrawerError(String(e));
    } finally {
      if (requestSeq === contextRequestSeqRef.current) {
        setDrawerLoading(false);
      }
    }
  }

  async function toggleRead(item: EventItem) {
    try {
      await markEventRead(item.id, !item.is_read);
      setRows((prev) => prev.map((x) => (x.id === item.id ? { ...x, is_read: !item.is_read } : x)));
    } catch (e) {
      setFeedError(String(e));
    }
  }

  async function toggleDismiss(item: EventItem) {
    try {
      await setEventDismissed(item.id, !item.is_dismissed);
      setRows((prev) => {
        const nextDismissed = !item.is_dismissed;
        if (nextDismissed && !includeDismissed) {
          return prev.filter((x) => x.id !== item.id);
        }
        return prev.map((x) => (x.id === item.id ? { ...x, is_dismissed: nextDismissed } : x));
      });
    } catch (e) {
      setFeedError(String(e));
    }
  }

  function buildMonitoringPath(item: EventItem): string {
    const params = new URLSearchParams();
    const focusMetric = typeof item.meta?.focus_metric === "string" ? item.meta.focus_metric : "";
    const focusPath = typeof item.meta?.focus_path === "string" ? item.meta.focus_path : "";
    const highlightKey = typeof item.meta?.highlight_key === "string" ? item.meta.highlight_key : "summary";

    if (highlightKey) params.set("highlight_key", highlightKey);
    if (focusMetric) params.set("focus_metric", focusMetric);
    if (focusPath) params.set("focus_path", focusPath);
    const qs = params.toString();
    return qs ? `/monitoring?${qs}` : "/monitoring";
  }

  function openMonitoringContext(item: EventItem) {
    navigate(buildMonitoringPath(item));
  }

  function applySimilarFilterFromEvent(item: EventItem) {
    const seed = item.event_type.startsWith("monitoring.") ? "monitoring" : (item.event_type || item.title || "").trim();
    setSimilar(seed);
    setChannel("all");
    setOnlyUnread(false);
    setDrawerOpen(false);
  }

  async function markIncidentHandled(item: EventItem) {
    try {
      await Promise.all([markEventRead(item.id, true), setEventHandled(item.id, true)]);
      setRows((prev) => {
        return prev.map((x) => (x.id === item.id ? { ...x, is_read: true, is_handled: true } : x));
      });
      setDrawerEvent((prev) => (prev && prev.id === item.id ? { ...prev, is_read: true, is_handled: true } : prev));
    } catch (e) {
      setDrawerError(String(e));
    }
  }

  async function readAllCurrentFilter() {
    try {
      await markAllEventsRead(channel, securityOnly);
      setRows((prev) => prev.map((x) => ({ ...x, is_read: true })));
    } catch (e) {
      setFeedError(String(e));
    }
  }

  function onFilterSimilar(item: EventItem) {
    const seed = (item.event_type || item.title || "").trim();
    setSimilar(seed);
  }

  function onOpenUser(item: EventItem) {
    const email = getTargetEmail(item);
    if (!email) return;
    navigate(`/users?highlight_email=${encodeURIComponent(email)}`);
  }

  async function runDrawerUserAction(payload: { action: BulkAction; role?: "viewer" | "editor" | "admin"; trust_policy?: TrustPolicy; reason?: string }) {
    if (!drawerUser?.user?.id) return;
    await apiPost("/admin/users/bulk", {
      user_ids: [drawerUser.user.id],
      action: payload.action,
      role: payload.role,
      trust_policy: payload.trust_policy,
      reason: payload.reason,
    });
    const refreshed = await loadUserContextById(drawerUser.user.id);
    setDrawerUser(refreshed.details);
    setDrawerAvailableActions(refreshed.availableActions);
  }

  const isAuthSecurityEvent = Boolean(
    drawerEvent?.event_type?.startsWith("auth.") || drawerEvent?.event_type?.startsWith("security."),
  );

  const drawerIp = (typeof drawerEvent?.meta?.ip === "string" ? drawerEvent?.meta?.ip : "") || drawerUser?.user.last_ip || "";

  useWorkspaceInfiniteScroll({
    canLoadMore: hasMore,
    isLoading,
    onLoadMore: requestNextPage,
    contentKey: rows.length,
  });

  const visibleRows = useMemo(() => {
    const needle = similar.trim().toLowerCase();
    const base = onlyUnhandled ? rows.filter((r) => !r.is_handled) : rows;
    if (!needle) return base;
    return base.filter((r) => {
      const body = (r.body || "").toLowerCase();
      return r.event_type.toLowerCase().includes(needle) || r.title.toLowerCase().includes(needle) || body.includes(needle);
    });
  }, [rows, similar, onlyUnhandled]);
  const unhandledCount = useMemo(() => rows.filter((r) => !r.is_handled).length, [rows]);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Центр событий: все записи</h2>

      <FiltersBar>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <SegmentedControl
            value={channel}
            onChange={setChannel}
            options={[
              { value: "all", label: "Все каналы" },
              { value: "notification", label: "Уведомления" },
              { value: "action", label: "Действия" },
            ]}
          />
          <ClearableInput value={similar} onChange={setSimilar} placeholder="Фильтр похожих событий" />
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={includeDismissed} onChange={(e) => setIncludeDismissed(e.target.checked)} style={{ marginRight: 6 }} />
            Показывать скрытые
          </label>
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} style={{ marginRight: 6 }} />
            Только непрочитанные
          </label>
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={onlyUnhandled} onChange={(e) => setOnlyUnhandled(e.target.checked)} style={{ marginRight: 6 }} />
            Только необработанные ({unhandledCount})
          </label>
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={securityOnly} onChange={(e) => setSecurityOnly(e.target.checked)} style={{ marginRight: 6 }} />
            Только security
          </label>
          <Button variant="secondary" onClick={resetAndLoad}>Обновить</Button>
          <Button variant="ghost" onClick={readAllCurrentFilter}>Отметить все прочитанным</Button>
        </div>
      </FiltersBar>

      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
        Загружено: {rows.length} из {total}
        {similar.trim() ? `${UI_BULLET}по фильтру: ${visibleRows.length}` : ""}
      </div>

      {feedError && <div style={{ color: "#d55", marginTop: 10 }}>{feedError}</div>}

      <Card style={{ marginTop: 12, minHeight: 320 }}>
        <div>
        {visibleRows.length > 0 ? (
          <div style={{ display: "grid", gap: 8, paddingRight: 4 }}>
            {visibleRows.map((row) => (
              (() => {
                const relevance = getEventRelevance({
                  body: row.body,
                  targetEmail: typeof row.meta?.target_email === "string" ? row.meta.target_email : null,
                  currentUserEmail: user?.email ?? "",
                });
                const effectiveUnread = !row.is_read && relevance !== "self";
                return (
              <Card
                key={row.id}
                className="interactive-row"
                style={{
                  cursor: "pointer",
                  minHeight: EVENT_CARD_MIN_HEIGHT,
                  borderColor: effectiveUnread ? "rgba(106,160,255,0.45)" : "#3333",
                  background: effectiveUnread ? "rgba(106,160,255,0.07)" : "rgba(255,255,255,0.03)",
                }}
                onClick={() => openEventContext(row)}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateRows: "auto 1fr auto",
                    gap: 6,
                    minHeight: EVENT_CARD_MIN_HEIGHT - 24,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, minHeight: EVENT_CARD_HEADER_MIN_HEIGHT, alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 700 }}>{row.title}</div>
                      <RelevanceBadge relevance={relevance} />
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.78 }}>{formatApiDateTime(row.created_at)}</div>
                  </div>
                  <div style={{ minHeight: EVENT_CARD_BODY_MIN_HEIGHT }}>
                    <div
                      style={{
                        fontSize: 13,
                        opacity: 0.85,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {row.body || "Без описания"}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                      канал: {eventChannelLabel(row.channel)}{UI_BULLET}уровень: {eventSeverityLabel(row.severity)}{UI_BULLET}статус: {eventReadStatusLabel(!effectiveUnread)}
                      {row.is_dismissed ? `${UI_BULLET}скрыто` : ""}
                    </div>
                  </div>
                  <div>
                    <EventCardActions
                      item={row}
                      onOpen={openEvent}
                      onToggleRead={toggleRead}
                      onToggleDismiss={toggleDismiss}
                      onFilterSimilar={onFilterSimilar}
                      onOpenUser={getTargetEmail(row) ? onOpenUser : undefined}
                    />
                  </div>
                </div>
              </Card>
                );
              })()
            ))}
            {isLoading && <div style={{ fontSize: 13, opacity: 0.75 }}>Загрузка...</div>}
          </div>
        ) : (
          !feedError && !isLoading && (
            <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
              <EmptyState text="Событий по текущему фильтру нет." />
            </div>
          )
        )}
        </div>
      </Card>

      <SlidePanel open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Контекст события</div>
            <div style={{ fontSize: 12, opacity: 0.72 }}>{drawerEvent ? formatApiDateTime(drawerEvent.created_at) : ""}</div>
          </div>
          <Button onClick={() => setDrawerOpen(false)} variant="ghost" size="sm">Закрыть</Button>
        </div>

        <div style={{ padding: 16, display: "grid", gap: 12, alignContent: "start", overflowY: "auto" }}>
          {drawerLoading && <div>Загрузка...</div>}
          {drawerError && <div style={{ color: "#d55" }}>{drawerError}</div>}

          {drawerEvent && (
            <Card style={{ borderColor: "rgba(106,160,255,0.45)", background: "rgba(106,160,255,0.08)" }}>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>{drawerEvent.title}</div>
                <div style={{ fontSize: 13, opacity: 0.9 }}>{drawerEvent.body || "Без описания"}</div>
                <EventMetaPills
                  channel={drawerEvent.channel}
                  severity={drawerEvent.severity}
                  isRead={drawerEvent.is_read}
                  isHandled={drawerEvent.is_handled}
                />
              </div>
            </Card>
          )}

          {drawerUser && (
            <Card>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700 }}>{drawerUser.user.email}</div>
                  {user?.email && drawerUser.user.email.toLowerCase() === user.email.toLowerCase() && (
                    <RelevanceBadge relevance="self" />
                  )}
                </div>
                <UserStatusPills
                  user={drawerUser.user.is_approved ? drawerUser.user : { ...drawerUser.user, role: null }}
                  showApproveWhenFalse={false}
                  showBlockedWhenFalse={false}
                />
              </div>
            </Card>
          )}

          {drawerUser && (
            <UserActionPanel
              availableActions={drawerAvailableActions}
              actionCatalog={actionCatalog}
              trustPolicyCatalog={trustPolicyCatalog}
              onRunAction={runDrawerUserAction}
            />
          )}

          {drawerEvent && (
            <MonitoringContextCard
              item={drawerEvent}
              focus={monitoringFocus}
              errorRows={monitoringErrorRows}
              rangeMinutes={monitoringFocusRangeMinutes}
              onOpenFocus={() => openMonitoringContext(drawerEvent)}
              onShowSimilar={() => applySimilarFilterFromEvent(drawerEvent)}
              onMarkHandled={() => markIncidentHandled(drawerEvent)}
            />
          )}

          {drawerEvent && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="primary" size="sm" onClick={() => openEvent(drawerEvent)}>
                Открыть источник
              </Button>
              {getTargetEmail(drawerEvent) && (
                <Button variant="secondary" size="sm" onClick={() => onOpenUser(drawerEvent)}>
                  Открыть в Пользователях
                </Button>
              )}
            </div>
          )}

          {drawerUser && drawerEvent && (
            <ContextQuickActions
              items={
                isAuthSecurityEvent
                  ? buildAuthSecurityQuickActions({
                      keyPrefix: "event-auth",
                      ip: drawerIp,
                      sessionVariant: "primary",
                      trustedVariant: "secondary",
                      ipVariant: "ghost",
                      onRevokeSessions: () => runDrawerUserAction({ action: "revoke_sessions" }),
                      onRevokeTrustedDevices: () => runDrawerUserAction({ action: "revoke_trusted_devices" }),
                      onOpenIpLogins: (ip) => navigate(`/logs?mode=login&ip=${encodeURIComponent(ip)}`),
                    })
                  : []
              }
            />
          )}
        </div>
      </SlidePanel>
    </div>
  );
}






