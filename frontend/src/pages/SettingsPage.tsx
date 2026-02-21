import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "../components/ui/Card";
import { useAuth } from "../hooks/auth";
import { hasPermission } from "../utils/permissions";
import {
  getAudit24hCountCached,
  getMonitoringStateCached,
  getPendingUsersCountCached,
  getRootAdminsCountCached,
} from "../utils/settingsStatsCache";
import {
  getEventCenterUnreadShared,
  getEventCenterUnreadSnapshot,
  subscribeEventCenterUnread,
} from "../utils/eventCenterUnreadStore";

function SettingsItem({
  title,
  subtitle,
  status,
  sourceOk = true,
  onClick,
}: {
  title: string;
  subtitle: string;
  status?: string;
  sourceOk?: boolean;
  onClick: () => void;
}) {
  return (
    <Card className="interactive-row" style={{ padding: 12, cursor: "pointer" }} onClick={onClick}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, lineHeight: 1.2 }}>{title}</div>
          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>{subtitle}</div>
        </div>
        {(status || !sourceOk) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {!sourceOk && (
              <div
                title="Источник статистики временно недоступен"
                aria-label="Источник статистики временно недоступен"
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 11,
                  fontWeight: 800,
                  border: "1px solid rgba(228,120,120,0.5)",
                  background: "rgba(228,120,120,0.16)",
                  color: "#ffc9c9",
                }}
              >
                !
              </div>
            )}
            {status && (
              <div
                style={{
                  fontSize: 11,
                  borderRadius: 999,
                  border: "1px solid rgba(106,160,255,0.42)",
                  background: "rgba(106,160,255,0.12)",
                  color: "#cfe0ff",
                  padding: "3px 8px",
                  whiteSpace: "nowrap",
                }}
              >
                {status}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [rootAdminsCount, setRootAdminsCount] = useState<number | null>(null);
  const [eventsUnread, setEventsUnread] = useState<number | null>(null);
  const [audit24h, setAudit24h] = useState<number | null>(null);
  const [monitoringState, setMonitoringState] = useState<"стабильно" | "внимание" | "критично" | "нет данных">("нет данных");
  const [diagUsersOk, setDiagUsersOk] = useState(true);
  const [diagRootAdminsOk, setDiagRootAdminsOk] = useState(true);
  const [diagEventsOk, setDiagEventsOk] = useState(true);
  const [diagAuditOk, setDiagAuditOk] = useState(true);
  const [diagMonitoringOk, setDiagMonitoringOk] = useState(true);

  const canManageUsers = hasPermission(user?.role, "users.manage");
  const canViewEvents = hasPermission(user?.role, "events.view");
  const canViewAudit = hasPermission(user?.role, "audit.view");
  const canManageRootAdmins = hasPermission(user?.role, "root_admins.manage");

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      const tasks: Array<Promise<void>> = [];

      if (canManageUsers) {
        tasks.push(
          getPendingUsersCountCached()
            .then((count) => {
              if (cancelled) return;
              setPendingCount(count);
              setDiagUsersOk(true);
            })
            .catch(() => {
              if (cancelled) return;
              setPendingCount(null);
              setDiagUsersOk(false);
            }),
        );
      }

      if (canManageRootAdmins) {
        tasks.push(
          getRootAdminsCountCached()
            .then((count) => {
              if (cancelled) return;
              setRootAdminsCount(count);
              setDiagRootAdminsOk(true);
            })
            .catch(() => {
              if (cancelled) return;
              setRootAdminsCount(null);
              setDiagRootAdminsOk(false);
            }),
        );
      }

      if (canViewEvents) {
        tasks.push(
          (async () => {
            const local = getEventCenterUnreadSnapshot();
            if (local) {
              if (cancelled) return;
              setEventsUnread(local.totalUnread);
              setDiagEventsOk(true);
              return;
            }
            try {
              const shared = await getEventCenterUnreadShared();
              if (cancelled) return;
              setEventsUnread(shared.totalUnread);
              setDiagEventsOk(true);
            } catch {
              if (cancelled) return;
              setEventsUnread(null);
              setDiagEventsOk(false);
            }
          })(),
        );
      }

      if (canViewAudit) {
        tasks.push(
          getAudit24hCountCached()
            .then((count) => {
              if (cancelled) return;
              setAudit24h(count);
              setDiagAuditOk(true);
            })
            .catch(() => {
              if (cancelled) return;
              setAudit24h(null);
              setDiagAuditOk(false);
            }),
        );

        tasks.push(
          getMonitoringStateCached()
            .then((state) => {
              if (cancelled) return;
              setMonitoringState(state);
              setDiagMonitoringOk(true);
            })
            .catch(() => {
              if (cancelled) return;
              setMonitoringState("нет данных");
              setDiagMonitoringOk(false);
            }),
        );
      }

      await Promise.allSettled(tasks);
    }

    loadStats();
    return () => {
      cancelled = true;
    };
  }, [canManageRootAdmins, canManageUsers, canViewAudit, canViewEvents]);

  useEffect(() => {
    if (!canViewEvents) return;
    return subscribeEventCenterUnread((next) => {
      setEventsUnread(next.totalUnread);
      setDiagEventsOk(true);
    });
  }, [canViewEvents]);

  const dynamicHints = useMemo(
    () => ({
      users: pendingCount == null ? "ожидают подтверждения: -" : `ожидают подтверждения: ${pendingCount}`,
      rootAdmins: rootAdminsCount == null ? "root-admin: -" : `root-admin: ${rootAdminsCount}`,
      events: eventsUnread == null ? "непрочитано: -" : `непрочитано: ${eventsUnread}`,
      audit: audit24h == null ? "записей за 24ч: -" : `записей за 24ч: ${audit24h}`,
      monitoring: `статус: ${monitoringState}`,
    }),
    [audit24h, eventsUnread, monitoringState, pendingCount, rootAdminsCount],
  );

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 0 }}>Настройки</h2>
      <p style={{ opacity: 0.8 }}>Выберите раздел для управления рабочей областью.</p>

      <div style={{ display: "grid", gap: 12, maxWidth: 620 }}>
        {(canManageUsers || canManageRootAdmins) && (
          <Card>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>Доступ и безопасность</div>
            <div style={{ display: "grid", gap: 8 }}>
              {canManageUsers && (
                <SettingsItem
                  title="Пользователи"
                  subtitle="Управление ролями, одобрением, блокировками и trust-policy."
                  status={dynamicHints.users}
                  sourceOk={diagUsersOk}
                  onClick={() => navigate("/users")}
                />
              )}
              {canManageRootAdmins && (
                <SettingsItem
                  title="Системные администраторы"
                  subtitle="Список root-admin и управление ADMIN_EMAILS."
                  status={dynamicHints.rootAdmins}
                  sourceOk={diagRootAdminsOk}
                  onClick={() => navigate("/root-admins")}
                />
              )}
            </div>
          </Card>
        )}

        {(canViewEvents || canViewAudit) && (
          <Card>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>События и аудит</div>
            <div style={{ display: "grid", gap: 8 }}>
              {canViewEvents && (
                <SettingsItem
                  title="Центр событий"
                  subtitle="Оперативная лента уведомлений и действий с deep-link."
                  status={dynamicHints.events}
                  sourceOk={diagEventsOk}
                  onClick={() => navigate("/events")}
                />
              )}
              {canViewAudit && (
                <SettingsItem
                  title="Журнал действий"
                  subtitle="Аудит изменений, входы, фильтры и экспорт."
                  status={dynamicHints.audit}
                  sourceOk={diagAuditOk}
                  onClick={() => navigate("/logs")}
                />
              )}
            </div>
          </Card>
        )}

        {canViewAudit && (
          <Card>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>Наблюдаемость</div>
            <SettingsItem
              title="Мониторинг"
              subtitle="Метрики, графики, пороги и состояние системы."
              status={dynamicHints.monitoring}
              sourceOk={diagMonitoringOk}
              onClick={() => navigate("/monitoring")}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
