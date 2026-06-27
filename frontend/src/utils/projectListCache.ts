import { apiGet } from "../api/client";

export type ProjectListItem = {
  id: number;
  name: string;
  start_url: string;
  allowed_domains_csv?: string;
};

export type ProjectRunSummary = {
  id: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  pages_total: number;
  pages_changed: number;
};

export type ProjectSummaryItem = ProjectListItem & {
  runs_total: number;
  last_run: ProjectRunSummary | null;
};

type CacheEntry<T> = {
  value: T | null;
  expiresAt: number;
  inFlight: Promise<T> | null;
};

const TTL_MS = 30_000;
const projectsEntry: CacheEntry<ProjectListItem[]> = {
  value: null,
  expiresAt: 0,
  inFlight: null,
};
const projectsSummaryEntry: CacheEntry<ProjectSummaryItem[]> = {
  value: null,
  expiresAt: 0,
  inFlight: null,
};

export function invalidateProjectsCache() {
  projectsEntry.value = null;
  projectsEntry.expiresAt = 0;
  projectsSummaryEntry.value = null;
  projectsSummaryEntry.expiresAt = 0;
}

export async function getProjectsSummaryCached(force = false): Promise<ProjectSummaryItem[]> {
  const now = Date.now();
  if (!force && projectsSummaryEntry.value && projectsSummaryEntry.expiresAt > now) {
    return projectsSummaryEntry.value;
  }
  if (projectsSummaryEntry.inFlight) return projectsSummaryEntry.inFlight;
  projectsSummaryEntry.inFlight = apiGet<ProjectSummaryItem[]>("/projects/summary")
    .then((rows) => {
      projectsSummaryEntry.value = rows || [];
      projectsSummaryEntry.expiresAt = Date.now() + TTL_MS;
      return projectsSummaryEntry.value;
    })
    .finally(() => {
      projectsSummaryEntry.inFlight = null;
    });
  return projectsSummaryEntry.inFlight;
}

export async function getProjectsCached(force = false): Promise<ProjectListItem[]> {
  if (projectsEntry.value && !force && projectsEntry.expiresAt > Date.now()) {
    return projectsEntry.value;
  }
  if (projectsEntry.inFlight) return projectsEntry.inFlight;
  projectsEntry.inFlight = getProjectsSummaryCached(force)
    .then((rows) => {
      projectsEntry.value = rows.map((row) => ({
        id: row.id,
        name: row.name,
        start_url: row.start_url,
        allowed_domains_csv: row.allowed_domains_csv,
      }));
      projectsEntry.expiresAt = Date.now() + TTL_MS;
      return projectsEntry.value;
    })
    .finally(() => {
      projectsEntry.inFlight = null;
    });
  return projectsEntry.inFlight;
}
