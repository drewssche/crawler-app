import { apiGet } from "./client";

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
