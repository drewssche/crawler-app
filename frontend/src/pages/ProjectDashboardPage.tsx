import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getProjectSchedule,
  listProjectSitePersonas,
  listProjectSiteSummaries,
  pauseProjectSchedule,
  resumeProjectSchedule,
  saveProjectSchedule,
  type CrawlPersonaSummary,
  type ProjectSchedule,
  type ProjectScheduleInput,
  type ProjectSiteSummary,
} from "../api/projectSites";
import {
  getPageContext,
  retryProblemPages,
  type PageContext,
  type RetryPagesResult,
} from "../api/pageContext";
import {
  createMonitoringTargetSubscription,
  deleteMonitoringTarget,
  deleteMonitoringTargetSubscription,
  getMonitoringNotificationDiagnostics,
  listMonitoringTargetChecks,
  listMonitoringTargetNotificationOutbox,
  listMonitoringTargetSubscriptions,
  listProjectMonitoringTargets,
  previewMonitoringTargetSubscription,
  testSendMonitoringTargetSubscription,
  updateMonitoringTarget,
  updateMonitoringTargetSubscription,
  type MonitoringNotificationDiagnostics,
  type MonitoringNotificationOutboxItem,
  type MonitoringNotificationPreview,
  type MonitoringTarget,
  type MonitoringTargetCheckRecord,
  type MonitoringTargetSubscription,
} from "../api/monitoringTargets";
import { ApiError, apiDelete, apiGet, apiPost } from "../api/client";
import PageContextDrawer from "../components/projects/PageContextDrawer";
import DirectoryContextDrawer from "../components/projects/DirectoryContextDrawer";
import ProjectSiteContextCards from "../components/projects/ProjectSiteContextCards";
import ProjectMembersSettings from "../components/projects/ProjectMembersSettings";
import ProjectSitesSettings from "../components/projects/ProjectSitesSettings";
import AccentPill from "../components/ui/AccentPill";
import Card from "../components/ui/Card";
import CardActionButton from "../components/ui/CardActionButton";
import CardFooterActions from "../components/ui/CardFooterActions";
import ClearableInput from "../components/ui/ClearableInput";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import ListTotalMeta from "../components/ui/ListTotalMeta";
import ProjectRunBadge from "../components/ui/ProjectRunBadge";
import StructureLegendHint from "../components/ui/StructureLegendHint";
import ProjectStructureTree, {
  type ProjectStructureDirectoryContext,
} from "../components/ui/ProjectStructureTree";
import SegmentedControl from "../components/ui/SegmentedControl";
import SectionHeaderRow from "../components/ui/SectionHeaderRow";
import ToastHost, { type ToastItem } from "../components/ui/ToastHost";
import { MetaText, StatusText } from "../components/ui/StatusText";
import { formatOperationalDateTime, formatRunTitle } from "../utils/datetime";
import { invalidateProjectsCache } from "../utils/projectListCache";
import { publishProjectRunLive } from "../utils/projectRunLiveStore";
import { formatQuotaError, isQuotaError } from "../utils/quotaErrors";
import { useAuth } from "../hooks/auth";
import { hasPermission } from "../utils/permissions";
import { refreshEventCenterPollingNow } from "../utils/eventCenterPollingManager";

type ProjectDetails = {
  id: number;
  name: string;
  start_url: string;
  allowed_domains_csv: string;
  exclude_paths_csv: string;
  exclude_ext_csv: string;
  respect_robots: boolean;
  max_pages: number;
  concurrency: number;
  is_enabled: boolean;
};

type ProjectRun = {
  id: number;
  project_id: number;
  project_site_id: number;
  crawl_persona_id: number | null;
  persona: {
    id: number;
    key: string;
    label: string;
    kind: string;
    has_secrets?: boolean;
  } | null;
  status: "CREATED" | "RUNNING" | "FINISHED" | "FAILED" | string;
  crawl_runtime?: "http" | "browser" | string;
  started_at: string;
  finished_at: string | null;
  pages_total: number;
  pages_changed: number;
  pages_discovered: number;
  current_batch_no: number;
  current_url: string | null;
  progress_updated_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
};

type ProjectPage = {
  id: number;
  run_id: number;
  url: string;
  status_code: number;
  html_hash: string;
  final_url: string | null;
  final_status_code: number | null;
  fetch_error_code: string | null;
  fetch_error_message: string | null;
  redirect_chain_json: Array<{ url: string; status_code: number; location: string | null }> | null;
  crawl_batch_no: number | null;
  title?: string | null;
  description?: string | null;
  h1?: string | null;
};

type ProjectRunResult = {
  project_site_id: number;
  site_name: string;
  job_id?: number | null;
  job_status?: string | null;
  run_id: number | null;
  crawl_persona_id?: number | null;
  persona?: {
    id: number;
    key: string;
    label: string;
    kind: string;
  } | null;
  persona_key?: string | null;
  persona_label?: string | null;
  crawl_runtime?: "http" | "browser" | string;
  session_required?: boolean;
  session_status?: string;
  session_message?: string;
  status: string;
  failure_code: string | null;
  failure_message: string | null;
};

type ProjectRunBatch = {
  ok: boolean;
  project_id: number;
  sites_total: number;
  finished: number;
  failed: number;
  skipped: number;
  results: ProjectRunResult[];
};

type StartSiteRunResponse = {
  ok: boolean;
  queued?: boolean;
  job_id?: number | null;
  job_status?: string | null;
  run_id: number | null;
  project_site_id: number;
  crawl_persona_id?: number | null;
  crawl_runtime?: "http" | "browser" | string | null;
  persona?: {
    id: number;
    key: string;
    label: string;
    kind: string;
  } | null;
  persona_label?: string | null;
  persona_key?: string | null;
  session_required?: boolean;
  session_status?: string;
  session_message?: string;
  message?: string;
};

type PendingCrawlerJob = {
  jobId: number;
  siteId: number;
  siteName: string;
  status: string;
  personaLabel: string;
  queuedAt: string;
  scheduledAt?: string | null;
  attempts?: number | null;
  maxAttempts?: number | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  source: "site" | "project";
};

type CrawlerReadiness = {
  ready: boolean;
  status: "ok" | "degraded" | string;
  mode: "worker" | "synchronous" | string;
  jobs?: {
    queued?: number;
    running?: number;
    cancel_requested?: number;
    recovered_expired_jobs?: number;
    diagnostics?: {
      stale_queued?: number;
      oldest_queued_age_seconds?: number | null;
    };
  };
  issues?: Array<{
    code: string;
    severity: "warning" | "critical" | string;
    message: string;
    count?: number;
  }>;
};

type ActiveSiteJobResponse = {
  active: boolean;
  job: null | {
    id: number;
    project_site_id: number;
    crawl_persona_id: number | null;
    run_id: number | null;
    status: string;
    attempts: number;
    max_attempts: number;
    scheduled_at: string;
    started_at: string | null;
    heartbeat_at: string | null;
    failure_code: string | null;
    failure_message: string | null;
    site?: {
      id: number;
      name: string;
      start_url: string;
    } | null;
    persona?: {
      id: number;
      key: string;
      label: string;
      kind: string;
    } | null;
  };
};

type ActiveProjectJobsResponse = {
  active: boolean;
  project_id: number;
  total: number;
  jobs: NonNullable<ActiveSiteJobResponse["job"]>[];
};

type ProjectTab = "main" | "history" | "settings";
type ProjectSettingsSectionId = "sites" | "members" | "schedule" | "danger";
type StructureViewFilter = "all" | "added" | "error";
type MonitoringSubscriptionChannel = "email" | "telegram_chat";
type MonitoringSubscriptionStatus = "changed" | "missing" | "not_checkable";

type StructureStatus = "unchanged" | "changed" | "added" | "deleted" | "redirect" | "error";

const PROJECT_DISCLOSURE_STORAGE_PREFIX = "crawler.projectDashboard.disclosure.";
const WEEKDAY_OPTIONS = [
  { value: 0, label: "Пн" },
  { value: 1, label: "Вт" },
  { value: 2, label: "Ср" },
  { value: 3, label: "Чт" },
  { value: 4, label: "Пт" },
  { value: 5, label: "Сб" },
  { value: 6, label: "Вс" },
];
const MONITORING_SUBSCRIPTION_STATUSES: Array<{ value: MonitoringSubscriptionStatus; label: string }> = [
  { value: "changed", label: "Изменился" },
  { value: "missing", label: "Не найден" },
  { value: "not_checkable", label: "Нужна проверка" },
];

function defaultProjectScheduleInput(): ProjectScheduleInput {
  return {
    is_enabled: false,
    frequency: "daily",
    time_of_day: "09:00",
    weekdays: [0],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

function scheduleToInput(schedule: ProjectSchedule): ProjectScheduleInput {
  return {
    is_enabled: schedule.is_enabled,
    frequency: schedule.frequency === "weekly" ? "weekly" : "daily",
    time_of_day: schedule.time_of_day || "09:00",
    weekdays: schedule.weekdays.length > 0 ? schedule.weekdays : [0],
    timezone: schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

type StructureRow = {
  url: string;
  finalUrl: string | null;
  domain: string;
  status: StructureStatus;
  statusCode: number;
  finalStatusCode: number | null;
  fetchErrorCode: string | null;
  fetchErrorMessage: string | null;
  batchNo: number | null;
  title: string;
  description: string;
  h1: string;
};

type MultiContextStructureSet = {
  personaId: number | null;
  personaLabel: string;
  run: ProjectRun;
  previousRun: ProjectRun | null;
  pages: ProjectPage[];
  previousPages: ProjectPage[];
};

function buildStructureRowsFromPages({
  currentPages,
  previousPages,
  selectedDomains,
  includeDeleted,
}: {
  currentPages: ProjectPage[];
  previousPages: ProjectPage[];
  selectedDomains: string[];
  includeDeleted: boolean;
}): StructureRow[] {
  const hasDomainFilter = selectedDomains.length > 0;
  const prevByUrl = new Map<string, string>();
  for (const row of previousPages) prevByUrl.set(row.url, row.html_hash || "");
  const currentUrls = new Set<string>();
  const rows: StructureRow[] = [];
  for (const row of currentPages) {
    const host = domainOf(row.url);
    if (hasDomainFilter && !selectedDomains.includes(host)) continue;
    currentUrls.add(row.url);
    let status: StructureStatus = "unchanged";
    if (row.fetch_error_code || (row.final_status_code || row.status_code) >= 400) status = "error";
    else if (row.redirect_chain_json && row.redirect_chain_json.length > 1) status = "redirect";
    else if (!prevByUrl.has(row.url)) status = "added";
    else if ((prevByUrl.get(row.url) || "") !== (row.html_hash || "")) status = "changed";
    rows.push({
      url: row.url,
      finalUrl: row.final_url,
      domain: host,
      status,
      statusCode: row.status_code,
      finalStatusCode: row.final_status_code,
      fetchErrorCode: row.fetch_error_code,
      fetchErrorMessage: row.fetch_error_message,
      batchNo: row.crawl_batch_no,
      title: row.title || "",
      description: row.description || "",
      h1: row.h1 || "",
    });
  }
  if (includeDeleted) {
    for (const row of previousPages) {
      const host = domainOf(row.url);
      if (hasDomainFilter && !selectedDomains.includes(host)) continue;
      if (currentUrls.has(row.url)) continue;
      rows.push({
        url: row.url,
        finalUrl: row.final_url,
        domain: host,
        status: "deleted",
        statusCode: 0,
        finalStatusCode: row.final_status_code,
        fetchErrorCode: row.fetch_error_code,
        fetchErrorMessage: row.fetch_error_message,
        batchNo: null,
        title: row.title || "",
        description: row.description || "",
        h1: row.h1 || "",
      });
    }
  }
  rows.sort((a, b) => a.url.localeCompare(b.url));
  return rows;
}

function filterStructureRows(rows: StructureRow[], filter: StructureViewFilter, search: string): StructureRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter !== "all" && row.status !== filter) return false;
    if (!q) return true;
    return [
      row.url,
      row.finalUrl || "",
      row.domain,
      row.status,
      String(row.statusCode || ""),
      String(row.finalStatusCode || ""),
      row.fetchErrorCode || "",
      row.fetchErrorMessage || "",
      row.title,
      row.description,
      row.h1,
    ].some((value) => value.toLowerCase().includes(q));
  });
}

function structureCounts(rows: StructureRow[]) {
  return {
    added: rows.filter((row) => row.status === "added").length,
    error: rows.filter((row) => row.status === "error").length,
    changed: rows.filter((row) => row.status === "changed").length,
  };
}

function monitoringTargetStatusMeta(status?: MonitoringTargetCheckRecord["status"] | null): {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral" | "info";
  text: string;
} {
  if (status === "matched") {
    return { label: "На месте", tone: "success", text: "Блок найден и похож на сохранённый вариант." };
  }
  if (status === "changed") {
    return { label: "Изменился", tone: "warning", text: "Похожий блок найден, но структура отличается." };
  }
  if (status === "missing") {
    return { label: "Не найден", tone: "danger", text: "Страница или блок не найдены в проверенном прогоне." };
  }
  if (status === "not_checkable") {
    return { label: "Нужна проверка", tone: "warning", text: "Автоматическая проверка не смогла уверенно оценить цель." };
  }
  return { label: "Ждёт прогона", tone: "neutral", text: "Цель начнёт проверяться после следующего успешного прогона." };
}

function shortUrlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || "/"}${parsed.search || ""}`;
  } catch {
    return url;
  }
}

function monitoringChannelLabel(channel: string): string {
  if (channel === "telegram_chat") return "Telegram";
  if (channel === "email") return "Email";
  return channel;
}

function deliveryStatusMeta(status: string): { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" } {
  if (status === "sent") return { label: "Отправлено", tone: "success" };
  if (status === "queued") return { label: "В очереди", tone: "info" };
  if (status === "failed") return { label: "Ошибка", tone: "danger" };
  if (status === "dead") return { label: "Остановлено", tone: "danger" };
  return { label: status || "Неизвестно", tone: "neutral" };
}

function readStoredDisclosureState(storageKey: string, defaultOpen: boolean): boolean {
  if (typeof window === "undefined") return defaultOpen;
  const stored = window.localStorage.getItem(`${PROJECT_DISCLOSURE_STORAGE_PREFIX}${storageKey}`);
  if (stored === "open") return true;
  if (stored === "closed") return false;
  return defaultOpen;
}

function ProjectPersistentDetails({
  storageKey,
  defaultOpen = false,
  summary,
  children,
  summaryStyle,
}: {
  storageKey: string;
  defaultOpen?: boolean;
  summary: ReactNode;
  children: ReactNode;
  summaryStyle?: CSSProperties;
}) {
  const [open, setOpen] = useState(() => readStoredDisclosureState(storageKey, defaultOpen));

  function handleToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    const nextOpen = event.currentTarget.open;
    setOpen(nextOpen);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`${PROJECT_DISCLOSURE_STORAGE_PREFIX}${storageKey}`, nextOpen ? "open" : "closed");
    }
  }

  return (
    <details className="project-persistent-details" open={open} onToggle={handleToggle}>
      <summary className="project-persistent-summary" style={summaryStyle}>{summary}</summary>
      {children}
    </details>
  );
}

function getRetryPersonaLabel(result: RetryPagesResult, fallback?: string | null): string {
  return result.persona?.label || result.persona_label || fallback || "Гость";
}

function getRunRuntimeMeta(runtime?: string | null): { label: string; tone: "neutral" | "info"; title: string } {
  if (runtime === "browser") {
    return {
      label: "Browser runtime",
      tone: "info",
      title: "Этот прогон выполнялся через browser-context: применялись cookies, localStorage/sessionStorage и headers выбранной persona.",
    };
  }
  return {
    label: "HTTP runtime",
    tone: "neutral",
    title: "Обычный быстрый HTTP-обход. Browser storage для этого прогона не требовался.",
  };
}

function RunRuntimePill({ runtime }: { runtime?: string | null }) {
  const meta = getRunRuntimeMeta(runtime);
  return <AccentPill tone={meta.tone} title={meta.title}>{meta.label}</AccentPill>;
}

function personaLaunchIssue(persona: CrawlPersonaSummary | null | undefined): string | null {
  if (!persona || persona.kind === "guest") return null;
  const summary = persona.session_bundle_summary;
  if (!persona.has_secrets || !summary || summary.status === "missing") {
    return `Для контекста «${persona.label}» не подключена сессия. Подключите её в настройках сайта.`;
  }
  if (summary.status === "unavailable") {
    return `Сессия контекста «${persona.label}» недоступна. Подключите её заново в настройках сайта.`;
  }
  if (summary.expiry_status === "expired") {
    return `Сессия контекста «${persona.label}» истекла. Обновите её перед запуском.`;
  }
  return null;
}

function personaOptionSuffix(persona: CrawlPersonaSummary): string {
  if (persona.kind === "guest") return "";
  const issue = personaLaunchIssue(persona);
  if (!issue) {
    if (persona.session_bundle_summary?.expiry_status === "expiring") return " · сессия скоро истечёт";
    return " · сессия подключена";
  }
  if (!persona.has_secrets || persona.session_bundle_summary?.status === "missing") return " · без сессии";
  if (persona.session_bundle_summary?.status === "unavailable") return " · сессия недоступна";
  if (persona.session_bundle_summary?.expiry_status === "expired") return " · сессия истекла";
  return " · требует внимания";
}

function personaSessionPillMeta(persona: CrawlPersonaSummary | null | undefined): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (!persona || persona.kind === "guest") return { label: "сессия не нужна", tone: "neutral" };
  const issue = personaLaunchIssue(persona);
  if (!issue) {
    if (persona.session_bundle_summary?.expiry_status === "expiring") return { label: "сессия скоро истечёт", tone: "warning" };
    return { label: "сессия подключена", tone: "success" };
  }
  if (persona.session_bundle_summary?.expiry_status === "expired") return { label: "сессия истекла", tone: "danger" };
  return { label: "без сессии", tone: "warning" };
}

function parseDomains(csv: string): string[] {
  return (csv || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function formatDuration(startedAt?: string, finishedAt?: string | null): string {
  if (!startedAt || !finishedAt) return "—";
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  const totalSec = Math.round((end - start) / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins <= 0) return `${secs} сек`;
  return `${mins} мин ${secs} сек`;
}

function formatTimeAgo(raw?: string | null): string {
  if (!raw) return "—";
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec} сек назад`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

