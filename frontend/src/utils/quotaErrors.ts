import { ApiError } from "../api/client";

type QuotaDetails = {
  code?: string;
  quota?: string;
  limit?: number;
  current?: number;
  requested?: number;
  message?: string;
};

const QUOTA_LABELS: Record<string, string> = {
  max_projects: "проектов",
  max_sites_per_project: "сайтов в проекте",
  max_pages_per_site: "страниц для одного сайта",
  max_concurrency_per_site: "параллельных запросов для одного сайта",
  max_active_jobs_per_user: "активных задач crawler",
  max_bulk_sites_per_run: "сайтов в одном общем запуске",
};

const QUOTA_ACTIONS: Record<string, string> = {
  max_projects: "Удалите ненужный проект или попросите администратора увеличить лимит роли.",
  max_sites_per_project: "Отключите или удалите лишний сайт либо попросите администратора увеличить лимит роли.",
  max_pages_per_site: "Уменьшите лимит страниц в настройках сайта.",
  max_concurrency_per_site: "Уменьшите параллельность в настройках сайта.",
  max_active_jobs_per_user: "Дождитесь завершения текущих задач или отмените лишние прогоны.",
  max_bulk_sites_per_run: "Запустите сайты частями или попросите администратора увеличить лимит роли.",
};

function asQuotaDetails(value: unknown): QuotaDetails | null {
  if (!value || typeof value !== "object") return null;
  const details = value as QuotaDetails;
  return details.code === "quota_exceeded" && typeof details.quota === "string" ? details : null;
}

function formatNumber(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "не задан";
}

export function isQuotaError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === "quota_exceeded" && asQuotaDetails(error.details) !== null;
}

export function formatQuotaError(error: unknown, fallback = "Действие упёрлось в лимит роли."): string {
  if (!isQuotaError(error)) return error instanceof Error ? error.message : fallback;
  const details = asQuotaDetails(error.details);
  if (!details) return error.message || fallback;

  const label = QUOTA_LABELS[details.quota || ""] || "ресурсов";
  const action = QUOTA_ACTIONS[details.quota || ""] || "Измените параметры или обратитесь к администратору.";
  const parts = [
    `Достигнут лимит: ${label}.`,
    `Лимит: ${formatNumber(details.limit)}.`,
  ];
  if (typeof details.current === "number") parts.push(`Сейчас: ${details.current}.`);
  if (typeof details.requested === "number" && details.requested > 1) parts.push(`Запрошено: ${details.requested}.`);
  parts.push(action);
  return parts.join(" ");
}
