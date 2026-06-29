import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import Card from "../components/ui/Card";
import { useAuth } from "../hooks/auth";
import { hasPermission } from "../utils/permissions";
import {
  getSettingsSummaryCached,
  type QuotaOverviewRole,
  type StorageBudget,
} from "../utils/settingsStatsCache";
import {
  subscribeEventCenterUnread,
} from "../utils/eventCenterUnreadStore";
import { roleBadgeMeta } from "../components/users/userBadgeCatalog";
import type { DisplayRole } from "../utils/roles";

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
  { key: "max_sites_per_project", label: "Сайтов в проекте" },
  { key: "max_pages_per_site", label: "Страниц за прогон" },
  { key: "max_concurrency_per_site", label: "Параллельных запросов" },
  { key: "max_active_jobs_per_user", label: "Активных задач" },
  { key: "max_bulk_sites_per_run", label: "Сайтов в общем запуске" },
];

function SettingsSection({
  title,
  description,
  status,
  defaultOpen = false,
  children,
}: {
  title: string;
  description: string;
  status?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14,
        background: "rgba(255,255,255,0.03)",
        overflow: "hidden",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          listStyle: "none",
          padding: 14,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 800 }}>{title}</span>
          <span style={{ display: "block", marginTop: 4, fontSize: 12, opacity: 0.72 }}>{description}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {status && (
            <span
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
            </span>
          )}
          <span style={{ opacity: 0.65 }}>⌄</span>
        </span>
      </summary>
      <div style={{ padding: "0 14px 14px" }}>{children}</div>
    </details>
  );
}

function MetricTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div
      title={hint}
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: "8px 9px",
        background: "rgba(0,0,0,0.12)",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.68 }}>{label}</div>
      <div style={{ marginTop: 3, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function roleLabel(role: string): string {
  return roleBadgeMeta(role as DisplayRole).label;
}

function storageStatusLabel(status: StorageBudget["status"]): string {
  if (status === "over_budget") return "Превышен лимит";
  if (status === "warning") return "Внимание";
  if (status === "ok") return "В норме";
  return String(status || "Неизвестно");
}

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
    <SettingsSection
      title="Лимиты ролей"
      description="Сколько проектов, сайтов, страниц и одновременных задач доступно каждой роли."
      status={sourceOk ? "Настроено" : "Источник недоступен"}
    >
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12, opacity: 0.78 }}>
          Эти лимиты защищают crawler от слишком тяжёлых запусков. Сейчас они показываются для контроля;
          редактирование через интерфейс лучше вынести отдельным root-admin действием с журналом изменений.
        </div>
        {!sourceOk && (
          <div style={{ color: "#ffc9c9", fontSize: 13 }}>Источник лимитов временно недоступен.</div>
        )}
        {roles.length > 0 && (
          <div style={{ display: "grid", gap: 8 }}>
            {roles.map((row) => (
              <Card key={row.role} style={{ padding: 10, background: "rgba(255,255,255,0.025)" }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 800 }}>{roleLabel(row.role)}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 6 }}>
                    {QUOTA_LABELS.map((item) => (
                      <MetricTile
                        key={item.key}
                        label={item.label}
                        value={row[item.key]}
                      />
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
        <details style={{ fontSize: 12, opacity: 0.72 }}>
          <summary style={{ cursor: "pointer" }}>Технические детали</summary>
          <div style={{ marginTop: 6 }}>Источник значений: {source}.</div>
        </details>
      </div>
    </SettingsSection>
  );
}

function StorageBudgetCard({ budget }: { budget: StorageBudget | null }) {
  if (!budget) return null;
  const toneColor = budget.status === "over_budget" ? "#ff8f8f" : budget.status === "warning" ? "#ffd27d" : "#8ee59c";
  return (
    <SettingsSection
      title="Хранилище сканов"
      description="Сколько места занимают сохранённые HTML и визуальные снимки страниц."
      status={storageStatusLabel(budget.status)}
    >
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div style={{ fontSize: 12, opacity: 0.78 }}>
            История URL, статусы и статистика остаются в базе, а тяжёлые raw HTML/снимки автоматически
            хранятся только для последних успешных прогонов.
          </div>
          <div
            style={{
              border: `1px solid ${toneColor}`,
              color: toneColor,
              borderRadius: 999,
              padding: "3px 8px",
              fontSize: 11,
              fontWeight: 800,
              whiteSpace: "nowrap",
            }}
          >
            {storageStatusLabel(budget.status)}
          </div>
        </div>
        {!budget.sourceOk && <div style={{ color: "#ffc9c9", fontSize: 13 }}>Источник storage статистики временно недоступен.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))", gap: 8 }}>
          <MetricTile label="Использовано" value={`${budget.usedMb} / ${budget.budgetMb} MB`} />
          <MetricTile label="Заполнение" value={`${budget.usagePercent}%`} />
          <MetricTile label="Raw HTML" value={`${budget.rawHtmlMb} MB`} hint="Сохранённый HTML страниц для анализа и сравнения." />
          <MetricTile label="Визуальные снимки" value={`${budget.renderedSnapshotsMb} MB`} hint="Сохранённые rendered snapshots для визуального просмотра." />
        </div>
        <div style={{ fontSize: 12, opacity: 0.78 }}>
          Хранить тяжёлые артефакты для последних {budget.retention.rawArtifactRunsToKeep} успешных прогонов каждого сайта и контекста доступа.
        </div>
        <div style={{ fontSize: 12, opacity: 0.78 }}>
          Всего: проектов {budget.totals.projects}, прогонов {budget.totals.runs}, страниц {budget.totals.pages}, с raw HTML {budget.totals.pagesWithRawHtml}.
        </div>
        {budget.topProjects.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.72 }}>Крупнейшие проекты по raw HTML</div>
            {budget.topProjects.map((project) => (
              <div key={project.projectId} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</span>
                <span style={{ whiteSpace: "nowrap" }}>{project.rawHtmlMb} MB · прогонов: {project.runs} · страниц: {project.pages}</span>
              </div>
            ))}
          </div>
        )}
        <details style={{ fontSize: 12, opacity: 0.72 }}>
          <summary style={{ cursor: "pointer" }}>Технические детали</summary>
          <div style={{ marginTop: 6 }}>
            Источники: {budget.source}, {budget.retention.source}. Env keys: SCAN_STORAGE_BUDGET_MB и SCAN_RAW_ARTIFACT_RUNS_TO_KEEP.
          </div>
        </details>
      </div>
    </SettingsSection>
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
  const [storageBudget, setStorageBudget] = useState<StorageBudget | null>(null);
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
                setStorageBudget(summary.storageBudget);
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
                setStorageBudget(null);
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
          <>
            <QuotaOverviewCard roles={quotaRoles} source={quotaSource} sourceOk={quotaSourceOk} />
            <StorageBudgetCard budget={storageBudget} />
          </>
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
