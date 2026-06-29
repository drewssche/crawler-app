import { apiGet } from "../api/client";

export type MonitoringState = "стабильно" | "внимание" | "критично" | "нет данных";

export type SettingsSummary = {
  pendingUsers: { value: number | null; sourceOk: boolean };
  rootAdmins: { value: number | null; sourceOk: boolean };
  eventsUnread: { value: number | null; sourceOk: boolean };
  audit24h: { value: number | null; sourceOk: boolean };
  monitoring: { state: MonitoringState; sourceOk: boolean };
  quotaOverview: {
    sourceOk: boolean;
    source: string;
    roles: QuotaOverviewRole[];
  };
  storageBudget: StorageBudget;
};

export type QuotaOverviewRole = {
  role: string;
  max_projects: number;
  max_sites_per_project: number;
  max_pages_per_site: number;
  max_concurrency_per_site: number;
  max_active_jobs_per_user: number;
  max_bulk_sites_per_run: number;
};

export type StorageBudget = {
  sourceOk: boolean;
  status: "ok" | "warning" | "over_budget" | string;
  budgetMb: number;
  usedMb: number;
  usagePercent: number;
  rawHtmlMb: number;
  renderedSnapshotsMb: number;
  source: string;
  retention: {
    rawArtifactRunsToKeep: number;
    source: string;
  };
  totals: {
    projects: number;
    runs: number;
    pages: number;
    pagesWithRawHtml: number;
  };
  topProjects: Array<{
    projectId: number;
    name: string;
    runs: number;
    pages: number;
    rawHtmlMb: number;
  }>;
};

type SettingsSummaryResponse = {
  pending_users?: { value?: number | null; source_ok?: boolean };
  root_admins?: { value?: number | null; source_ok?: boolean };
  events_unread?: { value?: number | null; source_ok?: boolean };
  audit24h?: { value?: number | null; source_ok?: boolean };
  monitoring?: { state?: MonitoringState; source_ok?: boolean };
  quota_overview?: {
    source_ok?: boolean;
    source?: string;
    roles?: QuotaOverviewRole[];
  };
  storage_budget?: {
    source_ok?: boolean;
    status?: string;
    budget_mb?: number;
    used_mb?: number;
    usage_percent?: number;
    raw_html_mb?: number;
    rendered_snapshots_mb?: number;
    source?: string;
    retention?: {
      raw_artifact_runs_to_keep?: number;
      source?: string;
    };
    totals?: {
      projects?: number;
      runs?: number;
      pages?: number;
      pages_with_raw_html?: number;
    };
    top_projects?: Array<{
      project_id?: number;
      name?: string;
      runs?: number;
      pages?: number;
      raw_html_mb?: number;
    }>;
  };
};

const TTL_MS = 30_000;

type CacheEntry<T> = {
  value: T | null;
  expiresAt: number;
  inFlight: Promise<T> | null;
};

function createEntry<T>(): CacheEntry<T> {
  return { value: null, expiresAt: 0, inFlight: null };
}

const summaryEntry = createEntry<SettingsSummary>();

