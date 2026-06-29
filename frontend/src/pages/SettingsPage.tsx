import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "../components/ui/Card";
import { useAuth } from "../hooks/auth";
import { hasPermission } from "../utils/permissions";
import {
  getSettingsSummaryCached,
  type QuotaOverviewRole,
} from "../utils/settingsStatsCache";
import {
  subscribeEventCenterUnread,
} from "../utils/eventCenterUnreadStore";

const UI_DEBUG_CLIENT_ENABLED =
  String(import.meta.env.VITE_ENABLE_UI_DEBUG ?? "false").toLowerCase() === "true";

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
    <Card interactive style={{ padding: 12, cursor: "pointer" }} onClick={onClick}>
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

const QUOTA_LABELS: Array<{ key: keyof Omit<QuotaOverviewRole, "role">; label: string }> = [
  { key: "max_projects", label: "Проекты" },
  { key: "max_sites_per_project", label: "Сайты/проект" },
  { key: "max_pages_per_site", label: "Страницы/сайт" },
  { key: "max_concurrency_per_site", label: "Параллельность" },
  { key: "max_active_jobs_per_user", label: "Активные jobs" },
  { key: "max_bulk_sites_per_run", label: "Bulk sites" },
];

function QuotaOverviewCard({
  roles,
  source,
  sourceOk,
}: {
  roles: QuotaOverviewRole[];
  source: string;
  sourceOk: boolean;
}) {
  if (roles.length === 0 && sourceOk) return null;
  return (
    <Card>
      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 800 }}>Лимиты ролей</div>
          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
            Read-only обзор квот crawler. Значения берутся из {source}; менять их лучше через env/config.
          </div>
        </div>
        {!sourceOk && (
          <div style={{ color: "#ffc9c9", fontSize: 13 }}>Источник лимитов временно недоступен.</div>
        )}
        {roles.length > 0 && (
          <div style={{ display: "grid", gap: 8 }}>
            {roles.map((row) => (
              <Card key={row.role} style={{ padding: 10, background: "rgba(255,255,255,0.025)" }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 800 }}>{row.role}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 6 }}>
                    {QUOTA_LABELS.map((item) => (
                      <div
                        key={item.key}
                        style={{
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 10,
                          padding: "7px 8px",
                          background: "rgba(0,0,0,0.12)",
                        }}
                      >
                        <div style={{ fontSize: 11, opacity: 0.68 }}>{item.label}</div>
                        <div style={{ marginTop: 3, fontWeight: 800 }}>{row[item.key]}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
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
  const [quotaRoles, setQuotaRoles] = useState<QuotaOverviewRole[]>([]);
  const [quotaSource, setQuotaSource] = useState("env:QUOTA_{ROLE}_...");
  const [quotaSourceOk, setQuotaSourceOk] = useState(true);
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

      if (canManageUsers || canManageRootAdmins || canViewEvents || canViewAudit) {
        tasks.push(
          getSettingsSummaryCached(true)
            .then((summary) => {
              if (cancelled) return;
              if (canManageUsers) {
                setPendingCount(summary.pendingUsers.value);
                setDiagUsersOk(summary.pendingUsers.sourceOk);
                setQuotaRoles(summary.quotaOverview.roles);
                setQuotaSource(summary.quotaOverview.source);
                setQuotaSourceOk(summary.quotaOverview.sourceOk);
              }
              if (canManageRootAdmins) {
                setRootAdminsCount(summary.rootAdmins.value);
                setDiagRootAdminsOk(summary.rootAdmins.sourceOk);
              }
              if (canViewEvents) {
                setEventsUnread(summary.eventsUnread.value);
                setDiagEventsOk(summary.eventsUnread.sourceOk);
              }
              if (canViewAudit) {
                setAudit24h(summary.audit24h.value);
                setDiagAuditOk(summary.audit24h.sourceOk);
                setMonitoringState(summary.monitoring.state);
                setDiagMonitoringOk(summary.monitoring.sourceOk);
              }
            })
            .catch(() => {
              if (cancelled) return;
              if (canManageUsers) {
                setPendingCount(null);
                setDiagUsersOk(false);
                setQuotaRoles([]);
                setQuotaSourceOk(false);
              }
              if (canManageRootAdmins) {
                setRootAdminsCount(null);
                setDiagRootAdminsOk(false);
              }
              if (canViewEvents) {
                setEventsUnread(null);
                setDiagEventsOk(false);
              }
              if (canViewAudit) {
                setAudit24h(null);
                setDiagAuditOk(false);
                setMonitoringState("нет данных");
                setDiagMonitoringOk(false);
              }
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

        {canManageUsers && (
          <QuotaOverviewCard roles={quotaRoles} source={quotaSource} sourceOk={quotaSourceOk} />
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

        {canManageUsers && UI_DEBUG_CLIENT_ENABLED && (
          <Card>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>Разработка</div>
            <SettingsItem
              title="UI Debug Center"
              subtitle="Fixture-only проверка ролей, toast, событий и редких состояний без изменения данных."
              status="DEV"
              onClick={() => navigate("/ui-debug")}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
