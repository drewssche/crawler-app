export type MonitoringPrimaryChartKey = "http_requests" | "http_errors";

export type MonitoringPrimaryChartConfig = {
  key: MonitoringPrimaryChartKey;
  title: string;
  color: string;
  highlightKey: "http_requests" | "http_errors";
};

export type MonitoringStatusLevel = "ok" | "warn" | "crit";

export const MONITORING_PRIMARY_CHARTS: MonitoringPrimaryChartConfig[] = [
  { key: "http_requests", title: "HTTP запросы", color: "#78a8ff", highlightKey: "http_requests" },
  { key: "http_errors", title: "HTTP ошибки", color: "#f08f8f", highlightKey: "http_errors" },
];

export const MONITORING_STATUS_TOKENS: Record<MonitoringStatusLevel, { titleColor: string; borderColor: string }> = {
  ok: { titleColor: "#d8e9ff", borderColor: "rgba(120,168,255,0.45)" },
  warn: { titleColor: "#ffcf8a", borderColor: "rgba(255,207,138,0.45)" },
  crit: { titleColor: "#ff8f8f", borderColor: "rgba(255,143,143,0.45)" },
};

export function chartSeriesFromHistoryKey(key: MonitoringPrimaryChartKey): "http_requests" | "http_errors" {
  return key;
}

