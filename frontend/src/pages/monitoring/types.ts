export type MetricItem = { labels: Record<string, string>; value: number };
export type MetricsResponse = { counters: Record<string, MetricItem[]> };
export type HistoryPoint = { ts: number; value: number };
export type Group = "http" | "events" | "service";

export type MonitoringHistoryResponse = {
  enabled: boolean;
  source: string;
  range_minutes: number;
  step_seconds: number;
  series: Record<string, HistoryPoint[]>;
  error?: string;
};

export type MonitoringSettings = {
  warn_error_delta: number;
  warn_error_rate: number;
  crit_error_delta: number;
  crit_error_rate: number;
};

export type FocusHistoryResponse = {
  enabled: boolean;
  source: string;
  query: string;
  series: HistoryPoint[];
  error?: string;
};

export type HighlightKey =
  | "summary"
  | "http_requests"
  | "http_errors"
  | "table"
  | null;