function hasRunStartedAfter(run: ProjectRun, queuedAt: string): boolean {
  const runStarted = Date.parse(run.started_at);
  const queued = Date.parse(queuedAt);
  if (!Number.isFinite(runStarted) || !Number.isFinite(queued)) return false;
  return runStarted >= queued - 5000;
}

function formatRetryWait(raw?: string | null): string | null {
  if (!raw) return null;
  const scheduled = Date.parse(raw);
  if (!Number.isFinite(scheduled)) return null;
  const diffSec = Math.ceil((scheduled - Date.now()) / 1000);
  if (diffSec <= 0) return "уже можно запускать";
  if (diffSec < 60) return `через ${diffSec} сек.`;
  const mins = Math.ceil(diffSec / 60);
  if (mins < 60) return `через ${mins} мин.`;
  return `через ${Math.ceil(mins / 60)} ч.`;
}

function pendingJobRetryText(job: PendingCrawlerJob): string | null {
  const attempts = job.attempts ?? 0;
  const maxAttempts = job.maxAttempts ?? null;
  if (!job.failureCode && attempts <= 0) return null;
  const waitText = formatRetryWait(job.scheduledAt);
  const attemptText = maxAttempts
    ? `попытка ${Math.min(attempts + 1, maxAttempts)} из ${maxAttempts}`
    : `попытка ${attempts + 1}`;
  const reason = job.failureMessage || job.failureCode || "временная ошибка";
  return `Повторная ${attemptText}${waitText ? ` · ${waitText}` : ""}. Причина: ${reason}.`;
}

function formatSecondsCompact(seconds?: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} сек`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours} ч ${restMinutes} мин` : `${hours} ч`;
}

function crawlerModeLabel(mode?: string): string {
  if (mode === "worker") return "worker";
  if (mode === "synchronous") return "sync";
  return mode || "—";
}

function crawlerReadinessLabel(readiness: CrawlerReadiness): string {
  if (readiness.ready && readiness.status === "ok") return "Готов";
  if (readiness.status === "degraded") return "Есть предупреждения";
  return readiness.ready ? "Готов" : "Требует внимания";
}

function notificationDiagnosticsTone(diagnostics: MonitoringNotificationDiagnostics): "success" | "warning" | "danger" {
  if (diagnostics.counts.dead > 0) return "danger";
  if (!diagnostics.smtp_configured && !diagnostics.telegram_configured) return "warning";
  if (diagnostics.counts.failed_waiting > 0 || diagnostics.counts.retry_ready > 0) return "warning";
  return "success";
}

function notificationDiagnosticsLabel(diagnostics: MonitoringNotificationDiagnostics): string {
  if (diagnostics.counts.dead > 0) return "Есть остановленные";
  if (!diagnostics.smtp_configured && !diagnostics.telegram_configured) return "Каналы не настроены";
  if (diagnostics.counts.retry_ready > 0) return "Есть готовые к повтору";
  if (diagnostics.counts.failed_waiting > 0) return "Ждёт повторной доставки";
  if (diagnostics.counts.queued > 0) return "Есть очередь";
  return "Готово";
}

function pendingJobsFromActiveProjectJobs(
  payload: ActiveProjectJobsResponse,
  sites: ProjectSiteSummary[],
): Record<number, PendingCrawlerJob> {
  const sitesById = new Map(sites.map((site) => [site.id, site]));
  const next: Record<number, PendingCrawlerJob> = {};
  for (const job of payload.jobs || []) {
    if (job.status !== "QUEUED") continue;
    const site = sitesById.get(job.project_site_id);
    next[job.project_site_id] = {
      jobId: job.id,
      siteId: job.project_site_id,
      siteName: job.site?.name || site?.name || "Сайт",
      status: job.status,
      personaLabel: job.persona?.label || site?.default_persona?.label || "Гость",
      queuedAt: job.scheduled_at,
      scheduledAt: job.scheduled_at,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      failureCode: job.failure_code,
      failureMessage: job.failure_message,
      source: "project",
    };
  }
  return next;
}

