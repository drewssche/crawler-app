import { projectSiteSearchValues } from "./projectSitesSummary.ts";
import type { ProjectListSite } from "./projectListCache.ts";

export type ProjectSearchItem = {
  name: string;
  sites?: ProjectListSite[] | null;
  /** Compatibility fallback. Prefer sites[]. */
  start_url: string;
  /** Compatibility fallback. Do not use as user-facing site list. */
  allowed_domains_csv?: string | null;
};

export type ProjectSearchField = "name" | "site";

export type ProjectSearchResult<T extends ProjectSearchItem> = {
  project: T;
  matchedField: ProjectSearchField | null;
  matchedValue: string | null;
  highlightQuery: string;
  viaKeyboardLayout: boolean;
  rank: number;
};

const EN_LAYOUT = "qwertyuiop[]asdfghjkl;'zxcvbnm,./`";
const RU_LAYOUT = "йцукенгшщзхъфывапролджэячсмитьбю.ё";

function buildLayoutMap(source: string, target: string): Map<string, string> {
  return new Map(Array.from(source).map((char, index) => [char, target[index] || char]));
}

const EN_TO_RU = buildLayoutMap(EN_LAYOUT, RU_LAYOUT);
const RU_TO_EN = buildLayoutMap(RU_LAYOUT, EN_LAYOUT);

export function normalizeProjectSearchText(value: string): string {
  return (value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrlLike(value: string): string {
  return normalizeProjectSearchText(value)
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

function convertLayout(value: string, map: Map<string, string>): string {
  return Array.from(value, (char) => map.get(char) || char).join("");
}

export function isMeaningfulProjectSearch(query: string): boolean {
  return /[\p{L}\p{N}]/u.test(normalizeProjectSearchText(query));
}

type QueryVariant = {
  value: string;
  viaKeyboardLayout: boolean;
};

function buildQueryVariants(query: string): QueryVariant[] {
  const normalized = normalizeProjectSearchText(query);
  if (!isMeaningfulProjectSearch(normalized)) return [];

  const variants: QueryVariant[] = [{ value: normalized, viaKeyboardLayout: false }];
  for (const converted of [convertLayout(normalized, RU_TO_EN), convertLayout(normalized, EN_TO_RU)]) {
    if (converted !== normalized && isMeaningfulProjectSearch(converted) && !variants.some((item) => item.value === converted)) {
      variants.push({ value: converted, viaKeyboardLayout: true });
    }
  }
  return variants;
}

function matchQuality(source: string, query: string): number {
  if (!source || !query) return 0;
  if (source === query) return 400;
  if (source.startsWith(query)) return 300;

  const index = source.indexOf(query);
  if (index < 0) return 0;
  const previous = index > 0 ? source[index - 1] : "";
  if (index === 0 || /[\s./_-]/.test(previous)) return 250;
  return 200;
}

function fieldCandidates(project: ProjectSearchItem): Array<{
  field: ProjectSearchField;
  value: string;
  normalized: string;
}> {
  return [
    { field: "name", value: project.name, normalized: normalizeProjectSearchText(project.name) },
    ...projectSiteSearchValues(project).map((value) => ({
      field: "site" as const,
      value,
      normalized: normalizeUrlLike(value),
    })),
  ];
}

export function searchProjects<T extends ProjectSearchItem>(projects: T[], query: string): ProjectSearchResult<T>[] {
  const variants = buildQueryVariants(query);
  if (variants.length === 0) {
    return projects.map((project) => ({
      project,
      matchedField: null,
      matchedValue: null,
      highlightQuery: "",
      viaKeyboardLayout: false,
      rank: 0,
    }));
  }

  return projects
    .map((project, originalIndex) => {
      let best: Omit<ProjectSearchResult<T>, "project"> | null = null;
      for (const variant of variants) {
        const normalizedQuery = normalizeUrlLike(variant.value);
        for (const candidate of fieldCandidates(project)) {
          const quality = matchQuality(candidate.normalized, normalizedQuery);
          if (!quality) continue;
          const rank = (variant.viaKeyboardLayout ? 1_000 : 3_000) + quality;
          if (!best || rank > best.rank) {
            best = {
              matchedField: candidate.field,
              matchedValue: candidate.value,
              highlightQuery: normalizedQuery,
              viaKeyboardLayout: variant.viaKeyboardLayout,
              rank,
            };
          }
        }
      }
      return best ? { project, originalIndex, ...best } : null;
    })
    .filter((item): item is ProjectSearchResult<T> & { originalIndex: number } => item !== null)
    .sort((left, right) => right.rank - left.rank || left.originalIndex - right.originalIndex)
    .map((item) => ({
      project: item.project,
      matchedField: item.matchedField,
      matchedValue: item.matchedValue,
      highlightQuery: item.highlightQuery,
      viaKeyboardLayout: item.viaKeyboardLayout,
      rank: item.rank,
    }));
}

export function shouldShowProjectMatchHint(
  result: ProjectSearchResult<ProjectSearchItem>,
  visibleValues: Array<string | null | undefined>,
): boolean {
  if (!result.matchedValue || !result.highlightQuery) return false;
  const query = normalizeUrlLike(result.highlightQuery);
  return !visibleValues.some((value) => normalizeUrlLike(value || "").includes(query));
}
