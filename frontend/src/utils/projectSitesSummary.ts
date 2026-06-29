import type { ProjectListSite } from "./projectListCache.ts";

export type ProjectSitesSummarySource = {
  sites?: ProjectListSite[] | null;
  site_count?: number | null;
  start_url?: string | null;
};

function hostnameFromUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname || null;
  } catch {
    return trimmed.replace(/^\s*[a-z][a-z0-9+\-.]*:\/\//i, "").split(/[/?#]/, 1)[0] || null;
  }
}

function siteDisplayName(site: ProjectListSite): string {
  const host = hostnameFromUrl(site.start_url);
  if (host) return host;
  return site.name || site.start_url;
}

export function summarizeProjectSites(project: ProjectSitesSummarySource): string {
  const sites = project.sites || [];
  if (sites.length > 0) {
    const first = siteDisplayName(sites[0]);
    if (sites.length === 1) return first;
    return `${first} +${sites.length - 1} сайт(а)`;
  }
  const fallback = hostnameFromUrl(project.start_url || "");
  return fallback || "сайты не заданы";
}

export function projectSiteSearchValues(project: ProjectSitesSummarySource): string[] {
  const sites = project.sites || [];
  if (sites.length > 0) {
    return sites.flatMap((site) => [site.name, site.start_url, siteDisplayName(site)]).filter(Boolean);
  }
  return [project.start_url || ""].filter(Boolean);
}
