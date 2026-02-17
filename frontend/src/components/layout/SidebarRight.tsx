import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../../api/client";
import Card from "../ui/Card";
import EmptyState from "../ui/EmptyState";
import ToastHost, { type ToastItem } from "../ui/ToastHost";

type AuditLogItem = {
  id: number;
  created_at: string;
  action: string;
  actor_email: string;
  target_email: string;
  ip: string | null;
  meta?: Record<string, unknown> | null;
};

type AuditResponse = {
  items: AuditLogItem[];
  total: number;
  page: number;
  page_size: number;
};

type PendingUser = {
  id: number;
  email: string;
  pending_requested_at?: string | null;
  is_approved: boolean;
};

type Props = {
  collapsed: boolean;
  onToggle: () => void;
};

const REFRESH_MS = 15000;

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatOnlyTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

function NotificationCard({
  eventType,
  who,
  what,
  whenLabel,
  unread,
  onRead,
  onOpen,
  onClose,
}: {
  eventType: string;
  who: string;
  what: string;
  whenLabel: string;
  unread: boolean;
  onRead: () => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <Card
      style={{
        padding: 8,
        minHeight: 78,
        maxHeight: 78,
        cursor: "pointer",
        borderColor: unread ? "rgba(106,160,255,0.55)" : "#3333",
        background: unread ? "rgba(106,160,255,0.08)" : "rgba(255,255,255,0.03)",
        transition: "border-color 0.15s ease, background 0.15s ease",
        overflow: "hidden",
      }}
    >
      <div
        onClick={onOpen}
        onMouseEnter={() => {
          onRead();
        }}
        style={{ width: "100%", textAlign: "left", padding: 0, display: "grid", gap: 1, lineHeight: 1.2 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 12 }}>{eventType}</div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            style={{ border: "1px solid #3333", background: "#1a1a1a", color: "inherit", borderRadius: 8, padding: "0 6px", cursor: "pointer", fontSize: 12 }}
            title="Закрыть уведомление"
          >
            ×
          </button>
        </div>
        <div style={{ opacity: 0.9, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Кто: {who}</div>
        <div style={{ opacity: 0.68, fontSize: 11 }}>Когда: {whenLabel}</div>
        <div style={{ opacity: 0.78, fontSize: 11 }}>Что: {what}</div>
      </div>
    </Card>
  );
}

export default function SidebarRight({ collapsed, onToggle }: Props) {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [error, setError] = useState("");
  const [securityOnly, setSecurityOnly] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [prevTopLogId, setPrevTopLogId] = useState<number | null>(null);
  const [prevPendingCount, setPrevPendingCount] = useState<number | null>(null);
  const [pendingSeenAt, setPendingSeenAt] = useState<Record<number, string>>({});
  const [dismissedPendingIds, setDismissedPendingIds] = useState<number[]>([]);
  const [readPendingIds, setReadPendingIds] = useState<number[]>([]);

  const fetchPanelData = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: "1", page_size: "25", security_only: String(securityOnly) });
      const [auditData, pendingData] = await Promise.all([
        apiGet<AuditResponse>(`/admin/audit?${params.toString()}`),
        apiGet<PendingUser[]>("/admin/users?status=pending"),
      ]);
      setLogs(auditData.items);
      setPendingUsers(pendingData);
      setPendingSeenAt((prev) => {
        const next = { ...prev };
        const nowIso = new Date().toISOString();
        for (const p of pendingData) {
          if (!next[p.id]) next[p.id] = nowIso;
        }
        return next;
      });
      setDismissedPendingIds((prev) => prev.filter((id) => pendingData.some((p) => p.id === id)));
      setReadPendingIds((prev) => prev.filter((id) => pendingData.some((p) => p.id === id)));
      setError("");
      setLastUpdated(new Date().toLocaleTimeString());

      const topLogId = auditData.items[0]?.id ?? null;
      if (prevTopLogId !== null && topLogId !== null && topLogId > prevTopLogId && collapsed) {
        setToasts((prev) => [
          {
            id: `log-${topLogId}`,
            title: "Новое действие",
            body: "Появилось новое событие в журнале.",
            actionLabel: "Открыть журнал",
            onAction: () => navigate("/logs"),
          },
          ...prev,
        ]);
      }
      setPrevTopLogId(topLogId);

      const currentPending = pendingData.length;
      if (prevPendingCount !== null && currentPending > prevPendingCount && collapsed) {
        setToasts((prev) => [
          {
            id: `pending-${Date.now()}`,
            title: "Новый запрос доступа",
            body: `Сейчас ожидают подтверждения: ${currentPending}`,
            actionLabel: "Открыть пользователей",
            onAction: () => navigate("/users"),
          },
          ...prev,
        ]);
      }
      setPrevPendingCount(currentPending);
    } catch {
      setError("Центр событий недоступен (только для администратора).");
    }
  }, [collapsed, navigate, prevPendingCount, prevTopLogId, securityOnly]);

  useEffect(() => {
    fetchPanelData();
  }, [fetchPanelData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetchPanelData();
    }, REFRESH_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [fetchPanelData]);

  const sectionHeader = useMemo(
    () => (
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", fontSize: 12, opacity: 0.85 }}>
        <span />
        <button onClick={fetchPanelData} style={{ padding: "4px 8px", borderRadius: 8, cursor: "pointer" }}>
          Обновить
        </button>
        <span>{lastUpdated ? `обновлено: ${lastUpdated}` : ""}</span>
      </div>
    ),
    [fetchPanelData, lastUpdated],
  );

  const visiblePending = useMemo(
    () => pendingUsers.filter((u) => !dismissedPendingIds.includes(u.id)),
    [dismissedPendingIds, pendingUsers],
  );

  return (
    <>
      <ToastHost items={toasts} onClose={(id) => setToasts((prev) => prev.filter((x) => x.id !== id))} />

      {collapsed ? (
        <aside style={{ border: "1px solid #3333", borderRadius: 12, height: "100%", display: "grid", placeItems: "start center", paddingTop: 10 }}>
          <button onClick={onToggle} style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }} title="Развернуть центр событий">
            ◀
          </button>
        </aside>
      ) : (
        <aside
          style={{
            border: "1px solid #3333",
            borderRadius: 12,
            padding: 12,
            height: "100%",
            boxSizing: "border-box",
            display: "grid",
            gridTemplateRows: "auto auto minmax(0, 1fr)",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Центр событий</h3>
            <button onClick={onToggle} style={{ padding: "6px 9px", borderRadius: 10, cursor: "pointer" }} title="Свернуть центр событий">
              ▶
            </button>
          </div>

          {sectionHeader}

          <div style={{ overflow: "hidden", minHeight: 0, display: "grid", gridTemplateRows: "1fr 1px 1fr", gap: 10 }}>
            <div style={{ overflow: "auto", minHeight: 0, display: "grid", gap: 4, alignContent: "start", gridAutoRows: "max-content" }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Уведомления</div>
              {visiblePending.slice(0, 8).map((u) => (
                <NotificationCard
                  key={u.id}
                  eventType="Новый запрос"
                  who={u.email}
                  what="Запрос доступа"
                  whenLabel={formatOnlyTime(u.pending_requested_at ?? pendingSeenAt[u.id] ?? new Date().toISOString())}
                  unread={!readPendingIds.includes(u.id)}
                  onRead={() => setReadPendingIds((prev) => (prev.includes(u.id) ? prev : [...prev, u.id]))}
                  onOpen={() => navigate("/users")}
                  onClose={() => setDismissedPendingIds((prev) => (prev.includes(u.id) ? prev : [...prev, u.id]))}
                />
              ))}
              {visiblePending.length === 0 && <EmptyState text="Новых запросов нет." />}
            </div>

            <div style={{ background: "#3333" }} />

            <div style={{ overflow: "auto", minHeight: 0, display: "grid", gap: 8, alignContent: "start", gridAutoRows: "max-content" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Лента действий</div>
                <label style={{ fontSize: 12, opacity: 0.9 }}>
                  <input type="checkbox" checked={securityOnly} onChange={(e) => setSecurityOnly(e.target.checked)} style={{ marginRight: 6 }} />
                  только security
                </label>
              </div>

              {error && <div style={{ opacity: 0.8, fontSize: 13 }}>{error}</div>}
              {logs.map((log) => (
                <Card key={log.id}>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{log.action}</div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>{formatTime(log.created_at)}</div>
                  <div style={{ opacity: 0.85, fontSize: 12 }}>
                    {log.actor_email} {"->"} {log.target_email}
                  </div>
                  {log.meta && typeof log.meta.reason === "string" && log.meta.reason.trim() && (
                    <div style={{ opacity: 0.75, fontSize: 12 }}>Причина: {log.meta.reason}</div>
                  )}
                </Card>
              ))}
              {logs.length === 0 && !error && <EmptyState text="Событий пока нет." />}
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
