import type { HistoryPoint, MetricItem } from "./types";

export function sumMetric(items?: MetricItem[]): number {
  if (!items?.length) return 0;
  return items.reduce((acc, item) => acc + Number(item.value || 0), 0);
}

export function latest(points?: HistoryPoint[]): number {
  if (!points?.length) return 0;
  return Number(points[points.length - 1]?.value || 0);
}

export function prev(points?: HistoryPoint[]): number {
  if (!points || points.length < 2) return 0;
  return Number(points[points.length - 2]?.value || 0);
}
