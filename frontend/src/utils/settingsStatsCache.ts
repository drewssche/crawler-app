import { apiGet } from "../api/client";

type AdminUserRow = {
  id: number;
  email: string;
  role: string;
  is_approved: boolean;
  is_deleted: boolean;
};

type AdminEmailsResponse = {
  admin_emails: string[];
  db_admins: string[];
};

type AuditResponse = {
  items: Array<Record<string, unknown>>;
  total: number;
  page: number;
  page_size: number;
};

type MonitoringHistoryResponse = {
  enabled: boolean;
  series: Record<string, Array<{ ts: number; value: number }>>;
};

type MonitoringSettings = {
  warn_error_delta: number;
  warn_error_rate: number;
  crit_error_delta: number;
  crit_error_rate: number;
};

type MonitoringState = "стабильно" | "внимание" | "критично" | "нет данных";

const TTL_MS = 30_000;

type CacheEntry<T> = {
  value: T | null;
  expiresAt: number;
  inFlight: Promise<T> | null;
};

function createEntry<T>(): CacheEntry<T> {
  return { value: null, expiresAt: 0, inFlight: null };
}

const pendingCountEntry = createEntry<number>();
const rootAdminsCountEntry = createEntry<number>();
const audit24hEntry = createEntry<number>();
const monitoringStateEntry = createEntry<MonitoringState>();

function latest(points?: Array<{ ts: number; value: number }>) {
  if (!points?.length) return 0;
  return Number(points[points.length - 1]?.value || 0);
}

function prev(points?: Array<{ ts: number; value: number }>) {
  if (!points || points.length < 2) return 0;
  return Number(points[points.length - 2]?.value || 0);
}

function since24hIso() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace("Z", "");
}

function nowIsoNaive() {
  return new Date().toISOString().replace("Z", "");
}

async function loadWithCache<T>(entry: CacheEntry<T>, loader: () => Promise<T>, force = false): Promise<T> {
  const now = Date.now();
  if (!force && entry.value !== null && entry.expiresAt > now) {
    return entry.value;
  }
  if (entry.inFlight) return entry.inFlight;
  entry.inFlight = loader()
    .then((value) => {
      entry.value = value;
      entry.expiresAt = Date.now() + TTL_MS;
      return value;
    })
    .finally(() => {
      entry.inFlight = null;
    });
  return entry.inFlight;
}

export async function getPendingUsersCountCached(force = false): Promise<number> {
  return loadWithCache(
    pendingCountEntry,
    async () => {
      const pending = await apiGet<AdminUserRow[]>("/admin/users?status=pending");
      return pending.length;
    },
    force,
  );
}

export async function getRootAdminsCountCached(force = false): Promise<number> {
  return loadWithCache(
    rootAdminsCountEntry,
    async () => {
      const res = await apiGet<AdminEmailsResponse>("/admin/settings/admin-emails");
      return (res.admin_emails || []).length;
    },
    force,
  );
}

export async function getAudit24hCountCached(force = false): Promise<number> {
  return loadWithCache(
    audit24hEntry,
    async () => {
      const audit = await apiGet<AuditResponse>(
        `/admin/audit?page=1&page_size=1&date_from=${encodeURIComponent(since24hIso())}&date_to=${encodeURIComponent(nowIsoNaive())}`,
      );
      return audit.total || 0;
    },
    force,
  );
}

export async function getMonitoringStateCached(force = false): Promise<MonitoringState> {
  return loadWithCache(
    monitoringStateEntry,
    async () => {
      const [history, settings] = await Promise.all([
        apiGet<MonitoringHistoryResponse>("/admin/monitoring/history?range_minutes=15&step_seconds=30"),
        apiGet<MonitoringSettings>("/admin/monitoring/settings"),
      ]);
      if (!history.enabled) return "нет данных";
      const reqDelta = Math.max(0, latest(history.series?.http_requests) - prev(history.series?.http_requests));
      const errDelta = Math.max(0, latest(history.series?.http_errors) - prev(history.series?.http_errors));
      const rate = reqDelta > 0 ? (errDelta / reqDelta) * 100 : 0;
      if (errDelta >= settings.crit_error_delta || rate >= settings.crit_error_rate) return "критично";
      if (errDelta >= settings.warn_error_delta || rate >= settings.warn_error_rate) return "внимание";
      return "стабильно";
    },
    force,
  );
}

