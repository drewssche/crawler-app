import { apiGet } from "../api/client";
import type { EventItem } from "../api/events";
import { eventTimestampFromMetaOrCreatedAt } from "./eventTime";

export type HistoryPoint = { ts: number; value: number };

export type FocusHistoryResponse = {
  enabled: boolean;
  source: string;
  query: string;
  series: HistoryPoint[];
  error?: string;
};

type MetricItem = { labels: Record<string, string>; value: number };
type MetricsResponse = { counters: Record<string, MetricItem[]> };

export type MonitoringErrorRow = { labels: string; value: number };

export function buildSparkPath(values: number[], w: number, h: number): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 8) + 4;
      const y = h - 8 - ((v - min) / span) * (h - 16);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function computeMarkerX(
  points: HistoryPoint[],
  eventTs: number,
  w: number,
): { x: number; outOfRange: "left" | "right" | null } | null {
  if (!points.length) return null;
  const minTs = points[0].ts;
  const maxTs = points[points.length - 1].ts;
  if (!Number.isFinite(eventTs) || maxTs <= minTs) return null;
  const outOfRange = eventTs < minTs ? "left" : eventTs > maxTs ? "right" : null;
  const clamped = Math.max(minTs, Math.min(maxTs, eventTs));
  const ratio = (clamped - minTs) / (maxTs - minTs);
  return { x: ratio * (w - 8) + 4, outOfRange };
}

export function monitoringRecommendation(item: EventItem): { title: string; why: string; actions: string[] } {
  const body = (item.body || "").toLowerCase();
  const sev = (item.severity || "").toLowerCase();

  if (body.includes("invalid_code")) {
    return {
      title: "Проверьте возможную brute-force активность",
      why: "Зафиксирован всплеск invalid_code.",
      actions: [
        "Проверьте подозрительные IP и частоту попыток.",
        "Усилите rate-limit и временно увеличьте cooldown.",
        "Проверьте блокировки по пользователям с частыми ошибками кода.",
      ],
    };
  }

  if (sev === "danger") {
    return {
      title: "Критический инцидент: реагировать немедленно",
      why: "Порог критичности по ошибкам превышен.",
      actions: [
        "Откройте источник и проверьте endpoint с максимальным вкладом в ошибки.",
        "Оцените необходимость rollback/ограничения трафика.",
        "Проверьте последние изменения в релизе и инфраструктуре.",
      ],
    };
  }

  return {
    title: "Рост ошибок: требуется проверка",
    why: "Рост ошибок выше ожидаемого уровня.",
    actions: [
      "Откройте источник и проверьте проблемный endpoint.",
      "Сравните текущие ошибки с моментом события.",
      "Проверьте, не растет ли error-rate в динамике.",
    ],
  };
}

export function getMonitoringFocusMeta(item: EventItem): { isMonitoring: boolean; focusMetric: string; focusPath: string } {
  const focusMetric = typeof item.meta?.focus_metric === "string" ? item.meta.focus_metric : "";
  const focusPath = typeof item.meta?.focus_path === "string" ? item.meta.focus_path : "";
  const isMonitoring = item.event_type === "monitoring.anomaly" || Boolean(focusMetric);
  return { isMonitoring, focusMetric, focusPath };
}

export async function loadMonitoringContext(item: EventItem): Promise<{
  history: FocusHistoryResponse;
  errorRows: MonitoringErrorRow[];
  rangeMinutes: number;
}> {
  const { focusMetric, focusPath } = getMonitoringFocusMeta(item);
  const metricName = focusMetric || "http_errors_total";
  const markerTs = eventTimestampFromMetaOrCreatedAt(item.meta || null, item.created_at);

  const fetchHistory = async (rangeMinutes: number, usePath: boolean) => {
    const qp = new URLSearchParams({
      metric_name: metricName,
      range_minutes: String(rangeMinutes),
      step_seconds: "30",
    });
    if (usePath && focusPath) qp.set("metric_path", focusPath);
    return apiGet<FocusHistoryResponse>(`/admin/monitoring/history/focus?${qp.toString()}`);
  };

  const ranges = [60, 1440, 10080];
  let selectedRange = ranges[0];
  let usePath = Boolean(focusPath);
  let history = await fetchHistory(selectedRange, usePath);

  for (let i = 1; i < ranges.length && history.series.length < 2; i += 1) {
    selectedRange = ranges[i];
    history = await fetchHistory(selectedRange, usePath);
  }

  if (history.series.length < 2 && usePath) {
    usePath = false;
    selectedRange = ranges[0];
    history = await fetchHistory(selectedRange, usePath);
    for (let i = 1; i < ranges.length && history.series.length < 2; i += 1) {
      selectedRange = ranges[i];
      history = await fetchHistory(selectedRange, usePath);
    }
  }

  if (markerTs && history.series.length >= 2) {
    const marker = computeMarkerX(history.series, markerTs, 280);
    if (marker?.outOfRange === "left" && selectedRange < 1440) {
      selectedRange = 1440;
      history = await fetchHistory(selectedRange, usePath);
    }
  }

  const metrics = await apiGet<MetricsResponse>("/metrics");
  const rows = (metrics.counters?.http_errors_total || [])
    .map((entry) => ({
      labels:
        Object.keys(entry.labels || {}).length > 0
          ? Object.entries(entry.labels)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")
          : "-",
      value: Number(entry.value || 0),
      path: entry.labels?.path || "",
    }))
    .filter((x) => !usePath || x.path === focusPath)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .map(({ labels, value }) => ({ labels, value }));

  return { history, errorRows: rows, rangeMinutes: selectedRange };
}
