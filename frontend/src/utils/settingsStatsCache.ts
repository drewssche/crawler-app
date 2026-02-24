import { apiGet } from "../api/client";

export type MonitoringState = "стабильно" | "внимание" | "критично" | "нет данных";

export type SettingsSummary = {
  pendingUsers: { value: number | null; sourceOk: boolean };
  rootAdmins: { value: number | null; sourceOk: boolean };
  eventsUnread: { value: number | null; sourceOk: boolean };
  audit24h: { value: number | null; sourceOk: boolean };
  monitoring: { state: MonitoringState; sourceOk: boolean };
};

type SettingsSummaryResponse = {
  pending_users?: { value?: number | null; source_ok?: boolean };
  root_admins?: { value?: number | null; source_ok?: boolean };
  events_unread?: { value?: number | null; source_ok?: boolean };
  audit24h?: { value?: number | null; source_ok?: boolean };
  monitoring?: { state?: MonitoringState; source_ok?: boolean };
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
