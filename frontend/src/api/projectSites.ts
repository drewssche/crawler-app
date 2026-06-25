import { apiDelete, apiGet, apiPatch, apiPost } from "./client";

export type SiteScopeMode = "whole_site" | "path_prefix";
export type ProjectSiteRole = "primary" | "reference" | "target" | "peer";

export type ProjectSite = {
  id: number;
  profile_id: number;
  name: string;
  start_url: string;
  canonical_origin: string;
  scope_mode: SiteScopeMode;
  path_prefix: string;
  role: ProjectSiteRole;
  allowed_domains_csv: string;
  exclude_paths_csv: string;
  exclude_ext_csv: string;
  respect_robots: boolean;
  max_pages: number;
  concurrency: number;
  is_enabled: boolean;
  sort_order: number;
};

export type ProjectSiteRunSummary = {
  id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  pages_total: number;
  pages_changed: number;
  failure_code: string | null;
  failure_message: string | null;
};

export type ProjectSiteAnomaly = {
  status: "insufficient_data" | "normal" | "anomaly";
  severity: "info" | "warning" | "danger";
  message: string;
  reasons: Array<{
    code: string;
    severity: "warning" | "danger";
    message: string;
  }>;
  successful_runs: number;
  baseline_runs_required: number;
  baseline: {
    runs: number;
    pages_average: number;
    change_rate: number;
    error_rate: number;
  } | null;
  latest: {
    run_id: number;
    pages_total: number;
    pages_changed: number;
    change_rate: number;
    error_pages: number;
    error_rate: number;
  } | null;
};

export type ProjectSiteSummary = ProjectSite & {
  runs_total: number;
  last_run: ProjectSiteRunSummary | null;
  anomaly: ProjectSiteAnomaly;
};

export type ProjectSiteInput = {
  name: string;
  start_url: string;
  scope_mode: SiteScopeMode;
  path_prefix?: string | null;
  role?: ProjectSiteRole;
  max_pages?: number;
  concurrency?: number;
  is_enabled?: boolean;
};

export function listProjectSites(profileId: number): Promise<ProjectSite[]> {
  return apiGet<ProjectSite[]>(`/profiles/${profileId}/sites`);
}

export function listProjectSiteSummaries(profileId: number): Promise<ProjectSiteSummary[]> {
  return apiGet<ProjectSiteSummary[]>(`/profiles/${profileId}/sites/summary`);
}

export function createProjectSite(profileId: number, input: ProjectSiteInput): Promise<ProjectSite> {
  return apiPost<ProjectSite>(`/profiles/${profileId}/sites`, input);
}

export function updateProjectSite(
  profileId: number,
  siteId: number,
  input: Partial<ProjectSiteInput>,
): Promise<ProjectSite> {
  return apiPatch<ProjectSite>(`/profiles/${profileId}/sites/${siteId}`, input);
}

export function deleteProjectSite(profileId: number, siteId: number): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/profiles/${profileId}/sites/${siteId}`);
}
