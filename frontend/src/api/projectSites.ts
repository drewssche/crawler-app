import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./client";

export type SiteScopeMode = "whole_site" | "path_prefix";
export type ProjectSiteRole = "primary" | "reference" | "target" | "peer";

export type CrawlPersonaSummary = {
  id: number;
  project_site_id?: number;
  key: string;
  label: string;
  kind: "guest" | "authenticated" | "partner" | string;
  description?: string;
  is_default?: boolean;
  is_enabled?: boolean;
  has_secrets?: boolean;
  session_bundle_updated_at?: string | null;
  session_bundle_expires_at?: string | null;
  session_bundle_summary?: {
    status: "not_required" | "missing" | "connected" | "unavailable" | string;
    expiry_status: "none" | "active" | "expiring" | "expired" | string;
    expires_in_days: number | null;
    http_applicable: boolean;
    browser_state_stored: boolean;
    cookies_count: number;
    headers_count: number;
    local_storage_count: number;
    session_storage_count: number;
    applied_now: string[];
    stored_for_browser: string[];
    values_exposed: boolean;
  };
  secret_version?: number;
};

export type ProjectSite = {
  id: number;
  project_id: number;
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
  crawl_persona_id?: number | null;
  persona?: CrawlPersonaSummary | null;
  status: string;
  crawl_runtime?: "http" | "browser" | string;
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
  crawl_persona_id?: number | null;
  persona_key?: string | null;
  persona_label?: string | null;
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
  default_persona?: CrawlPersonaSummary | null;
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

export function listProjectSites(projectId: number): Promise<ProjectSite[]> {
  return apiGet<ProjectSite[]>(`/projects/${projectId}/sites`);
}

export function listProjectSiteSummaries(projectId: number): Promise<ProjectSiteSummary[]> {
  return apiGet<ProjectSiteSummary[]>(`/projects/${projectId}/sites/summary`);
}

export function createProjectSite(projectId: number, input: ProjectSiteInput): Promise<ProjectSite> {
  return apiPost<ProjectSite>(`/projects/${projectId}/sites`, input);
}

export function updateProjectSite(
  projectId: number,
  siteId: number,
  input: Partial<ProjectSiteInput>,
): Promise<ProjectSite> {
  return apiPatch<ProjectSite>(`/projects/${projectId}/sites/${siteId}`, input);
}

export function deleteProjectSite(projectId: number, siteId: number): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/projects/${projectId}/sites/${siteId}`);
}

export type CrawlPersonaInput = {
  key: string;
  label: string;
  kind: "authenticated" | "partner" | "guest" | string;
  description?: string;
  is_default?: boolean;
  is_enabled?: boolean;
};

export function listProjectSitePersonas(projectId: number, siteId: number): Promise<CrawlPersonaSummary[]> {
  return apiGet<CrawlPersonaSummary[]>(`/projects/${projectId}/sites/${siteId}/personas`);
}

export function createProjectSitePersona(
  projectId: number,
  siteId: number,
  input: CrawlPersonaInput,
): Promise<CrawlPersonaSummary> {
  return apiPost<CrawlPersonaSummary>(`/projects/${projectId}/sites/${siteId}/personas`, input);
}

export function saveProjectSitePersonaSessionBundle(
  projectId: number,
  siteId: number,
  personaId: number,
  bundle: Record<string, unknown>,
  expiresAt?: string | null,
): Promise<CrawlPersonaSummary> {
  return apiPut<CrawlPersonaSummary>(`/projects/${projectId}/sites/${siteId}/personas/${personaId}/session-bundle`, {
    bundle,
    expires_at: expiresAt || null,
  });
}

export function deleteProjectSitePersonaSessionBundle(
  projectId: number,
  siteId: number,
  personaId: number,
): Promise<CrawlPersonaSummary> {
  return apiDelete<CrawlPersonaSummary>(`/projects/${projectId}/sites/${siteId}/personas/${personaId}/session-bundle`);
}

export type PersonaLoginCapture = {
  id: number;
  crawl_persona_id: number;
  project_site_id: number;
  status: "PENDING" | "COMPLETED" | "CANCELLED" | "EXPIRED" | string;
  mode?: "manual_storage_state" | "managed_browser" | string;
  managed_browser_available?: boolean;
  managed_browser_status?: "planned" | "available" | "unavailable" | string;
  login_url: string;
  expires_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  instructions: string;
};

export type PersonaLoginCaptureCompleteResult = {
  capture: PersonaLoginCapture;
  persona: CrawlPersonaSummary;
};

export type PersonaManagedLoginSession = {
  session_id: string;
  status: "OPENING" | "WAITING_FOR_LOGIN" | "CAPTURED" | "CANCELLED" | "EXPIRED" | "FAILED" | string;
  login_url: string;
  final_url: string | null;
  page_title: string | null;
  launch_mode?: "headless" | "headed" | string;
  interactive_window_available?: boolean;
  environment?: {
    launch_mode: "headless" | "headed" | string;
    headless: boolean;
    display_available: boolean;
    interactive_window_available: boolean;
    message: string;
    recommended_env: Record<string, string>;
    restart_command: string;
    values_exposed: false;
  };
  created_at: string;
  expires_at: string;
  error_message: string | null;
  values_exposed: false;
  instructions: string;
};

export type PersonaManagedLoginSessionStartResult = {
  capture: PersonaLoginCapture;
  session: PersonaManagedLoginSession;
};

export function createProjectSitePersonaLoginCapture(
  projectId: number,
  siteId: number,
  personaId: number,
  input: { login_url?: string | null; ttl_minutes?: number },
): Promise<PersonaLoginCapture> {
  return apiPost<PersonaLoginCapture>(`/projects/${projectId}/sites/${siteId}/personas/${personaId}/login-captures`, input);
}

export function getProjectSitePersonaLoginCapture(
  projectId: number,
  siteId: number,
  personaId: number,
  captureId: number,
): Promise<PersonaLoginCapture> {
  return apiGet<PersonaLoginCapture>(`/projects/${projectId}/sites/${siteId}/personas/${personaId}/login-captures/${captureId}`);
}

export function completeProjectSitePersonaLoginCapture(
  projectId: number,
  siteId: number,
  personaId: number,
  captureId: number,
  input: {
    storage_state: Record<string, unknown>;
    session_storage?: Record<string, unknown> | null;
    extra_http_headers?: Record<string, unknown> | null;
    expires_at?: string | null;
  },
): Promise<PersonaLoginCaptureCompleteResult> {
  return apiPost<PersonaLoginCaptureCompleteResult>(
    `/projects/${projectId}/sites/${siteId}/personas/${personaId}/login-captures/${captureId}/complete`,
    input,
  );
}

export function captureProjectSitePersonaManagedLoginState(
  projectId: number,
  siteId: number,
  personaId: number,
  captureId: number,
  input: {
    wait_seconds?: number;
    expires_at?: string | null;
  } = {},
): Promise<PersonaLoginCaptureCompleteResult> {
  return apiPost<PersonaLoginCaptureCompleteResult>(
    `/projects/${projectId}/sites/${siteId}/personas/${personaId}/login-captures/${captureId}/capture-managed`,
    input,
  );
}

export function startProjectSitePersonaManagedLoginSession(
  projectId: number,
  siteId: number,
  personaId: number,
  captureId: number,
  input: { ttl_minutes?: number } = {},
): Promise<PersonaManagedLoginSessionStartResult> {
  return apiPost<PersonaManagedLoginSessionStartResult>(
    `/projects/${projectId}/sites/${siteId}/personas/${personaId}/login-captures/${captureId}/managed-session`,
    input,
  );
}

export function getProjectSitePersonaManagedLoginSession(
  projectId: number,
  siteId: number,
  personaId: number,
  captureId: number,
  sessionId: string,
): Promise<PersonaManagedLoginSession> {
  return apiGet<PersonaManagedLoginSession>(
    `/projects/${projectId}/sites/${siteId}/personas/${personaId}/login-captures/${captureId}/managed-session/${encodeURIComponent(sessionId)}`,
  );
}

export function saveProjectSitePersonaManagedLoginSession(
  projectId: number,
  siteId: number,
  personaId: number,
  captureId: number,
  input: { session_id: string; expires_at?: string | null; force?: boolean },
): Promise<PersonaLoginCaptureCompleteResult> {
  return apiPost<PersonaLoginCaptureCompleteResult>(
    `/projects/${projectId}/sites/${siteId}/personas/${personaId}/login-captures/${captureId}/managed-session/save`,
    input,
  );
}

export function cancelProjectSitePersonaManagedLoginSession(
  projectId: number,
  siteId: number,
  personaId: number,
  captureId: number,
  sessionId: string,
): Promise<PersonaManagedLoginSession> {
  return apiPost<PersonaManagedLoginSession>(
    `/projects/${projectId}/sites/${siteId}/personas/${personaId}/login-captures/${captureId}/managed-session/${encodeURIComponent(sessionId)}/cancel`,
    {},
  );
}

export function cancelProjectSitePersonaLoginCapture(
  projectId: number,
  siteId: number,
  personaId: number,
  captureId: number,
): Promise<PersonaLoginCapture> {
  return apiPost<PersonaLoginCapture>(`/projects/${projectId}/sites/${siteId}/personas/${personaId}/login-captures/${captureId}/cancel`, {});
}
