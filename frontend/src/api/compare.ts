import { apiGet } from "./client";

export type CompareRun = {
  id: number;
  project_site_id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  pages_total: number;
};

export type ComparePageItem = {
  id: number;
  url: string;
  status_code: number;
  html_hash: string;
};

export type CompareSnapshot = {
  run_id: number;
  project_site_id: number;
  url: string;
  status_code: number;
  content_type: string;
  html: string;
  html_hash: string;
  meta: {
    title: string;
    description: string;
    canonical: string;
    robots: string;
    lang: string;
    viewport: string;
    headings: Array<{ level: number; text: string }>;
  };
  seo: { score: number; grade: string };
  links: { total: number; internal: number; external: number; known_broken: number };
  assets: {
    images: { total: number; missing_alt: number };
    scripts: { total: number };
    styles: { total: number };
  };
};

export function listCompareRuns(siteId: number): Promise<CompareRun[]> {
  return apiGet<CompareRun[]>(`/runs/by-site/${siteId}`);
}

export function listComparePages(runId: number): Promise<ComparePageItem[]> {
  return apiGet<ComparePageItem[]>(`/runs/${runId}/page-catalog`);
}

export function getCompareSnapshot(runId: number, url: string): Promise<CompareSnapshot> {
  return apiGet<CompareSnapshot>(`/runs/${runId}/snapshot?url=${encodeURIComponent(url)}`);
}