export default function ProjectDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [sites, setSites] = useState<ProjectSiteSummary[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [runs, setRuns] = useState<ProjectRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runPending, setRunPending] = useState(false);
  const [projectRunPending, setProjectRunPending] = useState(false);
  const [projectRunResult, setProjectRunResult] = useState<ProjectRunBatch | null>(null);
  const [projectSchedule, setProjectSchedule] = useState<ProjectSchedule | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ProjectScheduleInput>(() => defaultProjectScheduleInput());
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [activeTab, setActiveTab] = useState<ProjectTab>("main");
  const [activeSettingsSection, setActiveSettingsSection] = useState<ProjectSettingsSectionId>("sites");
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [domainPickerSearch, setDomainPickerSearch] = useState("");
  const [structureSearch, setStructureSearch] = useState("");
  const [structureViewFilter, setStructureViewFilter] = useState<StructureViewFilter>("all");
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState("");
  const [lastRunPages, setLastRunPages] = useState<ProjectPage[]>([]);
  const [prevRunPages, setPrevRunPages] = useState<ProjectPage[]>([]);
  const [multiContextStructureSets, setMultiContextStructureSets] = useState<MultiContextStructureSet[]>([]);
  const [activeMultiContextStructureRunId, setActiveMultiContextStructureRunId] = useState<number | null>(null);
  const [pageContextOpen, setPageContextOpen] = useState(false);
  const [pageContextLoading, setPageContextLoading] = useState(false);
  const [pageContextError, setPageContextError] = useState("");
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [pageContextRunId, setPageContextRunId] = useState<number | null>(null);
  const [directoryContext, setDirectoryContext] = useState<ProjectStructureDirectoryContext | null>(null);
  const [pageRetryPending, setPageRetryPending] = useState(false);
  const [pageRetryMessage, setPageRetryMessage] = useState("");
  const [pageRetrySucceeded, setPageRetrySucceeded] = useState<boolean | null>(null);
  const [bulkRetryPending, setBulkRetryPending] = useState(false);
  const [bulkRetryResult, setBulkRetryResult] = useState<RetryPagesResult | null>(null);
  const [bulkRetryError, setBulkRetryError] = useState("");
  const [structureRetryingUrl, setStructureRetryingUrl] = useState<string | null>(null);
  const [structureRetryResultByUrl, setStructureRetryResultByUrl] = useState<
    Record<string, "success" | "failed" | "skipped">
  >({});
  const [structureRetryNotice, setStructureRetryNotice] = useState("");
  const [structureRetryNoticeTone, setStructureRetryNoticeTone] = useState<"success" | "warning">("success");
  const [runElapsedSeconds, setRunElapsedSeconds] = useState(0);
  const [runToasts, setRunToasts] = useState<ToastItem[]>([]);
  const [pendingCrawlerJobs, setPendingCrawlerJobs] = useState<Record<number, PendingCrawlerJob>>({});
  const [crawlerReadiness, setCrawlerReadiness] = useState<CrawlerReadiness | null>(null);
  const [notificationDiagnostics, setNotificationDiagnostics] = useState<MonitoringNotificationDiagnostics | null>(null);
  const [notificationDiagnosticsLoading, setNotificationDiagnosticsLoading] = useState(false);
  const [notificationDiagnosticsError, setNotificationDiagnosticsError] = useState("");
  const [sitePersonas, setSitePersonas] = useState<CrawlPersonaSummary[]>([]);
  const [sitePersonasLoading, setSitePersonasLoading] = useState(false);
  const [selectedRunPersonaId, setSelectedRunPersonaId] = useState<number | null>(null);
  const [selectedViewPersonaId, setSelectedViewPersonaId] = useState<number | "all">("all");
  const [monitoringTargets, setMonitoringTargets] = useState<MonitoringTarget[]>([]);
  const [monitoringTargetsLoading, setMonitoringTargetsLoading] = useState(false);
  const [monitoringTargetsError, setMonitoringTargetsError] = useState("");
  const [targetChecksById, setTargetChecksById] = useState<Record<number, MonitoringTargetCheckRecord[]>>({});
  const [targetChecksLoadingId, setTargetChecksLoadingId] = useState<number | null>(null);
  const [targetChecksErrorById, setTargetChecksErrorById] = useState<Record<number, string>>({});
  const [targetActionPendingId, setTargetActionPendingId] = useState<number | null>(null);
  const [targetRenameId, setTargetRenameId] = useState<number | null>(null);
  const [targetRenameValue, setTargetRenameValue] = useState("");
  const [targetActionError, setTargetActionError] = useState("");
  const [targetDeleteConfirm, setTargetDeleteConfirm] = useState<MonitoringTarget | null>(null);
  const [targetSubscriptionsById, setTargetSubscriptionsById] = useState<Record<number, MonitoringTargetSubscription[]>>({});
  const [targetSubscriptionsLoadingId, setTargetSubscriptionsLoadingId] = useState<number | null>(null);
  const [targetSubscriptionsErrorById, setTargetSubscriptionsErrorById] = useState<Record<number, string>>({});
  const [targetOutboxById, setTargetOutboxById] = useState<Record<number, MonitoringNotificationOutboxItem[]>>({});
  const [targetOutboxLoadingId, setTargetOutboxLoadingId] = useState<number | null>(null);
  const [targetOutboxErrorById, setTargetOutboxErrorById] = useState<Record<number, string>>({});
  const [subscriptionActionPendingId, setSubscriptionActionPendingId] = useState<number | string | null>(null);
  const [subscriptionFormTargetId, setSubscriptionFormTargetId] = useState<number | null>(null);
  const [subscriptionChannel, setSubscriptionChannel] = useState<MonitoringSubscriptionChannel>("email");
  const [subscriptionDestination, setSubscriptionDestination] = useState("");
  const [subscriptionStatuses, setSubscriptionStatuses] = useState<MonitoringSubscriptionStatus[]>(["changed", "missing", "not_checkable"]);
  const [subscriptionMinInterval, setSubscriptionMinInterval] = useState("0");
  const [subscriptionPreviewById, setSubscriptionPreviewById] = useState<Record<number, Pick<MonitoringNotificationPreview, "subject" | "body" | "payload">>>({});
  const [subscriptionTestResultById, setSubscriptionTestResultById] = useState<Record<number, string>>({});
  const canRunCrawler = hasPermission(user?.role, "crawler.run");
  const canEditProject = hasPermission(user?.role, "projects.edit");
  const canViewEvents = hasPermission(user?.role, "events.view");
  const canViewOperations = hasPermission(user?.role, "audit.view");

  function showRunToast(item: Omit<ToastItem, "id">) {
    const toast = { ...item, id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
    setRunToasts((current) => [toast, ...current].slice(0, 3));
  }

  async function fetchRunPages(runId: number): Promise<ProjectPage[]> {
    const rows = await apiGet<ProjectPage[]>(`/runs/${runId}/pages`);
    return Array.isArray(rows) ? rows : [];
  }

  const loadSiteSummaries = useCallback(async (projectId: number, silent = false) => {
    if (!silent) setSitesLoading(true);
    try {
      const next = await listProjectSiteSummaries(projectId);
      setSites(next);
      setSelectedSiteId((current) => {
        if (current && next.some((site) => site.id === current)) return current;
        return next.find((site) => site.is_enabled)?.id ?? next[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить сайты проекта.");
    } finally {
      if (!silent) setSitesLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async (siteId: number, silent = false, personaId: number | "all" = selectedViewPersonaId) => {
    if (!silent) setRunsLoading(true);
    setRunsError("");
    try {
      const personaQuery = personaId === "all" ? "" : `?crawl_persona_id=${personaId}`;
      const data = await apiGet<ProjectRun[]>(`/runs/by-site/${siteId}${personaQuery}`);
      const next = Array.isArray(data) ? data : [];
      setRuns(next);
      const first = next[0];
      if (first && project) {
        publishProjectRunLive({
          projectId: project.id,
          status: first.status,
          crawlRuntime: first.crawl_runtime,
          startedAt: first.started_at,
          finishedAt: first.finished_at,
          pagesTotal: first.pages_total,
          pagesChanged: first.pages_changed,
          runsTotal: next.length,
        });
      }
    } catch (e) {
      setRunsError(String(e));
    } finally {
      if (!silent) setRunsLoading(false);
    }
  }, [project, selectedViewPersonaId]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError("");
    setProject(null);
    setSelectedSiteId(null);
    setMonitoringTargets([]);
    setTargetChecksById({});
    setTargetChecksErrorById({});
    setTargetActionError("");
    setTargetRenameId(null);
    setTargetDeleteConfirm(null);
    setTargetSubscriptionsById({});
    setTargetSubscriptionsErrorById({});
    setTargetOutboxById({});
    setTargetOutboxErrorById({});
    setSubscriptionFormTargetId(null);
    setSubscriptionPreviewById({});
    setSubscriptionTestResultById({});
    Promise.all([
      apiGet<ProjectDetails>(`/projects/${id}`),
      listProjectSiteSummaries(Number(id)),
      apiGet<ActiveProjectJobsResponse>(`/runs/active-jobs/by-project/${id}`),
      getProjectSchedule(Number(id)),
    ])
      .then(([nextProject, nextSites, activeJobs, nextSchedule]) => {
        setProject(nextProject);
        setSites(nextSites);
        setProjectSchedule(nextSchedule);
        setScheduleForm(scheduleToInput(nextSchedule));
        setSelectedSiteId(nextSites.find((site) => site.is_enabled)?.id ?? nextSites[0]?.id ?? null);
        setPendingCrawlerJobs(pendingJobsFromActiveProjectJobs(activeJobs, nextSites));
      })
      .catch((e) => setError(String(e)))
      .finally(() => {
        setLoading(false);
        setSitesLoading(false);
      });
  }, [id]);

  useEffect(() => {
    if (!project) {
      setMonitoringTargets([]);
      return;
    }
    let cancelled = false;
    setMonitoringTargetsLoading(true);
    setMonitoringTargetsError("");
    listProjectMonitoringTargets(project.id, 100)
      .then((payload) => {
        if (!cancelled) setMonitoringTargets(payload.items || []);
      })
      .catch((e) => {
        if (!cancelled) setMonitoringTargetsError(e instanceof Error ? e.message : "Не удалось загрузить цели мониторинга.");
      })
      .finally(() => {
        if (!cancelled) setMonitoringTargetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    if (selectedSiteId === null) {
      setRuns([]);
      setSitePersonas([]);
      setSelectedRunPersonaId(null);
      setSelectedViewPersonaId("all");
      return;
    }
    void loadRuns(selectedSiteId);
  }, [selectedSiteId, loadRuns]);

  useEffect(() => {
    if (selectedSiteId === null) return;
    setPagesError("");
    setStructureSearch("");
    setStructureViewFilter("all");
    setPageContextOpen(false);
    setPageContextRunId(null);
    setDirectoryContext(null);
  }, [selectedViewPersonaId, selectedSiteId]);

  useEffect(() => {
    if (!project || selectedSiteId === null) return;
    let cancelled = false;
    setSitePersonasLoading(true);
    listProjectSitePersonas(project.id, selectedSiteId)
      .then((rows) => {
        if (cancelled) return;
        setSitePersonas(rows);
        setSelectedViewPersonaId((current) => {
          if (current === "all") return current;
          return rows.some((row) => row.id === current) ? current : "all";
        });
        setSelectedRunPersonaId((current) => {
          if (current && rows.some((row) => row.id === current && row.is_enabled !== false)) return current;
          const defaultPersona = rows.find((row) => row.is_default && row.is_enabled !== false);
          return defaultPersona?.id ?? rows.find((row) => row.is_enabled !== false)?.id ?? null;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSitePersonas([]);
        setSelectedRunPersonaId(null);
      })
      .finally(() => {
        if (!cancelled) setSitePersonasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project, selectedSiteId]);

  useEffect(() => {
    if (selectedSiteId === null) return;
    const hasRunning = runs.some((r) => r.status === "RUNNING");
    const hasPendingJob = Boolean(pendingCrawlerJobs[selectedSiteId]);
    if (!hasRunning && !hasPendingJob) return;
    const timer = window.setInterval(() => {
      void loadRuns(selectedSiteId, true);
      if (project) void loadSiteSummaries(project.id, true);
      if (canViewOperations) {
        apiGet<CrawlerReadiness>("/crawler/readiness")
          .then(setCrawlerReadiness)
          .catch(() => undefined);
      }
      if (hasPendingJob) {
        apiGet<ActiveSiteJobResponse>(`/runs/active-job/by-site/${selectedSiteId}`)
          .then((payload) => {
            if (payload.active && payload.job?.status === "QUEUED") {
              const job = payload.job;
              const currentSite = sites.find((site) => site.id === selectedSiteId) || null;
              setPendingCrawlerJobs((current) => ({
                ...current,
                [selectedSiteId]: {
                  jobId: job.id,
                  siteId: selectedSiteId,
                  siteName: job.site?.name || currentSite?.name || "Сайт",
                  status: job.status,
                  personaLabel: job.persona?.label || currentSite?.default_persona?.label || "Гость",
                  queuedAt: job.scheduled_at,
                  scheduledAt: job.scheduled_at,
                  attempts: job.attempts,
                  maxAttempts: job.max_attempts,
                  failureCode: job.failure_code,
                  failureMessage: job.failure_message,
                  source: "site",
                },
              }));
            } else if (!payload.active) {
              setPendingCrawlerJobs((current) => {
                if (!current[selectedSiteId]) return current;
                const next = { ...current };
                delete next[selectedSiteId];
                return next;
              });
            }
          })
          .catch(() => undefined);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [selectedSiteId, runs, project, loadRuns, loadSiteSummaries, pendingCrawlerJobs, sites, canViewOperations]);

  useEffect(() => {
    if (!project || !canViewOperations) {
      setCrawlerReadiness(null);
      setNotificationDiagnostics(null);
      setNotificationDiagnosticsError("");
      return;
    }
    let cancelled = false;
    apiGet<CrawlerReadiness>("/crawler/readiness")
      .then((payload) => {
        if (!cancelled) setCrawlerReadiness(payload);
      })
      .catch(() => undefined);
    setNotificationDiagnosticsLoading(true);
    setNotificationDiagnosticsError("");
    getMonitoringNotificationDiagnostics()
      .then((payload) => {
        if (!cancelled) setNotificationDiagnostics(payload);
      })
      .catch((e) => {
        if (!cancelled) setNotificationDiagnosticsError(e instanceof Error ? e.message : "Не удалось загрузить диагностику уведомлений.");
      })
      .finally(() => {
        if (!cancelled) setNotificationDiagnosticsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project, canViewOperations]);

  useEffect(() => {
    if (selectedSiteId === null) return;
    const pending = pendingCrawlerJobs[selectedSiteId];
    if (!pending) return;
    const matchingRun = runs.find((run) => run.id > 0 && run.project_site_id === selectedSiteId && hasRunStartedAfter(run, pending.queuedAt));
    if (!matchingRun || (matchingRun.status !== "RUNNING" && matchingRun.status !== "FINISHED")) return;
    setPendingCrawlerJobs((current) => {
      const next = { ...current };
      delete next[selectedSiteId];
      return next;
    });
    if (matchingRun.status === "RUNNING") {
      showRunToast({
        title: `Worker взял «${pending.siteName}» в работу`,
        body: `Контекст: ${pending.personaLabel}. Структура начнёт обновляться по мере обхода страниц.`,
        accent: "info",
      });
    } else {
      showRunToast({
        title: `Прогон «${pending.siteName}» завершён`,
        body: matchingRun.status === "FINISHED"
          ? "Новые результаты уже загружены. Можно открыть структуру и изменения."
          : matchingRun.failure_message || "Задача вышла из очереди, но завершилась неуспешно.",
        accent: matchingRun.status === "FINISHED" ? "success" : "warning",
      });
    }
  }, [selectedSiteId, pendingCrawlerJobs, runs]);

  useEffect(() => {
    if (!runPending && !projectRunPending && Object.keys(pendingCrawlerJobs).length === 0) {
      setRunElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setRunElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setRunElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [runPending, projectRunPending, pendingCrawlerJobs]);

  async function handleSaveSchedule() {
    if (!project || scheduleSaving) return;
    setScheduleSaving(true);
    setScheduleError("");
    try {
      const next = await saveProjectSchedule(project.id, scheduleForm);
      setProjectSchedule(next);
      setScheduleForm(scheduleToInput(next));
      showRunToast({
        title: next.is_enabled ? "Расписание сохранено" : "Расписание сохранено выключенным",
        body: next.next_run_at ? `Следующий запуск: ${formatOperationalDateTime(next.next_run_at)}.` : "Автозапуск выключен.",
        accent: "success",
      });
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : "Не удалось сохранить расписание.");
    } finally {
      setScheduleSaving(false);
    }
  }

  async function handlePauseSchedule() {
    if (!project || scheduleSaving) return;
    setScheduleSaving(true);
    setScheduleError("");
    try {
      const next = await pauseProjectSchedule(project.id);
      setProjectSchedule(next);
      setScheduleForm(scheduleToInput(next));
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : "Не удалось поставить расписание на паузу.");
    } finally {
      setScheduleSaving(false);
    }
  }

  async function handleResumeSchedule() {
    if (!project || scheduleSaving) return;
    setScheduleSaving(true);
    setScheduleError("");
    try {
      const next = await resumeProjectSchedule(project.id);
      setProjectSchedule(next);
      setScheduleForm(scheduleToInput(next));
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : "Не удалось включить расписание.");
    } finally {
      setScheduleSaving(false);
    }
  }

  async function handleStartRun() {
    const selectedSite = sites.find((site) => site.id === selectedSiteId);
    if (!project || !selectedSite || runPending) return;
    const selectedPersona =
      sitePersonas.find((persona) => persona.id === selectedRunPersonaId) ||
      selectedSite.default_persona ||
      { id: 0, key: "guest", label: "Гость", kind: "guest", has_secrets: false };
    const launchIssue = personaLaunchIssue(selectedPersona);
    if (launchIssue) {
      setRunsError(launchIssue);
      showRunToast({
        title: `«${selectedPersona.label}» нельзя запустить без активной сессии`,
        body: launchIssue,
        accent: "warning",
      });
      return;
    }
    setRunPending(true);
    setRunsError("");
    try {
      const result = await apiPost<StartSiteRunResponse>(
        `/runs/start-site/${selectedSite.id}`,
        selectedPersona.id ? { crawl_persona_id: selectedPersona.id } : {},
      );
      if (result.queued && result.job_id) {
        const queuedAt = new Date().toISOString();
        publishProjectRunLive({
          projectId: project.id,
          status: "QUEUED",
          crawlRuntime: result.crawl_runtime || (selectedPersona.session_bundle_summary?.browser_state_stored ? "browser" : "http"),
          startedAt: queuedAt,
          pagesTotal: 0,
          pagesChanged: 0,
        });
        setPendingCrawlerJobs((current) => ({
          ...current,
          [selectedSite.id]: {
            jobId: result.job_id!,
            siteId: selectedSite.id,
            siteName: selectedSite.name,
            status: result.job_status || "QUEUED",
            personaLabel: result.persona?.label || result.persona_label || selectedPersona.label,
            queuedAt,
            scheduledAt: queuedAt,
            attempts: 0,
            maxAttempts: null,
            failureCode: null,
            failureMessage: null,
            source: "site",
          },
        }));
        showRunToast({
          title: `«${selectedSite.name}» в очереди`,
          body: `Job #${result.job_id}. Worker заберёт задачу автоматически; можно оставаться на странице.`,
          accent: "info",
        });
        if (canViewOperations) void apiGet<CrawlerReadiness>("/crawler/readiness").then(setCrawlerReadiness).catch(() => undefined);
      }
      await Promise.all([
        loadRuns(selectedSite.id, true),
        loadSiteSummaries(project.id, true),
      ]);
      if (!result.queued) {
        showRunToast({
          title: `Прогон «${selectedSite.name}» завершён`,
          body: "Новые результаты уже загружены. Можно открыть структуру и изменения.",
          accent: "success",
        });
      }
      if (canViewEvents) void refreshEventCenterPollingNow().catch(() => undefined);
    } catch (e) {
      await Promise.all([
        loadRuns(selectedSite.id, true),
        loadSiteSummaries(project.id, true),
      ]);
      if (e instanceof ApiError && ["run_already_active", "site_run_already_active"].includes(e.code)) {
        setRunsError("Для выбранного сайта уже выполняется прогон.");
      } else if (isQuotaError(e)) {
        setRunsError(formatQuotaError(e));
      } else if (e instanceof ApiError && e.code.startsWith("persona_session_")) {
        setRunsError(e.message || "Сессия выбранного контекста недоступна. Подключите её заново в настройках сайта.");
      } else if (e instanceof ApiError && e.status !== 502) {
        setRunsError(e.message);
      } else if (!(e instanceof ApiError)) {
        setRunsError("Не удалось запустить прогон.");
      }
      showRunToast({
        title: `Прогон «${selectedSite.name}» завершился ошибкой`,
        body: isQuotaError(e) ? formatQuotaError(e) : e instanceof Error ? e.message : "Откройте карточку прогона, чтобы увидеть причину.",
        accent: "danger",
      });
      if (canViewEvents) void refreshEventCenterPollingNow().catch(() => undefined);
    } finally {
      setRunPending(false);
    }
  }

  async function handleStartAllSites() {
    if (!project || projectRunPending) return;
    setProjectRunPending(true);
    setProjectRunResult(null);
    setRunsError("");
    showRunToast({
      title: "Общий запуск начат",
      body: `Backend поставит включённые сайты проекта «${project.name}» в очередь worker.`,
      accent: "info",
    });
    try {
      const result = await apiPost<ProjectRunBatch>(`/runs/start-project/${project.id}`, {});
      setProjectRunResult(result);
      const queuedResults = result.results.filter((row) => row.status === "QUEUED" && row.job_id);
      if (queuedResults.length > 0) {
        const queuedAt = new Date().toISOString();
        setPendingCrawlerJobs((current) => {
          const next = { ...current };
          for (const row of queuedResults) {
            next[row.project_site_id] = {
              jobId: row.job_id!,
              siteId: row.project_site_id,
              siteName: row.site_name,
              status: row.job_status || row.status,
              personaLabel: row.persona?.label || row.persona_label || "Гость",
              queuedAt,
              scheduledAt: queuedAt,
              attempts: 0,
              maxAttempts: null,
              failureCode: null,
              failureMessage: null,
              source: "project",
            };
          }
          return next;
        });
        if (canViewOperations) void apiGet<CrawlerReadiness>("/crawler/readiness").then(setCrawlerReadiness).catch(() => undefined);
      }
      await loadSiteSummaries(project.id, true);
      if (selectedSiteId !== null) await loadRuns(selectedSiteId, true);
      showRunToast({
        title: queuedResults.length > 0 ? "Сайты поставлены в очередь" : "Общий запуск завершён",
        body: queuedResults.length > 0
          ? `В очереди worker: ${queuedResults.length}. Пропущено: ${result.skipped}.`
          : `Успешно: ${result.finished}. С ошибкой: ${result.failed}. Пропущено: ${result.skipped}.`,
        accent: result.failed > 0 || result.skipped > 0 ? "warning" : "success",
      });
      if (canViewEvents) void refreshEventCenterPollingNow().catch(() => undefined);
    } catch (e) {
      setRunsError(isQuotaError(e) ? formatQuotaError(e) : e instanceof Error ? e.message : "Не удалось запустить сайты проекта.");
      showRunToast({
        title: "Общий запуск завершился ошибкой",
        body: isQuotaError(e) ? formatQuotaError(e) : e instanceof Error ? e.message : "Не удалось получить результат запуска.",
        accent: "danger",
      });
      if (canViewEvents) void refreshEventCenterPollingNow().catch(() => undefined);
    } finally {
      setProjectRunPending(false);
    }
  }

  async function handleOpenPageContextForRun(runId: number | null, url: string) {
    if (runId === null) return;
    setDirectoryContext(null);
    setPageContextRunId(runId);
    setPageContextOpen(true);
    setPageContextLoading(true);
    setPageContextError("");
    setPageRetryMessage("");
    setPageRetrySucceeded(null);
    setPageContext(null);
    try {
      setPageContext(await getPageContext(runId, url));
    } catch (e) {
      setPageContextError(
        e instanceof ApiError && e.status === 404
          ? "Страница отсутствует в текущем run. Возможно, она была удалена после предыдущего прогона."
          : e instanceof Error ? e.message : "Не удалось загрузить контекст страницы.",
      );
    } finally {
      setPageContextLoading(false);
    }
  }

  async function handleOpenPageContext(url: string) {
    await handleOpenPageContextForRun(structureRunId, url);
  }

  async function handleRetryCurrentPage() {
    const retryRunId = pageContextRunId ?? structureRunId;
    if (retryRunId === null || !pageContext || pageRetryPending) return;
    setPageRetryPending(true);
    setPageRetryMessage("");
    setPageRetrySucceeded(null);
    try {
      const result = await retryProblemPages(retryRunId, [pageContext.page.url]);
      const succeeded = result.succeeded > 0;
      const personaLabel = getRetryPersonaLabel(result, pageContext.page.persona?.label);
      setPageRetrySucceeded(succeeded);
      setPageRetryMessage(
        succeeded
          ? `Повторено как «${personaLabel}»: страница снова доступна. Исходный результат прогона сохранён.`
          : result.skipped > 0
            ? `Повторено как «${personaLabel}»: лимит повторных попыток исчерпан.`
            : `Повторено как «${personaLabel}»: проверка завершена, но ошибка сохранилась.`,
      );
      setPageContext(await getPageContext(retryRunId, pageContext.page.url));
    } catch (e) {
      setPageRetrySucceeded(false);
      setPageRetryMessage(e instanceof Error ? e.message : "Не удалось повторно проверить страницу.");
    } finally {
      setPageRetryPending(false);
    }
  }

  async function handleRetryAllProblemPages() {
    if (structureRunId === null || bulkRetryPending) return;
    setBulkRetryPending(true);
    setBulkRetryResult(null);
    setBulkRetryError("");
    try {
      const result = await retryProblemPages(structureRunId);
      setBulkRetryResult(result);
      setStructureRetryResultByUrl((current) => {
        const next = { ...current };
        for (const row of result.results) {
          next[row.url] = row.status === "SUCCEEDED" ? "success" : row.status === "FAILED" ? "failed" : "skipped";
        }
        return next;
      });
    } catch (e) {
      setBulkRetryError(e instanceof Error ? e.message : "Не удалось повторно проверить проблемные страницы.");
    } finally {
      setBulkRetryPending(false);
    }
  }

  async function handleRetryStructurePage(url: string) {
    if (structureRunId === null || structureRetryingUrl) return;
    setStructureRetryingUrl(url);
    setStructureRetryNotice("");
    try {
      const result = await retryProblemPages(structureRunId, [url]);
      const row = result.results[0];
      const state = row?.status === "SUCCEEDED" ? "success" : row?.status === "FAILED" ? "failed" : "skipped";
      const personaLabel = getRetryPersonaLabel(result, structureRun?.persona?.label);
      setStructureRetryResultByUrl((current) => ({ ...current, [url]: state }));
      setStructureRetryNoticeTone(state === "success" ? "success" : "warning");
      setStructureRetryNotice(
        state === "success"
          ? `Повторено как «${personaLabel}»: страница снова доступна. Исходная ошибка сохранена в истории прогона.`
          : state === "failed"
            ? `Повторено как «${personaLabel}»: ошибка сохранилась.`
            : row?.message || `Повторено как «${personaLabel}»: повторная проверка сейчас недоступна.`,
      );
    } catch (e) {
      setStructureRetryResultByUrl((current) => ({ ...current, [url]: "failed" }));
      setStructureRetryNoticeTone("warning");
      setStructureRetryNotice(e instanceof Error ? e.message : "Не удалось повторно проверить страницу.");
    } finally {
      setStructureRetryingUrl(null);
    }
  }

  async function loadTargetChecks(targetId: number) {
    if (targetChecksById[targetId] || targetChecksLoadingId === targetId) return;
    setTargetChecksLoadingId(targetId);
    setTargetChecksErrorById((current) => ({ ...current, [targetId]: "" }));
    try {
      const payload = await listMonitoringTargetChecks(targetId, 8);
      setTargetChecksById((current) => ({ ...current, [targetId]: payload.items || [] }));
    } catch (e) {
      setTargetChecksErrorById((current) => ({
        ...current,
        [targetId]: e instanceof Error ? e.message : "Не удалось загрузить историю проверок цели.",
      }));
    } finally {
      setTargetChecksLoadingId(null);
    }
  }

  async function loadTargetSubscriptions(targetId: number, force = false) {
    if (!force && targetSubscriptionsById[targetId] && targetOutboxById[targetId]) return;
    setTargetSubscriptionsLoadingId(targetId);
    setTargetOutboxLoadingId(targetId);
    setTargetSubscriptionsErrorById((current) => ({ ...current, [targetId]: "" }));
    setTargetOutboxErrorById((current) => ({ ...current, [targetId]: "" }));
    try {
      const [subscriptionsPayload, outboxPayload] = await Promise.all([
        listMonitoringTargetSubscriptions(targetId),
        listMonitoringTargetNotificationOutbox(targetId, 8),
      ]);
      setTargetSubscriptionsById((current) => ({ ...current, [targetId]: subscriptionsPayload.items || [] }));
      setTargetOutboxById((current) => ({ ...current, [targetId]: outboxPayload.items || [] }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Не удалось загрузить уведомления цели.";
      setTargetSubscriptionsErrorById((current) => ({ ...current, [targetId]: message }));
      setTargetOutboxErrorById((current) => ({ ...current, [targetId]: message }));
    } finally {
      setTargetSubscriptionsLoadingId(null);
      setTargetOutboxLoadingId(null);
    }
  }

  function startAddSubscription(targetId: number) {
    setSubscriptionFormTargetId(targetId);
    setSubscriptionChannel("email");
    setSubscriptionDestination("");
    setSubscriptionStatuses(["changed", "missing", "not_checkable"]);
    setSubscriptionMinInterval("0");
    setTargetActionError("");
  }

  function toggleSubscriptionStatus(status: MonitoringSubscriptionStatus) {
    setSubscriptionStatuses((current) => {
      if (current.includes(status)) {
        return current.length > 1 ? current.filter((item) => item !== status) : current;
      }
      return [...current, status];
    });
  }

  async function handleCreateSubscription(target: MonitoringTarget) {
    const destination = subscriptionDestination.trim();
    if (!destination || subscriptionActionPendingId) return;
    const minInterval = Number.parseInt(subscriptionMinInterval || "0", 10);
    setSubscriptionActionPendingId(`new-${target.id}`);
    setTargetActionError("");
    try {
      const created = await createMonitoringTargetSubscription(target.id, {
        channel_type: subscriptionChannel,
        destination,
        statuses: subscriptionStatuses,
        min_interval_minutes: Number.isFinite(minInterval) && minInterval > 0 ? minInterval : 0,
      });
      setTargetSubscriptionsById((current) => ({
        ...current,
        [target.id]: [created, ...(current[target.id] || [])],
      }));
      setSubscriptionFormTargetId(null);
      setSubscriptionDestination("");
    } catch (e) {
      setTargetActionError(e instanceof Error ? e.message : "Не удалось добавить подписку.");
    } finally {
      setSubscriptionActionPendingId(null);
    }
  }

  async function handleToggleSubscription(subscription: MonitoringTargetSubscription) {
    if (subscriptionActionPendingId) return;
    setSubscriptionActionPendingId(subscription.id);
    setTargetActionError("");
    try {
      const updated = await updateMonitoringTargetSubscription(subscription.id, { is_active: !subscription.is_active });
      setTargetSubscriptionsById((current) => ({
        ...current,
        [subscription.target_id]: (current[subscription.target_id] || []).map((item) => item.id === updated.id ? updated : item),
      }));
    } catch (e) {
      setTargetActionError(e instanceof Error ? e.message : "Не удалось обновить подписку.");
    } finally {
      setSubscriptionActionPendingId(null);
    }
  }

  async function handlePreviewSubscription(subscription: MonitoringTargetSubscription) {
    if (subscriptionActionPendingId) return;
    setSubscriptionActionPendingId(`preview-${subscription.id}`);
    setTargetActionError("");
    setSubscriptionTestResultById((current) => ({ ...current, [subscription.id]: "" }));
    try {
      const preview = await previewMonitoringTargetSubscription(subscription.id);
      setSubscriptionPreviewById((current) => ({ ...current, [subscription.id]: preview }));
    } catch (e) {
      setTargetActionError(e instanceof Error ? e.message : "Не удалось собрать preview уведомления.");
    } finally {
      setSubscriptionActionPendingId(null);
    }
  }

  async function handleTestSendSubscription(subscription: MonitoringTargetSubscription) {
    if (subscriptionActionPendingId) return;
    setSubscriptionActionPendingId(`test-${subscription.id}`);
    setTargetActionError("");
    try {
      const result = await testSendMonitoringTargetSubscription(subscription.id);
      setSubscriptionPreviewById((current) => ({
        ...current,
        [subscription.id]: result.preview,
      }));
      setSubscriptionTestResultById((current) => ({
        ...current,
        [subscription.id]: result.ok
          ? "Тестовое уведомление отправлено."
          : result.outbox.last_error || "Тестовая доставка не прошла, запись сохранена в истории доставок.",
      }));
      setTargetOutboxById((current) => ({
        ...current,
        [subscription.target_id]: [result.outbox, ...(current[subscription.target_id] || []).filter((item) => item.id !== result.outbox.id)].slice(0, 8),
      }));
      void getMonitoringNotificationDiagnostics()
        .then(setNotificationDiagnostics)
        .catch(() => undefined);
    } catch (e) {
      setTargetActionError(e instanceof Error ? e.message : "Не удалось выполнить тестовую отправку.");
    } finally {
      setSubscriptionActionPendingId(null);
    }
  }

  async function handleDeleteSubscription(subscription: MonitoringTargetSubscription) {
    if (subscriptionActionPendingId) return;
    setSubscriptionActionPendingId(subscription.id);
    setTargetActionError("");
    try {
      await deleteMonitoringTargetSubscription(subscription.id);
      setTargetSubscriptionsById((current) => ({
        ...current,
        [subscription.target_id]: (current[subscription.target_id] || []).filter((item) => item.id !== subscription.id),
      }));
    } catch (e) {
      setTargetActionError(e instanceof Error ? e.message : "Не удалось удалить подписку.");
    } finally {
      setSubscriptionActionPendingId(null);
    }
  }

  async function handleToggleMonitoringTarget(target: MonitoringTarget) {
    if (targetActionPendingId) return;
    setTargetActionPendingId(target.id);
    setTargetActionError("");
    try {
      const updated = await updateMonitoringTarget(target.id, { is_active: !target.is_active });
      setMonitoringTargets((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
    } catch (e) {
      setTargetActionError(e instanceof Error ? e.message : "Не удалось обновить цель мониторинга.");
    } finally {
      setTargetActionPendingId(null);
    }
  }

  function startRenameMonitoringTarget(target: MonitoringTarget) {
    setTargetRenameId(target.id);
    setTargetRenameValue(target.name);
    setTargetActionError("");
  }

  async function handleRenameMonitoringTarget(target: MonitoringTarget) {
    const name = targetRenameValue.trim();
    if (!name || targetActionPendingId) return;
    setTargetActionPendingId(target.id);
    setTargetActionError("");
    try {
      const updated = await updateMonitoringTarget(target.id, { name });
      setMonitoringTargets((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      setTargetRenameId(null);
      setTargetRenameValue("");
    } catch (e) {
      setTargetActionError(e instanceof Error ? e.message : "Не удалось переименовать цель мониторинга.");
    } finally {
      setTargetActionPendingId(null);
    }
  }

  async function handleDeleteMonitoringTarget() {
    if (!targetDeleteConfirm || targetActionPendingId) return;
    const targetId = targetDeleteConfirm.id;
    setTargetActionPendingId(targetId);
    setTargetActionError("");
    try {
      await deleteMonitoringTarget(targetId);
      setMonitoringTargets((current) => current.filter((item) => item.id !== targetId));
      setTargetChecksById((current) => {
        const next = { ...current };
        delete next[targetId];
        return next;
      });
      setTargetChecksErrorById((current) => {
        const next = { ...current };
        delete next[targetId];
        return next;
      });
      setTargetDeleteConfirm(null);
      if (targetRenameId === targetId) {
        setTargetRenameId(null);
        setTargetRenameValue("");
      }
    } catch (e) {
      setTargetActionError(e instanceof Error ? e.message : "Не удалось удалить цель мониторинга.");
    } finally {
      setTargetActionPendingId(null);
    }
  }

  async function handleDeleteProject() {
    if (!project || deletePending) return;
    setDeletePending(true);
    setError("");
    try {
      await apiDelete(`/projects/${project.id}`);
      invalidateProjectsCache();
      navigate("/", { replace: true });
    } catch (e) {
      setError(String(e));
    } finally {
      setDeletePending(false);
      setDeleteConfirmOpen(false);
    }
  }

  const selectedSite = sites.find((site) => site.id === selectedSiteId) || null;
  const selectedSiteMonitoringTargets = useMemo(
    () => monitoringTargets.filter((target) => selectedSiteId === null || target.project_site_id === selectedSiteId),
    [monitoringTargets, selectedSiteId],
  );
  const selectedRunPersona =
    sitePersonas.find((persona) => persona.id === selectedRunPersonaId) ||
    selectedSite?.default_persona ||
    null;
  const selectedViewPersona =
    selectedViewPersonaId === "all"
      ? null
      : sitePersonas.find((persona) => persona.id === selectedViewPersonaId) || null;
  const domains = useMemo(
    () => parseDomains(selectedSite?.allowed_domains_csv || ""),
    [selectedSite?.allowed_domains_csv],
  );
  const hasDomainFilter = selectedDomains.length > 0;
  const activeDomainCount = hasDomainFilter ? selectedDomains.length : domains.length;
  const filteredDomainOptions = useMemo(() => {
    const q = domainPickerSearch.trim().toLowerCase();
    if (!q) return domains;
    return domains.filter((domain) => domain.toLowerCase().includes(q));
  }, [domainPickerSearch, domains]);
  const enabledPersonas = useMemo(
    () => sitePersonas.filter((persona) => persona.is_enabled !== false),
    [sitePersonas],
  );
  const lastRun = runs[0] || null;
  const completedRunsWithPages = useMemo(
    () => runs.filter((run) => run.id > 0 && run.status !== "RUNNING" && run.pages_total > 0),
    [runs],
  );
  const structureMultiContextEnabled = selectedViewPersonaId === "all" && enabledPersonas.length > 1;
  const structureViewLabel = selectedViewPersona
    ? selectedViewPersona.label
    : enabledPersonas.length === 1
      ? enabledPersonas[0].label
      : "все контексты";
  const structureRun = completedRunsWithPages[0] || null;
  const previousStructureRun = completedRunsWithPages[1] || null;
  const multiContextRunPairs = useMemo(() => {
    if (!structureMultiContextEnabled) return [];
    const groups = new Map<number, ProjectRun[]>();
    for (const run of completedRunsWithPages) {
      const personaId = run.crawl_persona_id || run.persona?.id || 0;
      const current = groups.get(personaId) || [];
      current.push(run);
      groups.set(personaId, current);
    }
    return enabledPersonas
      .map((persona) => {
        const personaRuns = groups.get(persona.id || 0) || [];
        const run = personaRuns[0] || null;
        if (!run) return null;
        return {
          personaId: persona.id || null,
          personaLabel: persona.label,
          run,
          previousRun: personaRuns[1] || null,
        };
      })
      .filter(Boolean) as Array<{ personaId: number | null; personaLabel: string; run: ProjectRun; previousRun: ProjectRun | null }>;
  }, [completedRunsWithPages, enabledPersonas, structureMultiContextEnabled]);
  const liveStructureRun = runs.find((run) => run.id > 0 && run.status === "RUNNING") || null;
  const displayedStructureRun = liveStructureRun || structureRun;
  const structureIsLive = liveStructureRun !== null;
  const hasRunning = runs.some((r) => r.status === "RUNNING");
  const selectedPendingJob = selectedSiteId !== null ? pendingCrawlerJobs[selectedSiteId] || null : null;
  const selectedPendingRetryText = selectedPendingJob ? pendingJobRetryText(selectedPendingJob) : null;
  const pendingJobsCount = Object.keys(pendingCrawlerJobs).length;
  const projectHasMultipleSites = sites.length > 1;
  const scheduleEnabledSites = useMemo(() => sites.filter((site) => site.is_enabled), [sites]);
  const scheduleDisabledSitesCount = sites.length - scheduleEnabledSites.length;
  const readinessIssues = crawlerReadiness?.issues || [];
  const showCrawlerReadinessPanel = canViewOperations && crawlerReadiness && (!crawlerReadiness.ready || readinessIssues.length > 0);
  const selectedRunLaunchIssue = personaLaunchIssue(selectedRunPersona);
  const structureUpdatePending = hasRunning || Boolean(selectedPendingJob) || runPending || projectRunPending;
  const structureRunId = displayedStructureRun?.id ?? null;
  const previousStructureRunId = structureIsLive
    ? structureRun?.id ?? null
    : previousStructureRun?.id ?? null;
  useEffect(() => {
    if (selectedSiteId === null) return;
    let cancelled = false;
    apiGet<ActiveSiteJobResponse>(`/runs/active-job/by-site/${selectedSiteId}`)
      .then((payload) => {
        if (cancelled) return;
        if (payload.active && payload.job?.status === "QUEUED") {
          const job = payload.job;
          setPendingCrawlerJobs((current) => ({
            ...current,
            [selectedSiteId]: {
              jobId: job.id,
              siteId: selectedSiteId,
              siteName: job.site?.name || selectedSite?.name || "Сайт",
              status: job.status,
              personaLabel: job.persona?.label || selectedSite?.default_persona?.label || "Гость",
              queuedAt: job.scheduled_at,
              scheduledAt: job.scheduled_at,
              attempts: job.attempts,
              maxAttempts: job.max_attempts,
              failureCode: job.failure_code,
              failureMessage: job.failure_message,
              source: "site",
            },
          }));
          if (canViewOperations) void apiGet<CrawlerReadiness>("/crawler/readiness").then(setCrawlerReadiness).catch(() => undefined);
          return;
        }
        setPendingCrawlerJobs((current) => {
          if (!current[selectedSiteId]) return current;
          const next = { ...current };
          delete next[selectedSiteId];
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedSiteId, selectedSite?.name, selectedSite?.default_persona?.label, canViewOperations]);

  useEffect(() => {
    setSelectedDomains((current) => current.filter((domain) => domains.includes(domain)));
    setDomainPickerSearch("");
  }, [domains]);

  useEffect(() => {
    if (activeTab !== "main") return;
    if (structureMultiContextEnabled) {
      setLastRunPages([]);
      setPrevRunPages([]);
      if (multiContextRunPairs.length === 0) {
        setMultiContextStructureSets([]);
        setPagesLoading(false);
        return;
      }
      let cancelled = false;
      async function loadMultiContextPages(silent = false) {
        if (!silent) setPagesLoading(true);
        if (!silent) setPagesError("");
        try {
          const nextSets = await Promise.all(
            multiContextRunPairs.map(async (item) => {
              const [pages, previousPages] = await Promise.all([
                fetchRunPages(item.run.id),
                item.previousRun ? fetchRunPages(item.previousRun.id) : Promise.resolve([] as ProjectPage[]),
              ]);
              return {
                personaId: item.personaId,
                personaLabel: item.personaLabel,
                run: item.run,
                previousRun: item.previousRun,
                pages,
                previousPages,
              };
            }),
          );
          if (cancelled) return;
          setMultiContextStructureSets(nextSets);
        } catch (e) {
          if (cancelled) return;
          setPagesError(String(e));
        } finally {
          if (!cancelled && !silent) setPagesLoading(false);
        }
      }
      void loadMultiContextPages();
      return () => {
        cancelled = true;
      };
    }
    setMultiContextStructureSets([]);
    if (structureRunId === null) {
      setLastRunPages([]);
      setPrevRunPages([]);
      return;
    }
    let cancelled = false;
    async function loadPages(silent = false) {
      if (!silent) setPagesLoading(true);
      if (!silent) setPagesError("");
      try {
        const [lastRows, prevRows] = await Promise.all([
          fetchRunPages(structureRunId),
          previousStructureRunId !== null
            ? fetchRunPages(previousStructureRunId)
            : Promise.resolve([] as ProjectPage[]),
        ]);
        if (cancelled) return;
        setLastRunPages(lastRows);
        setPrevRunPages(prevRows);
      } catch (e) {
        if (cancelled) return;
        setPagesError(String(e));
      } finally {
        if (!cancelled && !silent) setPagesLoading(false);
      }
    }
    void loadPages();
    const timer = structureIsLive
      ? window.setInterval(() => {
          void loadPages(true);
        }, 1200)
      : null;
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [activeTab, structureRunId, previousStructureRunId, structureIsLive, structureMultiContextEnabled, multiContextRunPairs]);

  useEffect(() => {
    setStructureRetryResultByUrl({});
    setStructureRetryNotice("");
    setStructureRetryNoticeTone("success");
    setBulkRetryResult(null);
    setBulkRetryError("");
  }, [selectedSiteId, structureRunId]);

  const structureRows = useMemo<StructureRow[]>(() => {
    return buildStructureRowsFromPages({
      currentPages: lastRunPages,
      previousPages: prevRunPages,
      selectedDomains,
      includeDeleted: !structureIsLive,
    });
  }, [lastRunPages, prevRunPages, selectedDomains, structureIsLive]);

  const structureRowsFiltered = useMemo(() => {
    return filterStructureRows(structureRows, structureViewFilter, structureSearch);
  }, [structureRows, structureSearch, structureViewFilter]);
  const structureStatusCounts = useMemo(
    () => structureCounts(structureRows),
    [structureRows],
  );
  const multiContextStructureSections = useMemo(
    () => multiContextStructureSets.map((set) => {
      const rows = buildStructureRowsFromPages({
        currentPages: set.pages,
        previousPages: set.previousPages,
        selectedDomains,
        includeDeleted: true,
      });
      return {
        ...set,
        rows,
        filteredRows: filterStructureRows(rows, structureViewFilter, structureSearch),
        counts: structureCounts(rows),
      };
    }),
    [multiContextStructureSets, selectedDomains, structureSearch, structureViewFilter],
  );
  const multiContextStructureRowsTotal = useMemo(
    () => multiContextStructureSections.reduce((total, section) => total + section.rows.length, 0),
    [multiContextStructureSections],
  );
  const multiContextStructureCounts = useMemo(
    () => multiContextStructureSections.reduce(
      (total, section) => ({
        added: total.added + section.counts.added,
        error: total.error + section.counts.error,
        changed: total.changed + section.counts.changed,
      }),
      { added: 0, error: 0, changed: 0 },
    ),
    [multiContextStructureSections],
  );
  useEffect(() => {
    if (!structureMultiContextEnabled || multiContextStructureSections.length === 0) {
      setActiveMultiContextStructureRunId(null);
      return;
    }
    setActiveMultiContextStructureRunId((current) => (
      current !== null && multiContextStructureSections.some((section) => section.run.id === current)
        ? current
        : multiContextStructureSections[0].run.id
    ));
  }, [multiContextStructureSections, structureMultiContextEnabled]);
  const activeMultiContextStructureSection = useMemo(
    () => multiContextStructureSections.find((section) => section.run.id === activeMultiContextStructureRunId)
      || multiContextStructureSections[0]
      || null,
    [activeMultiContextStructureRunId, multiContextStructureSections],
  );
  const problemPagesCount = useMemo(
    () => lastRunPages.filter(
      (row) => Boolean(row.fetch_error_code) || (row.final_status_code || row.status_code) >= 400,
    ).length,
    [lastRunPages],
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {loading && <div>Загрузка...</div>}
      {error && <StatusText tone="danger">{error}</StatusText>}

      {!loading && !error && project && (
        <>
          <Card>
            <div style={{ display: "grid", gap: 10 }}>
              <SectionHeaderRow
                style={{ alignItems: "flex-start" }}
                title={
                  <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <ProjectRunBadge status={selectedPendingJob ? "QUEUED" : lastRun?.status} />
                    <div
                      title={project.name}
                      style={{
                        fontWeight: 800,
                        fontSize: 22,
                        lineHeight: 1.15,
                        maxWidth: "min(58vw, 760px)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {project.name}
                    </div>
                  </div>
                }
                actions={canRunCrawler ? (
                  <div style={{ display: "grid", gap: 8, justifyItems: "end", minWidth: 260 }}>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                        justifyContent: "flex-end",
                        flexWrap: "wrap",
                        maxWidth: 520,
                      }}
                      title="Контекст определяет, как crawler открывает выбранный сайт: гостем или с подключённой сессией роли."
                    >
                      <MetaText opacity={0.72}>Запуск:</MetaText>
                      {sitePersonasLoading && <AccentPill tone="neutral">Загрузка...</AccentPill>}
                      {!sitePersonasLoading && enabledPersonas.length === 0 && (
                        <AccentPill tone="info">{selectedSite?.default_persona?.label || "Гость"}</AccentPill>
                      )}
                      {!sitePersonasLoading && enabledPersonas.map((persona) => (
                        <CardActionButton
                          key={persona.id}
                          compact
                          active={selectedRunPersonaId === persona.id}
                          disabled={runPending || projectRunPending || hasRunning || Boolean(selectedPendingJob) || !selectedSite?.is_enabled}
                          onClick={() => setSelectedRunPersonaId(persona.id)}
                          title={personaOptionSuffix(persona).trim() || undefined}
                        >
                          {persona.label}
                        </CardActionButton>
                      ))}
                      {selectedRunPersona && selectedRunLaunchIssue && (
                        <StatusText tone="warning" style={{ fontSize: 12 }}>
                          {selectedRunLaunchIssue}
                        </StatusText>
                      )}
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: projectHasMultipleSites ? "repeat(3, minmax(150px, 1fr))" : "repeat(2, minmax(165px, 1fr))",
                        gap: 8,
                        width: "100%",
                        maxWidth: projectHasMultipleSites ? 560 : 400,
                      }}
                    >
                      <CardActionButton
                        variant="ghost"
                        onClick={() => navigate(`/projects/${project.id}/compare`, { state: { projectName: project.name } })}
                        style={{ width: "100%" }}
                      >
                        Сравнить страницы
                      </CardActionButton>
                      {projectHasMultipleSites && (
                        <CardActionButton
                          variant="secondary"
                          onClick={() => void handleStartAllSites()}
                          disabled={projectRunPending || runPending || pendingJobsCount > 0 || sites.every((site) => !site.is_enabled)}
                          title={sites.every((site) => !site.is_enabled) ? "В проекте нет включённых сайтов." : undefined}
                          style={{ width: "100%" }}
                        >
                          {projectRunPending ? "Ставим в очередь..." : pendingJobsCount > 0 ? `В очереди: ${pendingJobsCount}` : "Запустить все сайты"}
                        </CardActionButton>
                      )}
                      <CardActionButton
                        variant="primary"
                        onClick={() => {
                          void handleStartRun();
                        }}
                        disabled={runPending || projectRunPending || hasRunning || Boolean(selectedPendingJob) || !selectedSite?.is_enabled || Boolean(selectedRunLaunchIssue)}
                        title={
                          !selectedSite?.is_enabled
                            ? "Включите выбранный сайт в настройках."
                            : selectedRunLaunchIssue
                              ? selectedRunLaunchIssue
                            : selectedPendingJob ? "Выбранный сайт уже ожидает worker."
                            : hasRunning ? "Выбранный сайт уже сканируется." : undefined
                        }
                        style={{ width: "100%" }}
                      >
                        {runPending ? "Ставим в очередь..." : selectedPendingJob ? "Ожидает worker" : hasRunning ? "Прогон выполняется" : "Запустить выбранный сайт"}
                      </CardActionButton>
                    </div>
                  </div>
                ) : undefined}
              />
              {showCrawlerReadinessPanel && (
                <Card
                  variant={crawlerReadiness.ready ? "hint" : "warning"}
                  style={{ padding: 10, display: "grid", gap: 8 }}
                >
                  <ProjectPersistentDetails
                    storageKey="admin-readiness"
                    summary={
                      <>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <AccentPill tone={crawlerReadiness.ready ? "success" : "warning"}>
                            Crawler: {crawlerReadinessLabel(crawlerReadiness)}
                          </AccentPill>
                          <AccentPill tone={crawlerReadiness.mode === "worker" ? "info" : "neutral"}>
                            Режим: {crawlerModeLabel(crawlerReadiness.mode)}
                          </AccentPill>
                          <MetaText opacity={0.82}>
                            Очередь: <strong>{crawlerReadiness.jobs?.queued ?? 0}</strong> · В работе: <strong>{crawlerReadiness.jobs?.running ?? 0}</strong>
                          </MetaText>
                        </div>
                        <MetaText opacity={0.72}>Операционная панель admin/root-admin · раскрыть детали</MetaText>
                      </>
                    }
                    summaryStyle={{
                        cursor: "pointer",
                        listStyle: "none",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                    }}
                  >
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        <MetaText opacity={0.86}>Очередь: <strong>{crawlerReadiness.jobs?.queued ?? 0}</strong></MetaText>
                        <MetaText opacity={0.86}>В работе: <strong>{crawlerReadiness.jobs?.running ?? 0}</strong></MetaText>
                        {(crawlerReadiness.jobs?.cancel_requested ?? 0) > 0 && (
                          <MetaText opacity={0.86}>Остановка: <strong>{crawlerReadiness.jobs?.cancel_requested}</strong></MetaText>
                        )}
                        {crawlerReadiness.jobs?.diagnostics?.oldest_queued_age_seconds != null && (
                          <MetaText opacity={0.86}>
                            Старейшая задача ждёт: <strong>{formatSecondsCompact(crawlerReadiness.jobs.diagnostics.oldest_queued_age_seconds)}</strong>
                          </MetaText>
                        )}
                        {(crawlerReadiness.jobs?.recovered_expired_jobs ?? 0) > 0 && (
                          <MetaText opacity={0.86}>
                            Восстановлено зависших: <strong>{crawlerReadiness.jobs?.recovered_expired_jobs}</strong>
                          </MetaText>
                        )}
                      </div>
                      {readinessIssues.length > 0 && (
                        <div style={{ display: "grid", gap: 4 }}>
                          {readinessIssues.slice(0, 2).map((issue) => (
                            <StatusText
                              key={`${issue.code}-${issue.message}`}
                              tone={issue.severity === "critical" ? "danger" : "warning"}
                              style={{ fontSize: 12 }}
                            >
                              {issue.message}{issue.count ? ` · ${issue.count}` : ""}
                            </StatusText>
                          ))}
                          {readinessIssues.length > 2 && (
                            <MetaText opacity={0.72}>Ещё предупреждений: {readinessIssues.length - 2}</MetaText>
                          )}
                        </div>
                      )}
                    </div>
                  </ProjectPersistentDetails>
                </Card>
              )}
              {activeTab !== "settings" && canViewOperations && (notificationDiagnostics || notificationDiagnosticsLoading || notificationDiagnosticsError) && (
                <Card
                  variant={notificationDiagnostics && notificationDiagnosticsTone(notificationDiagnostics) === "danger" ? "warning" : "hint"}
                  style={{ padding: 10, display: "grid", gap: 8 }}
                >
                  <ProjectPersistentDetails
                    storageKey="admin-notification-delivery"
                    summary={
                      <>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <AccentPill tone={notificationDiagnostics ? notificationDiagnosticsTone(notificationDiagnostics) : "neutral"}>
                            Уведомления: {notificationDiagnostics ? notificationDiagnosticsLabel(notificationDiagnostics) : "Загрузка"}
                          </AccentPill>
                          {notificationDiagnostics && (
                            <>
                              <AccentPill tone={notificationDiagnostics.smtp_configured ? "success" : "warning"}>
                                Email {notificationDiagnostics.smtp_configured ? "готов" : "не настроен"}
                              </AccentPill>
                              <AccentPill tone={notificationDiagnostics.telegram_configured ? "success" : "warning"}>
                                Telegram {notificationDiagnostics.telegram_configured ? "готов" : "не настроен"}
                              </AccentPill>
                              <MetaText opacity={0.82}>
                                Очередь: <strong>{notificationDiagnostics.counts.queued}</strong> · Повтор:{" "}
                                <strong>{notificationDiagnostics.counts.retry_ready + notificationDiagnostics.counts.failed_waiting}</strong>
                              </MetaText>
                            </>
                          )}
                        </div>
                        <MetaText opacity={0.72}>Доставка уведомлений</MetaText>
                      </>
                    }
                    summaryStyle={{
                      cursor: "pointer",
                      listStyle: "none",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      {notificationDiagnosticsLoading && <MetaText>Загружаем доставку...</MetaText>}
                      {notificationDiagnosticsError && (
                        <StatusText tone="warning" style={{ fontSize: 12 }}>
                          {notificationDiagnosticsError}
                        </StatusText>
                      )}
                      {notificationDiagnostics && (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                            {[
                              { label: "В очереди", value: notificationDiagnostics.counts.queued, tone: "info" as const },
                              { label: "Готовы к повтору", value: notificationDiagnostics.counts.retry_ready, tone: "warning" as const },
                              { label: "Ждут паузу", value: notificationDiagnostics.counts.failed_waiting, tone: "warning" as const },
                              { label: "Отправлены", value: notificationDiagnostics.counts.sent, tone: "success" as const },
                              { label: "Остановлены", value: notificationDiagnostics.counts.dead, tone: "danger" as const },
                            ].map((item) => (
                              <Card key={item.label} style={{ padding: 10, background: "rgba(255,255,255,0.025)" }}>
                                <MetaText opacity={0.68}>{item.label}</MetaText>
                                <div style={{ marginTop: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                  <strong style={{ fontSize: 22 }}>{item.value}</strong>
                                  <AccentPill tone={item.tone}>{item.value > 0 ? "Есть" : "0"}</AccentPill>
                                </div>
                              </Card>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </ProjectPersistentDetails>
                </Card>
              )}
              {activeTab !== "settings" && selectedPendingJob && (
                <Card variant="hint" style={{ padding: 10, display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <StatusText tone="muted">Сайт ожидает worker</StatusText>
                    <MetaText opacity={0.72}>Job #{selectedPendingJob.jobId} · {formatTimeAgo(selectedPendingJob.queuedAt)}</MetaText>
                  </div>
                  <MetaText opacity={0.82}>
                    Задача поставлена в очередь как «{selectedPendingJob.personaLabel}». Когда worker возьмёт её в работу, здесь появится live-структура и текущий URL.
                  </MetaText>
                  {selectedPendingRetryText && (
                    <StatusText tone="warning" style={{ fontSize: 12 }}>
                      {selectedPendingRetryText}
                    </StatusText>
                  )}
                </Card>
              )}
              {activeTab !== "settings" && runsError && (
                <StatusText tone="danger" style={{ fontSize: 13 }}>
                  {runsError}
                </StatusText>
              )}
              {activeTab !== "settings" && hasRunning && (
                <MetaText opacity={0.72}>
                  Сейчас сканируется выбранный сайт.
                </MetaText>
              )}
            </div>
          </Card>

          <Card variant="hint" style={{ padding: 10 }}>
            <SegmentedControl
              value={activeTab}
              onChange={(next) => setActiveTab(next)}
              options={[
                { value: "main", label: "Основная" },
                { value: "history", label: "История" },
                ...(canEditProject ? [{ value: "settings" as const, label: "Настройки" }] : []),
              ]}
            />
          </Card>

          {activeTab !== "settings" && (
            <Card>
              <div style={{ display: "grid", gap: 10 }}>
                <SectionHeaderRow
                  title={
                    <div>
                      <div style={{ fontWeight: 700 }}>Сайты проекта</div>
                      <MetaText opacity={0.68}>Карточка задаёт рабочий контекст страницы.</MetaText>
                    </div>
                  }
                  actions={<MetaText opacity={0.68}>{sites.length} сайт(а)</MetaText>}
                />
                {sitesLoading && <MetaText>Загрузка сайтов...</MetaText>}
                {!sitesLoading && sites.length === 0 && (
                  <StatusText tone="warning">В проекте пока нет доступных сайтов.</StatusText>
                )}
                {!sitesLoading && sites.length > 0 && (
                  <ProjectSiteContextCards
                    sites={sites}
                    selectedSiteId={selectedSiteId}
                    onSelect={(siteId) => {
                      if (siteId === selectedSiteId) return;
                      setSelectedSiteId(siteId);
                      setRunsError("");
                      setPagesError("");
                      setStructureSearch("");
                      setStructureViewFilter("all");
                      setPageContextOpen(false);
                      setDirectoryContext(null);
                    }}
                  />
                )}
                {projectRunResult && (
                  <Card
                    variant={projectRunResult.failed > 0 || projectRunResult.skipped > 0 ? "warning" : "hint"}
                    style={{ display: "grid", gap: 6 }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      {projectRunResult.results.some((row) => row.status === "QUEUED") ? "Общий запуск поставлен в очередь" : "Общий запуск завершён"}
                    </div>
                    <MetaText>
                      В очереди: {projectRunResult.results.filter((row) => row.status === "QUEUED").length} · успешно: {projectRunResult.finished} · с ошибкой: {projectRunResult.failed} · пропущено: {projectRunResult.skipped}
                    </MetaText>
                    <div style={{ display: "grid", gap: 6 }}>
                      {projectRunResult.results.map((result) => {
                        const tone = result.status === "FAILED" ? "danger" : result.status === "SKIPPED" ? "warning" : result.status === "QUEUED" ? "muted" : "success";
                        const personaLabel = result.persona_label || result.persona?.label || "Гость";
                        const sessionText = result.session_message || (
                          result.session_status === "not_required"
                            ? "Сессия не нужна."
                            : result.session_status === "connected"
                              ? "Сессия подключена."
                              : result.session_status ? `Сессия: ${result.session_status}.` : ""
                        );
                        return (
                          <Card key={result.project_site_id} variant={tone === "success" ? "default" : "warning"} style={{ padding: 10, display: "grid", gap: 3 }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              <StatusText tone={tone} style={{ fontSize: 12 }}>
                                {result.status === "FINISHED"
                                  ? "Запущен и завершён"
                                  : result.status === "QUEUED"
                                    ? "В очереди worker"
                                    : result.status === "SKIPPED" ? "Пропущен" : "Ошибка"}
                              </StatusText>
                              <span style={{ fontWeight: 700 }}>{result.site_name}</span>
                              {result.job_id && <MetaText opacity={0.78}>Job #{result.job_id}</MetaText>}
                              <MetaText opacity={0.78}>Контекст: {personaLabel}</MetaText>
                              {result.status === "FINISHED" && <RunRuntimePill runtime={result.crawl_runtime} />}
                            </div>
                            {sessionText && <MetaText opacity={0.72}>{sessionText}</MetaText>}
                            {result.status === "QUEUED" && (
                              <MetaText opacity={0.78}>Worker заберёт задачу автоматически. Прогресс выбранного сайта появится в live-блоке.</MetaText>
                            )}
                            {result.status !== "FINISHED" && result.status !== "QUEUED" && (
                              <MetaText opacity={0.78}>{result.failure_message || result.failure_code || result.status}</MetaText>
                            )}
                          </Card>
                        );
                      })}
                    </div>
                  </Card>
                )}
              </div>
            </Card>
          )}

          {activeTab === "main" && (
            <>
              <Card>
                <ProjectPersistentDetails
                  storageKey="monitoring-targets"
                  defaultOpen={selectedSiteMonitoringTargets.length > 0}
                  summary={
                    <SectionHeaderRow
                      title={<div style={{ fontWeight: 700 }}>Цели мониторинга</div>}
                      actions={<ListTotalMeta label="Целей" total={selectedSiteMonitoringTargets.length} />}
                      style={{ width: "100%" }}
                    />
                  }
                  summaryStyle={{
                    cursor: "pointer",
                    listStyle: "none",
                  }}
                >
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  {monitoringTargetsLoading && <MetaText>Загружаем цели...</MetaText>}
                  {monitoringTargetsError && <StatusText tone="danger">{monitoringTargetsError}</StatusText>}
                  {targetActionError && <StatusText tone="danger">{targetActionError}</StatusText>}
                  {!monitoringTargetsLoading && !monitoringTargetsError && selectedSiteMonitoringTargets.length === 0 && (
                    <Card variant="hint" style={{ padding: 10 }}>
                      <MetaText>Целей пока нет.</MetaText>
                    </Card>
                  )}
                  {selectedSiteMonitoringTargets.length > 0 && (
                    <div style={{ display: "grid", gap: 8 }}>
                      {selectedSiteMonitoringTargets.map((target) => {
                        const latestCheck = target.latest_check || null;
                        const statusMeta = monitoringTargetStatusMeta(latestCheck?.status);
                        const history = targetChecksById[target.id] || [];
                        const targetPending = targetActionPendingId === target.id;
                        return (
                          <Card key={target.id} style={{ padding: 10, display: "grid", gap: 8 }}>
                            <SectionHeaderRow
                              title={
                                <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                    <span style={{ fontWeight: 800, wordBreak: "break-word" }}>{target.name}</span>
                                    <AccentPill tone={statusMeta.tone}>{statusMeta.label}</AccentPill>
                                  </div>
                                  <MetaText opacity={0.72} style={{ wordBreak: "break-word" }}>
                                    {shortUrlPath(target.page_url)}
                                  </MetaText>
                                </div>
                              }
                              actions={
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                  <AccentPill tone="neutral">{target.tag}</AccentPill>
                                  {target.is_active ? (
                                    <AccentPill tone="success">Активна</AccentPill>
                                  ) : (
                                    <AccentPill tone="neutral">Выключена</AccentPill>
                                  )}
                                </div>
                              }
                              style={{ alignItems: "flex-start", gap: 8 }}
                            />
                            {targetRenameId === target.id && (
                              <Card variant="hint" style={{ padding: 8, display: "grid", gap: 8 }}>
                                <input
                                  value={targetRenameValue}
                                  onChange={(event) => setTargetRenameValue(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") void handleRenameMonitoringTarget(target);
                                    if (event.key === "Escape") {
                                      setTargetRenameId(null);
                                      setTargetRenameValue("");
                                    }
                                  }}
                                  autoFocus
                                  style={{
                                    borderRadius: 10,
                                    border: "1px solid rgba(255,255,255,0.24)",
                                    background: "rgba(255,255,255,0.06)",
                                    color: "inherit",
                                    padding: "8px 10px",
                                  }}
                                />
                                <CardFooterActions>
                                  <CardActionButton
                                    compact
                                    variant="primary"
                                    disabled={targetPending || !targetRenameValue.trim()}
                                    onClick={() => void handleRenameMonitoringTarget(target)}
                                  >
                                    {targetPending ? "Сохраняем..." : "Сохранить"}
                                  </CardActionButton>
                                  <CardActionButton
                                    compact
                                    disabled={targetPending}
                                    onClick={() => {
                                      setTargetRenameId(null);
                                      setTargetRenameValue("");
                                    }}
                                  >
                                    Отмена
                                  </CardActionButton>
                                </CardFooterActions>
                              </Card>
                            )}
                            <MetaText opacity={0.74}>{latestCheck?.message || statusMeta.text}</MetaText>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              <AccentPill tone="info">
                                Контекст: {sitePersonas.find((persona) => persona.id === target.crawl_persona_id)?.label || "Гость"}
                              </AccentPill>
                              {latestCheck?.checked_at && (
                                <AccentPill tone="neutral">Проверено: {formatOperationalDateTime(latestCheck.checked_at)}</AccentPill>
                              )}
                              {latestCheck?.run_id && <AccentPill tone="neutral">run #{latestCheck.run_id}</AccentPill>}
                            </div>
                            {canEditProject && (
                              <CardFooterActions>
                                <CardActionButton
                                  compact
                                  disabled={targetPending}
                                  onClick={() => startRenameMonitoringTarget(target)}
                                >
                                  Переименовать
                                </CardActionButton>
                                <CardActionButton
                                  compact
                                  variant={target.is_active ? "secondary" : "primary"}
                                  disabled={targetPending}
                                  onClick={() => void handleToggleMonitoringTarget(target)}
                                >
                                  {targetPending ? "Обновляем..." : target.is_active ? "Пауза" : "Включить"}
                                </CardActionButton>
                                <CardActionButton
                                  compact
                                  variant="danger"
                                  disabled={targetPending}
                                  onClick={() => setTargetDeleteConfirm(target)}
                                >
                                  Удалить
                                </CardActionButton>
                              </CardFooterActions>
                            )}
                            <ProjectPersistentDetails
                              storageKey={`target-${target.id}`}
                              summary="Детали цели"
                              summaryStyle={{ cursor: "pointer", color: "var(--muted)", fontSize: 13 }}
                            >
                              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                                <MetaText opacity={0.68} style={{ wordBreak: "break-word" }}>
                                  Selector: {target.selector}
                                </MetaText>
                                <details
                                  className="project-persistent-details"
                                  onToggle={(event) => {
                                    if (event.currentTarget.open) void loadTargetChecks(target.id);
                                  }}
                                >
                                  <summary className="project-persistent-summary" style={{ cursor: "pointer", color: "var(--muted)", fontSize: 13 }}>
                                    История проверок
                                  </summary>
                                  <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                                    {targetChecksLoadingId === target.id && <MetaText>Загружаем историю...</MetaText>}
                                    {targetChecksErrorById[target.id] && (
                                      <StatusText tone="danger">{targetChecksErrorById[target.id]}</StatusText>
                                    )}
                                    {!targetChecksLoadingId && !targetChecksErrorById[target.id] && history.length === 0 && (
                                      <MetaText opacity={0.72}>
                                        Истории пока нет. После следующего успешного прогона здесь появится результат проверки.
                                      </MetaText>
                                    )}
                                    {history.map((check) => {
                                      const checkMeta = monitoringTargetStatusMeta(check.status);
                                      return (
                                        <Card key={check.id} style={{ padding: 8, display: "grid", gap: 4 }}>
                                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                            <AccentPill tone={checkMeta.tone}>{checkMeta.label}</AccentPill>
                                            <AccentPill tone="neutral">run #{check.run_id}</AccentPill>
                                            {check.checked_at && (
                                              <MetaText opacity={0.68}>{formatOperationalDateTime(check.checked_at)}</MetaText>
                                            )}
                                          </div>
                                          <MetaText opacity={0.76}>{check.message || checkMeta.text}</MetaText>
                                        </Card>
                                      );
                                    })}
                                  </div>
                                </details>
                                <details
                                  className="project-persistent-details"
                                  onToggle={(event) => {
                                    if (event.currentTarget.open) void loadTargetSubscriptions(target.id);
                                  }}
                                >
                                  <summary className="project-persistent-summary" style={{ cursor: "pointer", color: "var(--muted)", fontSize: 13 }}>
                                    Уведомления
                                  </summary>
                                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                                    {targetSubscriptionsLoadingId === target.id && <MetaText>Загружаем подписки...</MetaText>}
                                    {targetSubscriptionsErrorById[target.id] && (
                                      <StatusText tone="danger">{targetSubscriptionsErrorById[target.id]}</StatusText>
                                    )}
                                    {canEditProject && subscriptionFormTargetId !== target.id && (
                                      <CardActionButton compact onClick={() => startAddSubscription(target.id)}>
                                        + Добавить канал
                                      </CardActionButton>
                                    )}
                                    {canEditProject && subscriptionFormTargetId === target.id && (
                                      <Card variant="hint" style={{ padding: 8, display: "grid", gap: 8 }}>
                                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                          <MetaText opacity={0.72}>Канал:</MetaText>
                                          <CardActionButton
                                            compact
                                            active={subscriptionChannel === "email"}
                                            onClick={() => setSubscriptionChannel("email")}
                                          >
                                            Email
                                          </CardActionButton>
                                          <CardActionButton
                                            compact
                                            active={subscriptionChannel === "telegram_chat"}
                                            onClick={() => setSubscriptionChannel("telegram_chat")}
                                          >
                                            Telegram
                                          </CardActionButton>
                                        </div>
                                        <input
                                          value={subscriptionDestination}
                                          onChange={(event) => setSubscriptionDestination(event.target.value)}
                                          placeholder={subscriptionChannel === "email" ? "alerts@example.com" : "chat id или @username"}
                                          style={{
                                            borderRadius: 10,
                                            border: "1px solid rgba(255,255,255,0.24)",
                                            background: "rgba(255,255,255,0.06)",
                                            color: "inherit",
                                            padding: "8px 10px",
                                          }}
                                        />
                                        <div style={{ display: "grid", gap: 6 }}>
                                          <MetaText opacity={0.72}>Отправлять при статусах:</MetaText>
                                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                            {MONITORING_SUBSCRIPTION_STATUSES.map((option) => (
                                              <CardActionButton
                                                key={option.value}
                                                compact
                                                active={subscriptionStatuses.includes(option.value)}
                                                onClick={() => toggleSubscriptionStatus(option.value)}
                                              >
                                                {option.label}
                                              </CardActionButton>
                                            ))}
                                          </div>
                                        </div>
                                        <label style={{ display: "grid", gap: 4 }}>
                                          <MetaText opacity={0.72}>Не чаще, минут</MetaText>
                                          <input
                                            type="number"
                                            min={0}
                                            max={10080}
                                            value={subscriptionMinInterval}
                                            onChange={(event) => setSubscriptionMinInterval(event.target.value)}
                                            style={{
                                              borderRadius: 10,
                                              border: "1px solid rgba(255,255,255,0.24)",
                                              background: "rgba(255,255,255,0.06)",
                                              color: "inherit",
                                              padding: "8px 10px",
                                            }}
                                          />
                                        </label>
                                        <CardFooterActions>
                                          <CardActionButton
                                            compact
                                            variant="primary"
                                            disabled={subscriptionActionPendingId === `new-${target.id}` || !subscriptionDestination.trim()}
                                            onClick={() => void handleCreateSubscription(target)}
                                          >
                                            {subscriptionActionPendingId === `new-${target.id}` ? "Добавляем..." : "Добавить"}
                                          </CardActionButton>
                                          <CardActionButton compact onClick={() => setSubscriptionFormTargetId(null)}>
                                            Отмена
                                          </CardActionButton>
                                        </CardFooterActions>
                                      </Card>
                                    )}
                                    {(targetSubscriptionsById[target.id] || []).length === 0 && targetSubscriptionsLoadingId !== target.id && (
                                      <MetaText opacity={0.72}>
                                        Внешние уведомления не настроены. Внутренние события всё равно появляются в Event Center.
                                      </MetaText>
                                    )}
                                    {(targetSubscriptionsById[target.id] || []).map((subscription) => (
                                      <Card key={subscription.id} style={{ padding: 8, display: "grid", gap: 6 }}>
                                        {(() => {
                                          const preview = subscriptionPreviewById[subscription.id];
                                          const testResult = subscriptionTestResultById[subscription.id];
                                          return (
                                            <>
                                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                          <AccentPill tone={subscription.channel_type === "telegram_chat" ? "info" : "neutral"}>
                                            {monitoringChannelLabel(subscription.channel_type)}
                                          </AccentPill>
                                          <span style={{ fontWeight: 700, wordBreak: "break-word" }}>{subscription.destination}</span>
                                          <AccentPill tone={subscription.is_active ? "success" : "neutral"}>
                                            {subscription.is_active ? "Активна" : "Пауза"}
                                          </AccentPill>
                                        </div>
                                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                          {(subscription.statuses || []).map((status) => (
                                            <AccentPill key={status} tone={monitoringTargetStatusMeta(status).tone}>
                                              {monitoringTargetStatusMeta(status).label}
                                            </AccentPill>
                                          ))}
                                          {subscription.min_interval_minutes > 0 && (
                                            <AccentPill tone="neutral">не чаще {subscription.min_interval_minutes} мин</AccentPill>
                                          )}
                                        </div>
                                        {canEditProject && (
                                          <CardFooterActions>
                                            <CardActionButton
                                              compact
                                              disabled={subscriptionActionPendingId === `preview-${subscription.id}` || subscriptionActionPendingId === `test-${subscription.id}`}
                                              onClick={() => void handlePreviewSubscription(subscription)}
                                            >
                                              {subscriptionActionPendingId === `preview-${subscription.id}` ? "Готовим..." : "Предпросмотр"}
                                            </CardActionButton>
                                            <CardActionButton
                                              compact
                                              variant="primary"
                                              disabled={subscriptionActionPendingId === `test-${subscription.id}` || subscriptionActionPendingId === `preview-${subscription.id}`}
                                              onClick={() => void handleTestSendSubscription(subscription)}
                                            >
                                              {subscriptionActionPendingId === `test-${subscription.id}` ? "Отправляем..." : "Тест"}
                                            </CardActionButton>
                                            <CardActionButton
                                              compact
                                              disabled={subscriptionActionPendingId === subscription.id}
                                              onClick={() => void handleToggleSubscription(subscription)}
                                            >
                                              {subscription.is_active ? "Пауза" : "Включить"}
                                            </CardActionButton>
                                            <CardActionButton
                                              compact
                                              variant="danger"
                                              disabled={subscriptionActionPendingId === subscription.id}
                                              onClick={() => void handleDeleteSubscription(subscription)}
                                            >
                                              Удалить
                                            </CardActionButton>
                                          </CardFooterActions>
                                        )}
                                        {preview && (
                                          <Card variant="hint" style={{ padding: 8, display: "grid", gap: 4 }}>
                                            <MetaText opacity={0.7}>Предпросмотр сообщения</MetaText>
                                            <div style={{ fontWeight: 800 }}>{preview.subject}</div>
                                            <pre
                                              style={{
                                                margin: 0,
                                                whiteSpace: "pre-wrap",
                                                wordBreak: "break-word",
                                                fontFamily: "inherit",
                                                fontSize: 12,
                                                lineHeight: 1.45,
                                                color: "var(--muted)",
                                              }}
                                            >
                                              {preview.body}
                                            </pre>
                                          </Card>
                                        )}
                                        {testResult && (
                                          <StatusText
                                            tone={testResult.includes("отправлено") ? "success" : "warning"}
                                            style={{ fontSize: 12 }}
                                          >
                                            {testResult}
                                          </StatusText>
                                        )}
                                            </>
                                          );
                                        })()}
                                      </Card>
                                    ))}
                                    <div style={{ display: "grid", gap: 6 }}>
                                      <SectionHeaderRow
                                        title={<div style={{ fontWeight: 700 }}>Последние доставки</div>}
                                        actions={
                                          <CardActionButton compact onClick={() => void loadTargetSubscriptions(target.id, true)}>
                                            Обновить
                                          </CardActionButton>
                                        }
                                      />
                                      {targetOutboxLoadingId === target.id && <MetaText>Загружаем доставки...</MetaText>}
                                      {targetOutboxErrorById[target.id] && (
                                        <StatusText tone="danger">{targetOutboxErrorById[target.id]}</StatusText>
                                      )}
                                      {(targetOutboxById[target.id] || []).length === 0 && targetOutboxLoadingId !== target.id && (
                                        <MetaText opacity={0.72}>Доставок пока нет.</MetaText>
                                      )}
                                      {(targetOutboxById[target.id] || []).map((item) => {
                                        const deliveryMeta = deliveryStatusMeta(item.delivery_status);
                                        return (
                                          <Card key={item.id} style={{ padding: 8, display: "grid", gap: 4 }}>
                                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                              <AccentPill tone={deliveryMeta.tone}>{deliveryMeta.label}</AccentPill>
                                              <AccentPill tone="neutral">{monitoringChannelLabel(item.channel_type)}</AccentPill>
                                              <AccentPill tone={monitoringTargetStatusMeta(item.event_status).tone}>
                                                {monitoringTargetStatusMeta(item.event_status).label}
                                              </AccentPill>
                                              {item.created_at && <MetaText opacity={0.68}>{formatOperationalDateTime(item.created_at)}</MetaText>}
                                            </div>
                                            <MetaText opacity={0.72} style={{ wordBreak: "break-word" }}>
                                              {item.destination} · попыток: {item.attempts}/{item.max_attempts || "?"}
                                            </MetaText>
                                            {item.next_attempt_at && (
                                              <MetaText opacity={0.68}>
                                                Следующая попытка: {formatOperationalDateTime(item.next_attempt_at)}
                                              </MetaText>
                                            )}
                                            {item.last_error && (
                                              <StatusText tone="warning" style={{ fontSize: 12 }}>{item.last_error}</StatusText>
                                            )}
                                          </Card>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </details>
                              </div>
                            </ProjectPersistentDetails>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
                </ProjectPersistentDetails>
              </Card>
              <Card>
                <div style={{ display: "grid", gap: 10 }}>
                  <SectionHeaderRow
                    title={
                      <div>
                        <div style={{ fontWeight: 700 }}>Структура сайта</div>
                        <MetaText opacity={0.68}>
                          {structureIsLive
                            ? `Структура строится в реальном времени · ${formatRunTitle(liveStructureRun.started_at)}`
                            : structureUpdatePending && structureRun
                              ? `Показан последний готовый срез · ${formatRunTitle(structureRun.started_at)}`
                              : structureRun
                                ? `Готовый срез · ${formatRunTitle(structureRun.started_at)}`
                              : "Структура появится после первого успешного обхода"}
                        </MetaText>
                      </div>
                    }
                    actions={(
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {canRunCrawler && problemPagesCount > 0 && (
                          <CardActionButton
                            variant="secondary"
                            disabled={bulkRetryPending || structureUpdatePending}
                            title={
                              structureUpdatePending
                                ? "Повторная проверка станет доступна после завершения текущего прогона."
                                : `Повторно проверить проблемные страницы как «${structureRun?.persona?.label || "Гость"}» без изменения исходного результата.`
                            }
                            onClick={() => void handleRetryAllProblemPages()}
                          >
                            {bulkRetryPending ? "Проверяем..." : `Повторить проблемные как ${structureRun?.persona?.label || "Гость"} · ${problemPagesCount}`}
                          </CardActionButton>
                        )}
                      </div>
                    )}
                  />
                  <Card variant="default" style={{ padding: 10, display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <MetaText opacity={0.72}>Контекст:</MetaText>
                      <CardActionButton
                        compact
                        active={selectedViewPersonaId === "all"}
                        disabled={sitePersonasLoading}
                        onClick={() => setSelectedViewPersonaId("all")}
                      >
                        Все
                      </CardActionButton>
                      {enabledPersonas.map((persona) => (
                        <CardActionButton
                          key={persona.id}
                          compact
                          active={selectedViewPersonaId === persona.id}
                          disabled={sitePersonasLoading}
                          onClick={() => setSelectedViewPersonaId(persona.id)}
                          title={persona.kind !== "guest" && !persona.has_secrets ? "Сессия ещё не подключена." : undefined}
                        >
                          {persona.label}
                        </CardActionButton>
                      ))}
                    </div>
                    {domains.length > 1 && (
                      <ProjectPersistentDetails
                        storageKey="structure-domain-picker"
                        summary={
                          <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span>Домены</span>
                            <AccentPill tone={hasDomainFilter ? "info" : "neutral"}>
                              {hasDomainFilter ? `${activeDomainCount} из ${domains.length}` : `все · ${domains.length}`}
                            </AccentPill>
                          </span>
                        }
                        summaryStyle={{ cursor: "pointer", color: "var(--muted)", fontSize: 13 }}
                      >
                        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                          <ClearableInput
                            value={domainPickerSearch}
                            onChange={setDomainPickerSearch}
                            placeholder="Найти домен..."
                          />
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <CardActionButton
                              compact
                              active={!hasDomainFilter}
                              onClick={() => setSelectedDomains([])}
                            >
                              Все · {domains.length}
                            </CardActionButton>
                            {filteredDomainOptions.map((domain) => {
                              const active = !hasDomainFilter || selectedDomains.includes(domain);
                              return (
                                <CardActionButton
                                  key={domain}
                                  compact
                                  active={active}
                                  onClick={() => {
                                    setSelectedDomains((current) => {
                                      if (current.length === 0) {
                                        return domains.filter((item) => item !== domain);
                                      }
                                      if (current.includes(domain)) {
                                        const next = current.filter((item) => item !== domain);
                                        return next.length === domains.length ? [] : next;
                                      }
                                      const next = [...current, domain];
                                      return next.length === domains.length ? [] : next;
                                    });
                                  }}
                                >
                                  {domain}
                                </CardActionButton>
                              );
                            })}
                          </div>
                          {filteredDomainOptions.length === 0 && (
                            <MetaText opacity={0.68}>Совпадений по доменам не найдено.</MetaText>
                          )}
                        </div>
                      </ProjectPersistentDetails>
                    )}
                    <MetaText opacity={0.62}>
                      Показано: {structureViewLabel} · домены {hasDomainFilter ? activeDomainCount : "все"}.
                    </MetaText>
                  </Card>
                  {structureUpdatePending && (
                    <Card variant="hint" style={{ padding: 10, display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span
                            className="project-run-spinner"
                            aria-hidden="true"
                            style={{
                              width: 14,
                              height: 14,
                              borderRadius: "50%",
                              border: "2px solid currentColor",
                              borderTopColor: "transparent",
                              display: "inline-block",
                              flex: "0 0 auto",
                            }}
                          />
                          <StatusText tone="success">
                            {selectedPendingJob
                              ? "Задача ожидает свободный worker"
                              : projectRunPending
                                ? "Сайты проекта ставятся в очередь"
                                : "Идёт сканирование выбранного сайта"}
                          </StatusText>
                        </div>
                        <MetaText opacity={0.72}>Прошло: {runElapsedSeconds} сек.</MetaText>
                      </div>
                      <MetaText opacity={0.72}>
                        {structureIsLive
                          ? `Уже добавлено в текущий срез: ${lastRunPages.length}. Новые страницы появляются автоматически; дерево не прокручивается само и не сбивает ваше место.`
                          : structureRun
                            ? "Пока показываем последнюю готовую структуру. После завершения нужного прогона она обновится автоматически."
                            : "Собираем первый срез. Структура появится автоматически после завершения нужного прогона."}
                      </MetaText>
                      {liveStructureRun?.current_url && (
                        <Card style={{ padding: 8, display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                          <span
                            className="project-run-spinner"
                            aria-hidden="true"
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              border: "2px solid currentColor",
                              borderTopColor: "transparent",
                              display: "inline-block",
                              flex: "0 0 auto",
                            }}
                          />
                          <MetaText style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            Сейчас обрабатывается: {liveStructureRun.current_url}
                          </MetaText>
                        </Card>
                      )}
                      {liveStructureRun && (
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
                          <span style={{ color: "#8fd18f" }}>
                            ✓ Готово: {liveStructureRun.pages_total}
                          </span>
                          <span>Обнаружено: {Math.max(liveStructureRun.pages_discovered, liveStructureRun.pages_total)}</span>
                          <span style={{ opacity: 0.72 }}>
                            В очереди: {Math.max(0, liveStructureRun.pages_discovered - liveStructureRun.pages_total)}
                          </span>
                          <span style={{ opacity: 0.72 }}>Текущий батч: {liveStructureRun.current_batch_no}</span>
                        </div>
                      )}
                      <ProjectPersistentDetails
                        storageKey="structure-process"
                        summary="Подробности процесса"
                        summaryStyle={{ cursor: "pointer", color: "var(--muted)", fontSize: 13 }}
                      >
                        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
                            <span style={{ color: "#8fd18f" }}>✓ Запуск принят</span>
                            <span style={{ opacity: 0.45 }}>→</span>
                            <span className={selectedPendingJob ? "project-run-live-stage" : undefined}>
                              {selectedPendingJob ? "● В очереди worker" : "✓ Worker взял задачу"}
                            </span>
                            <span style={{ opacity: 0.45 }}>→</span>
                            <span className={!selectedPendingJob ? "project-run-live-stage" : undefined} style={{ opacity: selectedPendingJob ? 0.62 : undefined }}>
                              {!selectedPendingJob ? "● Crawler обходит страницы" : "Обход страниц"}
                            </span>
                            <span style={{ opacity: 0.45 }}>→</span>
                            <span style={{ opacity: 0.62 }}>Обновление структуры</span>
                          </div>
                          {selectedPendingJob && (
                            <Card style={{ padding: 8, display: "grid", gap: 4 }}>
                              <MetaText>
                                В очереди: job #{selectedPendingJob.jobId} · контекст {selectedPendingJob.personaLabel}
                              </MetaText>
                              {selectedPendingRetryText && (
                                <StatusText tone="warning" style={{ fontSize: 12 }}>
                                  {selectedPendingRetryText}
                                </StatusText>
                              )}
                              <MetaText opacity={0.72}>
                                Это нормальный этап worker-mode. Если очередь зависнет, readiness покажет предупреждение.
                              </MetaText>
                            </Card>
                          )}
                        </div>
                      </ProjectPersistentDetails>
                    </Card>
                  )}
                  {!structureMultiContextEnabled && !structureUpdatePending && structureRun && (
                    <Card
                      variant={structureStatusCounts.error > 0 ? "warning" : "hint"}
                      style={{ padding: 10, display: "grid", gap: 8 }}
                    >
                      <SectionHeaderRow
                        title={<div style={{ fontWeight: 700 }}>Прогон завершён — структура готова</div>}
                        actions={<ProjectRunBadge status={structureRun.status} />}
                      />
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
                        <span>Страниц: {structureRun.pages_total}</span>
                        <span style={{ color: "#8fb7ff" }}>Новых: {structureStatusCounts.added}</span>
                        <span>Изменённых: {structureStatusCounts.changed}</span>
                        <span style={{ color: structureStatusCounts.error > 0 ? "#e7a15a" : "#8fd18f" }}>
                          Ошибок: {structureStatusCounts.error}
                        </span>
                      </div>
                      <ProjectPersistentDetails
                        storageKey="structure-slice-details"
                        summary="Технические детали"
                        summaryStyle={{ cursor: "pointer", color: "var(--muted)", fontSize: 13 }}
                      >
                        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                          <MetaText opacity={0.68}>
                            {formatRunTitle(structureRun.started_at)} · {formatDuration(structureRun.started_at, structureRun.finished_at)}
                          </MetaText>
                          <MetaText opacity={0.68}>Контекст проверки: {structureRun.persona?.label || "Гость"}</MetaText>
                          <div><RunRuntimePill runtime={structureRun.crawl_runtime} /></div>
                        </div>
                      </ProjectPersistentDetails>
                    </Card>
                  )}
                  {pagesLoading && (
                    <Card variant="hint" style={{ padding: 10, display: "flex", gap: 8, alignItems: "center" }}>
                      <span
                        className="project-run-spinner"
                        aria-hidden="true"
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          border: "2px solid currentColor",
                          borderTopColor: "transparent",
                          display: "inline-block",
                          flex: "0 0 auto",
                        }}
                      />
                      <MetaText>Загружаем готовую структуру и сравниваем её с предыдущим прогоном...</MetaText>
                    </Card>
                  )}
                  {bulkRetryError && <StatusText tone="danger">{bulkRetryError}</StatusText>}
                  {bulkRetryResult && (
                    <Card
                      variant={bulkRetryResult.failed > 0 ? "warning" : "hint"}
                      style={{ padding: 10, display: "grid", gap: 5 }}
                    >
                      <StatusText tone={bulkRetryResult.failed > 0 ? "warning" : "success"}>
                        Повторная проверка: доступно {bulkRetryResult.succeeded}, ошибка сохранилась {bulkRetryResult.failed}, пропущено {bulkRetryResult.skipped}.
                      </StatusText>
                      <MetaText opacity={0.68}>
                        Контекст: {getRetryPersonaLabel(bulkRetryResult, structureRun?.persona?.label)}.
                        {bulkRetryResult.session_message ? ` ${bulkRetryResult.session_message}` : ""}
                      </MetaText>
                      <MetaText opacity={0.68}>{bulkRetryResult.message}</MetaText>
                    </Card>
                  )}
                  {structureRetryNotice && (
                    <Card
                      variant={structureRetryNoticeTone === "success" ? "hint" : "warning"}
                      style={{ padding: 10 }}
                    >
                      <StatusText tone={structureRetryNoticeTone}>{structureRetryNotice}</StatusText>
                    </Card>
                  )}
                  <SectionHeaderRow
                    title={<ListTotalMeta label="Страницы" total={structureMultiContextEnabled ? multiContextStructureRowsTotal : structureRows.length} />}
                    actions={
                      (structureMultiContextEnabled ? multiContextStructureRowsTotal : structureRows.length) > 0 ? (
                        <SegmentedControl
                          value={structureViewFilter}
                          onChange={setStructureViewFilter}
                          options={[
                            { value: "all", label: `Все · ${structureMultiContextEnabled ? multiContextStructureRowsTotal : structureRows.length}` },
                            { value: "added", label: `Новые · ${structureMultiContextEnabled ? multiContextStructureCounts.added : structureStatusCounts.added}` },
                            { value: "error", label: `Ошибки · ${structureMultiContextEnabled ? multiContextStructureCounts.error : structureStatusCounts.error}` },
                          ]}
                        />
                      ) : undefined
                    }
                    style={{ alignItems: "flex-start", flexWrap: "wrap" }}
                  />
                  {pagesError && (
                    <StatusText tone="danger">
                      Не удалось обновить структуру. Последний загруженный срез сохранён: {pagesError}
                    </StatusText>
                  )}
                  {(!pagesLoading || structureRows.length > 0) && (
                    <>
                      <ProjectPersistentDetails
                        storageKey="structure-legend"
                        summary="Легенда структуры"
                        summaryStyle={{ cursor: "pointer", color: "var(--muted)", fontSize: 13 }}
                      >
                        <div style={{ marginTop: 8 }}>
                          <StructureLegendHint />
                        </div>
                      </ProjectPersistentDetails>
                      <ClearableInput
                        value={structureSearch}
                        onChange={setStructureSearch}
                        placeholder="Поиск по URL, title, description, H1, final URL, HTTP-статусу или ошибке..."
                      />
                    </>
                  )}
                  {!pagesLoading && !structureMultiContextEnabled && structureRows.length === 0 && (
                    <MetaText>
                      {structureUpdatePending
                        ? "Первый прогон ещё выполняется — здесь появятся найденные страницы после его завершения."
                        : "Структура пока недоступна: выполните как минимум один прогон."}
                    </MetaText>
                  )}
                  {!pagesLoading && structureMultiContextEnabled && multiContextStructureRowsTotal === 0 && (
                    <MetaText>
                      Для выбранного сайта пока нет готовых структур по контекстам доступа.
                    </MetaText>
                  )}
                  {structureMultiContextEnabled && multiContextStructureSections.length > 0 && (
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                        {multiContextStructureSections.map((section) => (
                          <Card
                            key={section.run.id}
                            interactive
                            role="button"
                            tabIndex={0}
                            aria-pressed={activeMultiContextStructureSection?.run.id === section.run.id}
                            onClick={() => setActiveMultiContextStructureRunId(section.run.id)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              setActiveMultiContextStructureRunId(section.run.id);
                            }}
                            style={{
                              display: "grid",
                              gap: 6,
                              cursor: "pointer",
                              padding: 10,
                              borderColor: activeMultiContextStructureSection?.run.id === section.run.id
                                ? "rgba(120,166,255,0.78)"
                                : undefined,
                              background: activeMultiContextStructureSection?.run.id === section.run.id
                                ? "rgba(120,166,255,0.1)"
                                : undefined,
                            }}
                          >
                            <SectionHeaderRow
                              title={
                                <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <span style={{ fontWeight: 800 }}>{section.personaLabel}</span>
                                  <AccentPill tone="info">run #{section.run.id}</AccentPill>
                                </span>
                              }
                              actions={<RunRuntimePill runtime={section.run.crawl_runtime} />}
                            />
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                              <AccentPill tone="neutral">{section.rows.length} страниц</AccentPill>
                              <AccentPill tone={section.counts.changed > 0 ? "warning" : "neutral"}>
                                {section.counts.changed} изменений
                              </AccentPill>
                              <AccentPill tone={section.counts.error > 0 ? "danger" : "neutral"}>
                                {section.counts.error} ошибок
                              </AccentPill>
                              {section.filteredRows.length !== section.rows.length && (
                                <AccentPill tone="info">показано {section.filteredRows.length}</AccentPill>
                              )}
                            </div>
                            <MetaText opacity={0.68}>{formatRunTitle(section.run.started_at)}</MetaText>
                          </Card>
                        ))}
                      </div>
                      {activeMultiContextStructureSection && (
                        <Card style={{ padding: 10, display: "grid", gap: 8 }}>
                          <SectionHeaderRow
                            title={
                              <div style={{ fontWeight: 800 }}>
                                Структура: {activeMultiContextStructureSection.personaLabel}
                              </div>
                            }
                            actions={<RunRuntimePill runtime={activeMultiContextStructureSection.run.crawl_runtime} />}
                          />
                          {activeMultiContextStructureSection.filteredRows.length > 0 ? (
                            <ProjectStructureTree
                              rows={activeMultiContextStructureSection.filteredRows}
                              query={structureSearch}
                              onPageSelect={(url) => void handleOpenPageContextForRun(activeMultiContextStructureSection.run.id, url)}
                              onDirectorySelect={(context) => {
                                setPageContextOpen(false);
                                setDirectoryContext(context);
                              }}
                              canRetry={false}
                              retryingUrl={null}
                              retryResultByUrl={{}}
                              onRetryPage={() => undefined}
                              live={false}
                              currentBatchNo={null}
                            />
                          ) : (
                            <MetaText>
                              {structureViewFilter === "added"
                                ? "В этом контексте нет новых страниц."
                                : structureViewFilter === "error"
                                  ? "В этом контексте нет страниц с ошибками."
                                  : "По текущему поиску в этом контексте совпадений не найдено."}
                            </MetaText>
                          )}
                        </Card>
                      )}
                    </div>
                  )}
                  {!structureMultiContextEnabled && structureRows.length > 0 && structureRowsFiltered.length > 0 && (
                    <ProjectStructureTree
                      rows={structureRowsFiltered}
                      query={structureSearch}
                      onPageSelect={(url) => void handleOpenPageContext(url)}
                      onDirectorySelect={(context) => {
                        setPageContextOpen(false);
                        setDirectoryContext(context);
                      }}
                      canRetry={canRunCrawler && !structureUpdatePending}
                      retryingUrl={structureRetryingUrl}
                      retryResultByUrl={structureRetryResultByUrl}
                      onRetryPage={(url) => void handleRetryStructurePage(url)}
                      live={structureIsLive}
                      currentBatchNo={liveStructureRun?.current_batch_no ?? null}
                    />
                  )}
                  {!structureMultiContextEnabled && structureRows.length > 0 && structureRowsFiltered.length === 0 && (
                    <MetaText>
                      {structureViewFilter === "added"
                        ? "В текущем срезе нет новых страниц."
                        : structureViewFilter === "error"
                          ? "В текущем срезе нет страниц с ошибками."
                          : "По текущему поиску совпадений не найдено."}
                    </MetaText>
                  )}
                </div>
              </Card>
            </>
          )}

          {activeTab === "history" && (
            <Card>
              <div style={{ display: "grid", gap: 10 }}>
                <SectionHeaderRow
                  title={
                    <div>
                      <div style={{ fontWeight: 700 }}>История прогонов</div>
                      <MetaText opacity={0.68}>
                        {selectedSite?.name || "Сайт не выбран"} · {selectedViewPersona ? `контекст ${selectedViewPersona.label}` : "все контексты"}
                      </MetaText>
                    </div>
                  }
                  actions={<ListTotalMeta label="Прогонов" total={runs.length} />}
                />
                <div style={{ display: "grid", gap: 8 }}>
                  {runs.map((run) => (
                    <Card key={run.id} style={{ padding: 10 }}>
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 700 }}>{formatRunTitle(run.started_at)}</div>
                          <ProjectRunBadge status={run.status} />
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <AccentPill tone="info" title="Контекст доступа, под которым crawler открывал страницы.">
                            {run.persona?.label || "Гость"}
                          </AccentPill>
                          <RunRuntimePill runtime={run.crawl_runtime} />
                          <AccentPill tone="neutral" title="Сколько страниц попало в результат этого прогона.">
                            {run.pages_total} страниц
                          </AccentPill>
                          <AccentPill tone={run.pages_changed > 0 ? "warning" : "neutral"} title="Сколько страниц изменилось относительно предыдущего сравнимого результата.">
                            {run.pages_changed} изменений
                          </AccentPill>
                          <AccentPill tone={run.status === "FAILED" ? "danger" : "neutral"} title="Длительность по времени старта и завершения.">
                            {formatDuration(run.started_at, run.finished_at)}
                          </AccentPill>
                        </div>
                        <ProjectPersistentDetails
                          storageKey={`history-run-${run.id}`}
                          summary="Детали"
                          summaryStyle={{ cursor: "pointer", color: "var(--muted)", fontSize: 13 }}
                        >
                          <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
                            <MetaText>Старт: {formatOperationalDateTime(run.started_at)}</MetaText>
                            <MetaText>Завершение: {run.finished_at ? formatOperationalDateTime(run.finished_at) : "ещё выполняется"}</MetaText>
                            <MetaText>Обнаружено страниц: {run.pages_discovered}</MetaText>
                            {run.current_url && <MetaText>Текущий URL: {run.current_url}</MetaText>}
                            {run.failure_code && <MetaText>Код ошибки: {run.failure_code}</MetaText>}
                            {run.failure_message && (
                              <StatusText tone="danger">{run.failure_message}</StatusText>
                            )}
                          </div>
                        </ProjectPersistentDetails>
                      </div>
                    </Card>
                  ))}
                  {runs.length === 0 && (
                    <MetaText>
                      {selectedViewPersona
                        ? `Для контекста «${selectedViewPersona.label}» история пока пуста.`
                        : "История пока пуста."}
                    </MetaText>
                  )}
                </div>
              </div>
            </Card>
          )}

          {activeTab === "settings" && canEditProject && (
            <div style={{ display: "grid", gap: 12 }}>
              <Card>
                <div style={{ display: "grid", gap: 10 }}>
                  <SectionHeaderRow
                    title={<div style={{ fontWeight: 800 }}>Настройки проекта</div>}
                    actions={<AccentPill tone="neutral">{project.name}</AccentPill>}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
                    {([
                      { id: "sites", title: "Сайты", meta: `${sites.length} сайт(а)`, tone: "info" },
                      { id: "members", title: "Участники", meta: "Права", tone: "neutral" },
                      { id: "schedule", title: "Расписание", meta: projectSchedule?.is_enabled ? "Включено" : "Пауза", tone: projectSchedule?.is_enabled ? "info" : "neutral" },
                      { id: "danger", title: "Опасная зона", meta: "Удаление", tone: "danger" },
                    ] satisfies Array<{ id: ProjectSettingsSectionId; title: string; meta: string; tone: "info" | "neutral" | "danger" }>).map((item) => (
                      <Card
                        key={item.id}
                        interactive
                        role="button"
                        tabIndex={0}
                        aria-pressed={activeSettingsSection === item.id}
                        variant={item.id === "danger" ? "danger" : "default"}
                        onClick={() => setActiveSettingsSection(item.id)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          setActiveSettingsSection(item.id);
                        }}
                        style={{
                          padding: 10,
                          cursor: "pointer",
                          borderColor: activeSettingsSection === item.id ? "rgba(120,166,255,0.78)" : undefined,
                          background: activeSettingsSection === item.id ? "rgba(120,166,255,0.1)" : undefined,
                          boxShadow: activeSettingsSection === item.id ? "0 0 0 1px rgba(120,166,255,0.22)" : undefined,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                          <span style={{ fontWeight: 750 }}>{item.title}</span>
                          <AccentPill tone={item.tone}>{item.meta}</AccentPill>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              </Card>

              {activeSettingsSection === "sites" && (
                <Card>
                  <ProjectSitesSettings
                    projectId={project.id}
                    compactHeader
                    onChanged={() => {
                      void loadSiteSummaries(project.id, true);
                    }}
                  />
                </Card>
              )}

              {activeSettingsSection === "members" && (
                <Card>
                  <ProjectMembersSettings projectId={project.id} compactHeader />
                </Card>
              )}

              {activeSettingsSection === "schedule" && (
                <Card>
                  <div style={{ display: "grid", gap: 12 }}>
                    <SectionHeaderRow
                      title={<div style={{ fontWeight: 800 }}>Расписание</div>}
                      actions={
                        <AccentPill tone={projectSchedule?.is_enabled ? "success" : "neutral"}>
                          {projectSchedule?.is_enabled ? "Автозапуск включён" : "На паузе"}
                        </AccentPill>
                      }
                    />
                    {scheduleError && <StatusText tone="danger">{scheduleError}</StatusText>}
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <MetaText opacity={0.72}>Автозапуск:</MetaText>
                        <CardActionButton
                          compact
                          active={scheduleForm.is_enabled}
                          onClick={() => setScheduleForm((current) => ({ ...current, is_enabled: true }))}
                        >
                          Включён
                        </CardActionButton>
                        <CardActionButton
                          compact
                          active={!scheduleForm.is_enabled}
                          onClick={() => setScheduleForm((current) => ({ ...current, is_enabled: false }))}
                        >
                          Пауза
                        </CardActionButton>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <MetaText opacity={0.72}>Частота:</MetaText>
                        <CardActionButton
                          compact
                          active={scheduleForm.frequency === "daily"}
                          onClick={() => setScheduleForm((current) => ({ ...current, frequency: "daily", weekdays: [] }))}
                        >
                          Каждый день
                        </CardActionButton>
                        <CardActionButton
                          compact
                          active={scheduleForm.frequency === "weekly"}
                          onClick={() => setScheduleForm((current) => ({ ...current, frequency: "weekly", weekdays: current.weekdays.length ? current.weekdays : [0] }))}
                        >
                          По дням недели
                        </CardActionButton>
                      </div>
                      {scheduleForm.frequency === "weekly" && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          {WEEKDAY_OPTIONS.map((day) => (
                            <CardActionButton
                              key={day.value}
                              compact
                              active={scheduleForm.weekdays.includes(day.value)}
                              onClick={() => {
                                setScheduleForm((current) => {
                                  const next = current.weekdays.includes(day.value)
                                    ? current.weekdays.filter((value) => value !== day.value)
                                    : [...current.weekdays, day.value].sort();
                                  return { ...current, weekdays: next.length ? next : current.weekdays };
                                });
                              }}
                            >
                              {day.label}
                            </CardActionButton>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                        <label style={{ display: "grid", gap: 4 }}>
                          <MetaText opacity={0.72}>Время запуска</MetaText>
                          <input
                            type="time"
                            value={scheduleForm.time_of_day}
                            onChange={(event) => setScheduleForm((current) => ({ ...current, time_of_day: event.target.value }))}
                            style={{
                              borderRadius: 10,
                              border: "1px solid rgba(255,255,255,0.24)",
                              background: "rgba(255,255,255,0.06)",
                              color: "inherit",
                              padding: "8px 10px",
                            }}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 4 }}>
                          <MetaText opacity={0.72}>Часовой пояс</MetaText>
                          <input
                            value={scheduleForm.timezone}
                            onChange={(event) => setScheduleForm((current) => ({ ...current, timezone: event.target.value }))}
                            placeholder="Europe/Minsk"
                            style={{
                              borderRadius: 10,
                              border: "1px solid rgba(255,255,255,0.24)",
                              background: "rgba(255,255,255,0.06)",
                              color: "inherit",
                              padding: "8px 10px",
                            }}
                          />
                        </label>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <AccentPill tone="neutral">
                          Следующий запуск: {projectSchedule?.next_run_at ? formatOperationalDateTime(projectSchedule.next_run_at) : "не запланирован"}
                        </AccentPill>
                        {projectSchedule?.last_run_at && (
                          <AccentPill tone="neutral">Последний запуск: {formatOperationalDateTime(projectSchedule.last_run_at)}</AccentPill>
                        )}
                        {projectSchedule?.last_skip_reason && (
                          <AccentPill tone="warning">Пропуск: {projectSchedule.last_skip_reason}</AccentPill>
                        )}
                      </div>
                      <div style={{ display: "grid", gap: 8 }}>
                        <SectionHeaderRow
                          title={<div style={{ fontWeight: 800 }}>Будет запущено</div>}
                          actions={<AccentPill tone="neutral">{scheduleEnabledSites.length} сайт(а)</AccentPill>}
                        />
                        {scheduleEnabledSites.length > 0 ? (
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                            {scheduleEnabledSites.map((site) => {
                              const persona = site.default_persona || null;
                              const sessionMeta = personaSessionPillMeta(persona);
                              return (
                                <Card key={site.id} style={{ padding: 10, display: "grid", gap: 6 }}>
                                  <div style={{ fontWeight: 800 }}>{site.name}</div>
                                  <MetaText opacity={0.68}>{site.start_url}</MetaText>
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                    <AccentPill tone="info">{persona?.label || "Гость"}</AccentPill>
                                    <AccentPill tone={sessionMeta.tone}>{sessionMeta.label}</AccentPill>
                                  </div>
                                </Card>
                              );
                            })}
                          </div>
                        ) : (
                          <MetaText>В проекте нет включённых сайтов для автозапуска.</MetaText>
                        )}
                        {scheduleDisabledSitesCount > 0 && (
                          <MetaText opacity={0.68}>
                            Не участвуют: {scheduleDisabledSitesCount} отключённых сайт(а).
                          </MetaText>
                        )}
                      </div>
                    </div>
                    <CardFooterActions>
                      <CardActionButton
                        variant="primary"
                        onClick={() => void handleSaveSchedule()}
                        disabled={scheduleSaving}
                      >
                        {scheduleSaving ? "Сохраняем..." : "Сохранить расписание"}
                      </CardActionButton>
                      {projectSchedule?.is_enabled ? (
                        <CardActionButton
                          onClick={() => void handlePauseSchedule()}
                          disabled={scheduleSaving || !projectSchedule?.id}
                        >
                          Пауза
                        </CardActionButton>
                      ) : (
                        <CardActionButton
                          onClick={() => void handleResumeSchedule()}
                          disabled={scheduleSaving || !projectSchedule?.id}
                        >
                          Включить
                        </CardActionButton>
                      )}
                      <CardActionButton
                        onClick={() => void handleStartRun()}
                        disabled={runPending || hasRunning}
                      >
                        {hasRunning ? "Прогон выполняется" : "Запустить сейчас"}
                      </CardActionButton>
                    </CardFooterActions>
                  </div>
                </Card>
              )}

              {activeSettingsSection === "danger" && (
                <Card variant="danger">
                  <div style={{ display: "grid", gap: 10 }}>
                    <SectionHeaderRow
                      title={<div style={{ fontWeight: 800 }}>Опасная зона</div>}
                      actions={<AccentPill tone="danger">Требует внимания</AccentPill>}
                    />
                    <CardFooterActions>
                      <CardActionButton
                        variant="danger"
                        onClick={() => setDeleteConfirmOpen(true)}
                      >
                        Удалить проект
                      </CardActionButton>
                    </CardFooterActions>
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Удалить проект?"
        description={project ? `Проект "${project.name}" будет удален без возможности восстановления.` : ""}
        confirmText="Удалить"
        cancelText="Отмена"
        confirmVariant="danger"
        loading={deletePending}
        onConfirm={() => {
          void handleDeleteProject();
        }}
        onCancel={() => {
          if (deletePending) return;
          setDeleteConfirmOpen(false);
        }}
      />
      <ConfirmDialog
        open={targetDeleteConfirm !== null}
        title="Удалить цель мониторинга?"
        description={targetDeleteConfirm ? `Цель "${targetDeleteConfirm.name}" и история её проверок будут удалены.` : ""}
        confirmText="Удалить"
        cancelText="Отмена"
        confirmVariant="danger"
        loading={targetActionPendingId === targetDeleteConfirm?.id}
        onConfirm={() => {
          void handleDeleteMonitoringTarget();
        }}
        onCancel={() => {
          if (targetActionPendingId) return;
          setTargetDeleteConfirm(null);
        }}
      />
      <ToastHost
        items={runToasts}
        onClose={(toastId) => setRunToasts((current) => current.filter((item) => item.id !== toastId))}
        autoCloseMs={7000}
      />
      <PageContextDrawer
        open={pageContextOpen}
        loading={pageContextLoading}
        error={pageContextError}
        context={pageContext}
        canRetry={canRunCrawler && !structureUpdatePending}
        retryPending={pageRetryPending}
        retryMessage={pageRetryMessage}
        retrySucceeded={pageRetrySucceeded}
        onRetry={() => void handleRetryCurrentPage()}
        onOpenFullAnalysis={() => {
          if (!project || !pageContext) return;
          navigate(
            `/projects/${project.id}/inspect?run=${pageContext.page.run_id}&url=${encodeURIComponent(pageContext.page.url)}`,
            { state: { projectName: project.name } },
          );
        }}
        onClose={() => {
          setPageContextOpen(false);
          setPageContextError("");
          setPageContextRunId(null);
        }}
      />
      <DirectoryContextDrawer
        context={directoryContext}
        onClose={() => setDirectoryContext(null)}
      />
    </div>
  );
}
