import { apiDownload, apiGet, apiPost } from "./client";

export type RenderedSnapshotMetadata = {
  available: boolean;
  capture_source: "stored_html_live_assets" | "browser_persona_run";
  captured_at?: string;
  width?: number;
  height?: number;
  full_height?: number;
  clipped?: boolean;
  mime_type?: string;
  element_map?: {
    version: number;
    items_total: number;
    items_truncated: boolean;
    coordinate_space: "rendered_snapshot_pixels";
    items: RenderedSnapshotElement[];
  };
  explanation: string;
};

export type RenderedSnapshotElement = {
  tag: string;
  id: string;
  className: string;
  selector: string;
  text: string;
  outerHTML: string;
  rect: { x: number; y: number; width: number; height: number };
};

export type CompareRun = {
  id: number;
  project_site_id: number;
  crawl_persona_id?: number | null;
  persona?: {
    id: number;
    key: string;
    label: string;
    kind: string;
    has_secrets?: boolean;
  } | null;
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
  title?: string;
};

export type CompareSnapshot = {
  run_id: number;
  project_site_id: number;
  crawl_persona_id?: number | null;
  persona?: CompareRun["persona"];
  url: string;
  status_code: number;
  content_type: string;
  html: string;
  html_hash: string;
  rendered_snapshot: RenderedSnapshotMetadata;
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

export function createRenderedSnapshot(runId: number, url: string): Promise<RenderedSnapshotMetadata> {
  return apiPost<RenderedSnapshotMetadata>(
    `/runs/${runId}/rendered-snapshot?url=${encodeURIComponent(url)}`,
    {},
  );
}

export function downloadRenderedSnapshot(runId: number, url: string): Promise<Blob> {
  return apiDownload(`/runs/${runId}/rendered-snapshot?url=${encodeURIComponent(url)}`);
}