function normalizeSummary(raw: SettingsSummaryResponse | null | undefined): SettingsSummary {
  return {
    pendingUsers: {
      value: typeof raw?.pending_users?.value === "number" ? raw.pending_users.value : null,
      sourceOk: raw?.pending_users?.source_ok !== false,
    },
    rootAdmins: {
      value: typeof raw?.root_admins?.value === "number" ? raw.root_admins.value : null,
      sourceOk: raw?.root_admins?.source_ok !== false,
    },
    eventsUnread: {
      value: typeof raw?.events_unread?.value === "number" ? raw.events_unread.value : null,
      sourceOk: raw?.events_unread?.source_ok !== false,
    },
    audit24h: {
      value: typeof raw?.audit24h?.value === "number" ? raw.audit24h.value : null,
      sourceOk: raw?.audit24h?.source_ok !== false,
    },
    monitoring: {
      state: raw?.monitoring?.state || "нет данных",
      sourceOk: raw?.monitoring?.source_ok !== false,
    },
    quotaOverview: {
      sourceOk: raw?.quota_overview?.source_ok !== false,
      source: raw?.quota_overview?.source || "env:QUOTA_{ROLE}_...",
      roles: Array.isArray(raw?.quota_overview?.roles) ? raw.quota_overview.roles : [],
    },
    storageBudget: {
      sourceOk: raw?.storage_budget?.source_ok !== false,
      status: raw?.storage_budget?.status || "ok",
      budgetMb: typeof raw?.storage_budget?.budget_mb === "number" ? raw.storage_budget.budget_mb : 0,
      usedMb: typeof raw?.storage_budget?.used_mb === "number" ? raw.storage_budget.used_mb : 0,
      usagePercent: typeof raw?.storage_budget?.usage_percent === "number" ? raw.storage_budget.usage_percent : 0,
      rawHtmlMb: typeof raw?.storage_budget?.raw_html_mb === "number" ? raw.storage_budget.raw_html_mb : 0,
      renderedSnapshotsMb: typeof raw?.storage_budget?.rendered_snapshots_mb === "number" ? raw.storage_budget.rendered_snapshots_mb : 0,
      source: raw?.storage_budget?.source || "SCAN_STORAGE_BUDGET_MB",
      retention: {
        rawArtifactRunsToKeep: typeof raw?.storage_budget?.retention?.raw_artifact_runs_to_keep === "number"
          ? raw.storage_budget.retention.raw_artifact_runs_to_keep
          : 2,
        source: raw?.storage_budget?.retention?.source || "SCAN_RAW_ARTIFACT_RUNS_TO_KEEP",
      },
      totals: {
        projects: typeof raw?.storage_budget?.totals?.projects === "number" ? raw.storage_budget.totals.projects : 0,
        runs: typeof raw?.storage_budget?.totals?.runs === "number" ? raw.storage_budget.totals.runs : 0,
        pages: typeof raw?.storage_budget?.totals?.pages === "number" ? raw.storage_budget.totals.pages : 0,
        pagesWithRawHtml: typeof raw?.storage_budget?.totals?.pages_with_raw_html === "number"
          ? raw.storage_budget.totals.pages_with_raw_html
          : 0,
      },
      topProjects: Array.isArray(raw?.storage_budget?.top_projects)
        ? raw.storage_budget.top_projects.map((row) => ({
          projectId: typeof row.project_id === "number" ? row.project_id : 0,
          name: row.name || "Проект",
          runs: typeof row.runs === "number" ? row.runs : 0,
          pages: typeof row.pages === "number" ? row.pages : 0,
          rawHtmlMb: typeof row.raw_html_mb === "number" ? row.raw_html_mb : 0,
        }))
        : [],
    },
  };
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

export async function getSettingsSummaryCached(force = false): Promise<SettingsSummary> {
  return loadWithCache(
    summaryEntry,
    async () => {
      const data = await apiGet<SettingsSummaryResponse>("/admin/settings/summary");
      return normalizeSummary(data);
    },
    force,
  );
}

export async function getPendingUsersCountCached(force = false): Promise<number> {
  const summary = await getSettingsSummaryCached(force);
  return summary.pendingUsers.value ?? 0;
}

export async function getRootAdminsCountCached(force = false): Promise<number> {
  const summary = await getSettingsSummaryCached(force);
  return summary.rootAdmins.value ?? 0;
}

export async function getAudit24hCountCached(force = false): Promise<number> {
  const summary = await getSettingsSummaryCached(force);
  return summary.audit24h.value ?? 0;
}

export async function getMonitoringStateCached(force = false): Promise<MonitoringState> {
  const summary = await getSettingsSummaryCached(force);
  return summary.monitoring.state;
}
