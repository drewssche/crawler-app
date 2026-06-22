function stripScheme(value: string): string {
  return value.replace(/^\s*[a-z][a-z0-9+\-.]*:\/\//i, "");
}

export function normalizeProjectDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  let hostname = "";
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    hostname = (url.hostname || "").trim().toLowerCase();
  } catch {
    hostname = stripScheme(trimmed).split(/[/?#]/, 1)[0].trim().toLowerCase();
  }

  if (!hostname) return null;
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (!hostname) return null;

  // Require at least one dot and a conservative ASCII hostname contract for MVP.
  const hostRe = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!hostRe.test(hostname)) return null;
  return hostname;
}

export function parseProjectDomainsInput(raw: string): { domains: string[]; invalid: string[] } {
  const parts = raw
    .split(/[\n,;\t ]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const domains: string[] = [];
  const seen = new Set<string>();
  const invalid: string[] = [];

  for (const part of parts) {
    const normalized = normalizeProjectDomain(part);
    if (!normalized) {
      invalid.push(part);
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    domains.push(normalized);
  }

  return { domains, invalid };
}

export function deriveProjectName(domains: string[]): string {
  if (domains.length <= 0) return "Проект";
  if (domains.length === 1) return domains[0];
  return `${domains[0]} + ${domains.length - 1}`;
}

export function domainToStartUrl(domain: string): string {
  return `https://${domain}`;
}

export function splitProjectDomainsCsv(csv: string | null | undefined): string[] {
  return (csv || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

export function summarizeProjectDomains(csv: string | null | undefined, fallbackUrl?: string | null): string {
  const domains = splitProjectDomainsCsv(csv);
  if (domains.length <= 0) {
    const raw = (fallbackUrl || "").trim();
    if (!raw) return "домен не задан";
    const normalized = normalizeProjectDomain(raw);
    return normalized || raw;
  }
  if (domains.length === 1) return domains[0];
  return `${domains[0]} +${domains.length - 1}`;
}
