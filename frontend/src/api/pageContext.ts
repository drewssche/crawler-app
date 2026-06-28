import { apiGet, apiPost } from "./client";

export type SeoChecklistItem = {
  key: string;
  label: string;
  status: "pass" | "warning" | "fail";
  message: string;
  weight: number;
  points: number;
};

export type PageContext = {
  page: {
    id: number;
    run_id: number;
    project_site_id: number;
    crawl_persona_id: number | null;
    persona: {
      id: number;
      key: string;
      label: string;
      kind: string;
      has_secrets: boolean;
    } | null;
    url: string;
    status_code: number;
    content_type: string;
    html_hash: string;
    final_url: string;
    final_status_code: number;
    fetch_error_code: string | null;
    fetch_error_message: string | null;
    response_time_ms: number | null;
    can_retry: boolean;
    retry_attempts: Array<{
      id: number;
      attempt_no: number;
      status: "SUCCEEDED" | "FAILED";
      started_at: string;
      finished_at: string;
      status_code: number | null;
      final_url: string | null;
      final_status_code: number | null;
      fetch_error_code: string | null;
      fetch_error_message: string | null;
      response_time_ms: number | null;
    }>;
    redirect: {
      status_code: number;
      target_url: string;
      hops: number;
      explanation: string;
      chain: Array<{ url: string; status_code: number; location: string | null }>;
    } | null;
  };
  meta: {
    title: string;
    description: string;
    canonical: string;
    robots: string;
    lang: string;
    viewport: string;
    headings: Array<{ level: number; text: string }>;
  };
  links: {
    total: number;
    internal: number;
    external: number;
    known_broken: number;
    items: Array<{
      url: string;
      text: string;
      internal: boolean;
      known_status: number | null;
      broken: boolean;
    }>;
  };
  assets: {
    images: {
      total: number;
      missing_alt: number;
      items: Array<{ url: string; alt: string | null; missing_alt: boolean }>;
    };
    scripts: { total: number; items: string[] };
    styles: { total: number; items: string[] };
  };
  tracking: {
    scripts: {
      total: number;
      recognized: number;
      items: Array<{
        source: string | null;
        inline: boolean;
        provider: string;
        purpose: string;
        identifiers: Array<{
          provider_key: string;
          provider: string;
          type: string;
          id: string;
        }>;
        consent_state: "blocked_until_consent" | "present_in_saved_html";
        consent_explanation: string;
      }>;
    };
    identifiers: Array<{
      provider_key: string;
      provider: string;
      type: string;
      id: string;
      sources: string[];
    }>;
    cookies: {
      names: string[];
      total: number;
      values_exposed: false;
      explanation: string;
    };
    consent: {
      frameworks: string[];
      runtime_audit: "not_run";
      explanation: string;
    };
  };
  seo: {
    score: number;
    grade: "good" | "needs_work" | "poor";
    checklist: SeoChecklistItem[];
    disclaimer: string;
  };
};

export function getPageContext(runId: number, url: string): Promise<PageContext> {
  return apiGet<PageContext>(`/runs/${runId}/page-context?url=${encodeURIComponent(url)}`);
}

export type ConsentAuditResult = {
  runtime_audit: "completed";
  audited_at: string;
  source: "stored_html_live_scripts";
  before_consent: {
    cookies: string[];
    requests: {
      total: number;
      script: number;
      xhr_fetch: number;
      tracking_providers: string[];
      sample: string[];
    };
  };
  after_consent: {
    attempted: boolean;
    action_label: string;
    cookies: string[];
    new_cookies: string[];
    requests: {
      total: number;
      script: number;
      xhr_fetch: number;
      tracking_providers: string[];
      sample: string[];
    };
    new_tracking_providers: string[];
  };
  consent_action: {
    clicked: boolean;
    label: string;
    explanation: string;
  };
  values_exposed: false;
  explanation: string;
};

export function createConsentAudit(runId: number, url: string): Promise<ConsentAuditResult> {
  return apiPost<ConsentAuditResult>(`/runs/${runId}/consent-audit?url=${encodeURIComponent(url)}`, {});
}

export type RetryPagesResult = {
  ok: boolean;
  run_id: number;
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  crawl_persona_id?: number | null;
  persona?: {
    id: number;
    key: string;
    label: string;
    kind: string;
  } | null;
  persona_label?: string | null;
  session_required?: boolean;
  session_status?: string;
  session_message?: string;
  message: string;
  results: Array<{
    page_id: number;
    url: string;
    status: "SUCCEEDED" | "FAILED" | "SKIPPED";
    attempt_no: number;
    status_code?: number | null;
    final_url?: string | null;
    final_status_code?: number | null;
    fetch_error_code?: string | null;
    fetch_error_message?: string | null;
    response_time_ms?: number | null;
    message?: string;
  }>;
};

export function retryProblemPages(runId: number, urls?: string[]): Promise<RetryPagesResult> {
  return apiPost<RetryPagesResult>(`/runs/${runId}/retry-pages`, urls ? { urls } : {});
}
