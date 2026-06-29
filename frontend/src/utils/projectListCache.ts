import { apiGet } from "../api/client";

export type ProjectListItem = {
  id: number;
  name: string;
  sites?: ProjectListSite[];
  site_count?: number;
  /** Compatibility fallback. Prefer sites[]. */
  start_url: string;
  /** Compatibility fallback. Prefer sites[]. */
  allowed_domains_csv?: string;
};

export type ProjectListSite = {
  id: number;
  name: string;
  start_url: string;
  scope_mode: "whole_site" | "path_prefix" | string;
  path_prefix: string;
  role: string;
  is_enabled: boolean;
};

export type ProjectRunSummary = {
  id: number;
  status: string;
  crawl_runtime?: "http" | "browser" | string;
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
        sites: row.sites,
        site_count: row.site_count,
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
