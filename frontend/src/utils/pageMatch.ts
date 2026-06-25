import type { ComparePageItem } from "../api/compare";

export type PageMatchSuggestion = {
  page: ComparePageItem;
  confidence: "high" | "medium";
  reason: string;
};

export function normalizedRelativePath(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    let path = decodeURIComponent(url.pathname)
      .replace(/\/{2,}/g, "/")
      .replace(/\/(?:index\.(?:html?|php))$/i, "/");
    if (!path.startsWith("/")) path = `/${path}`;
    if (path !== "/" && path.endsWith("/")) path = path.slice(0, -1);
    return path.toLowerCase() || "/";
  } catch {
    return "/";
  }
}

export function suggestPageMatch(
  sourceUrl: string,
  candidates: ComparePageItem[],
): PageMatchSuggestion | null {
  if (!sourceUrl || candidates.length === 0) return null;
  const sourcePath = normalizedRelativePath(sourceUrl);
  const exact = candidates.find((candidate) => normalizedRelativePath(candidate.url) === sourcePath);
  if (exact) {
    return {
      page: exact,
      confidence: "high",
      reason: `Совпадает относительный путь ${sourcePath}`,
    };
  }

  const sourceSegments = sourcePath.split("/").filter(Boolean);
  const sourceTail = sourceSegments.slice(-2).join("/");
  if (!sourceTail) return null;
  const tailMatches = candidates.filter((candidate) => {
    const candidatePath = normalizedRelativePath(candidate.url);
    return candidatePath.split("/").filter(Boolean).slice(-2).join("/") === sourceTail;
  });
  if (tailMatches.length === 1) {
    return {
      page: tailMatches[0],
      confidence: "medium",
      reason: `Совпадают последние сегменты пути: ${sourceTail}`,
    };
  }
  return null;
}
