export function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z0-9+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function deriveSiteName(rawUrl: string): string {
  try {
    return new URL(normalizeSiteUrl(rawUrl)).hostname || "Сайт";
  } catch {
    return "Сайт";
  }
}

export function normalizePathPrefix(raw: string): string {
  const parts = raw.trim().split("/").filter(Boolean);
  return parts.length ? `/${parts.join("/")}` : "/";
}

export function validateSiteDraft(
  startUrl: string,
  scopeMode: "whole_site" | "path_prefix",
  pathPrefix: string,
): string {
  const normalizedUrl = normalizeSiteUrl(startUrl);
  try {
    const url = new URL(normalizedUrl);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
      return "Укажите корректный адрес сайта.";
    }
  } catch {
    return "Укажите корректный адрес сайта.";
  }
  if (scopeMode === "path_prefix" && normalizePathPrefix(pathPrefix) === "/") {
    return "Укажите раздел, например /docs или /catalog.";
  }
  return "";
}
