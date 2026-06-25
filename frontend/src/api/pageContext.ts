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

export type RetryPagesResult = {
  ok: boolean;
  run_id: number;
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
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
