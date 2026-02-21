import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiGet, apiPost, isAbortError } from "../api/client";
import { downloadBlobFile } from "../utils/download";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import ClearableInput from "../components/ui/ClearableInput";
import EmptyState from "../components/ui/EmptyState";
import SegmentedControl from "../components/ui/SegmentedControl";
import UiSelect from "../components/ui/UiSelect";
import { useWorkspaceInfiniteScroll } from "../hooks/useWorkspaceInfiniteScroll";

type MetricItem = { labels: Record<string, string>; value: number };
type MetricsResponse = { counters: Record<string, MetricItem[]> };
type HistoryPoint = { ts: number; value: number };
type Group = "all" | "http" | "auth" | "admin" | "events";
type HistoryRange = 15 | 60 | 360 | 1440;

type MonitoringHistoryResponse = {
  enabled: boolean;
  source: string;
  range_minutes: number;
  step_seconds: number;
  series: Record<string, HistoryPoint[]>;
  error?: string;
};

type MonitoringSettings = {
  warn_error_delta: number;
  warn_error_rate: number;
  crit_error_delta: number;
  crit_error_rate: number;
};

type FocusHistoryResponse = {
  enabled: boolean;
  source: string;
  query: string;
  series: HistoryPoint[];
  error?: string;
};

type HighlightKey =
  | "summary"
  | "http_requests"
  | "http_errors"
  | "auth_starts"
  | "admin_actions"
  | "events_center"
  | "table"
  | "top_endpoints"
  | null;

const AUTO_REFRESH_MS = 15000;
const BASE_ROWS = 20;
const PROMETHEUS_UI_URL = String(import.meta.env.VITE_PROMETHEUS_UI_URL ?? "http://localhost:9090").trim();
const GRAFANA_UI_URL = String(import.meta.env.VITE_GRAFANA_UI_URL ?? "http://localhost:3000").trim();

const METRIC_DESCRIPTIONS: Record<string, string> = {
  http_requests_total: "Количество HTTP-запросов к API.",
  http_errors_total: "Количество HTTP-ошибок (4xx/5xx).",
  auth_start_total: "Количество стартов авторизации.",
  auth_verify_total: "Количество проверок одноразового кода.",
  auth_request_access_total: "Количество заявок на доступ.",
  admin_bulk_total: "Количество массовых admin-операций.",
  admin_action_total: "Количество единичных admin-действий.",
  events_center_total: "Количество загрузок центра событий.",
  events_feed_total: "Количество загрузок полной ленты событий.",
  events_read_total: "Изменения статуса прочитанности событий.",
  events_dismiss_total: "Изменения статуса скрытия событий.",
};

function sumMetric(items?: MetricItem[]): number {
  if (!items?.length) return 0;
  return items.reduce((acc, item) => acc + Number(item.value || 0), 0);
}

function latest(points?: HistoryPoint[]): number {
  if (!points?.length) return 0;
  return Number(points[points.length - 1]?.value || 0);
}

function prev(points?: HistoryPoint[]): number {
  if (!points || points.length < 2) return 0;
  return Number(points[points.length - 2]?.value || 0);
}

function pct(total: number, part: number): string {
  if (!total) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function highlightStyle(active: boolean) {
  return active
    ? { borderColor: "rgba(106,160,255,0.72)", boxShadow: "0 0 0 2px rgba(106,160,255,0.2)" }
    : {};
}

function buildPath(values: number[], w: number, h: number): string {
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

function SmallHistoryCard({
  title,
  points,
  color,
  highlighted,
}: {
  title: string;
  points?: HistoryPoint[];
  color: string;
  highlighted?: boolean;
}) {
  const values = (points || []).map((p) => Number(p.value || 0));
  const current = values.length ? values[values.length - 1] : 0;
  const delta = values.length > 1 ? values[values.length - 1] - values[0] : 0;
  const path = buildPath(values, 280, 84);

  return (
    <Card style={highlightStyle(Boolean(highlighted))}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>текущее: {current.toFixed(0)}</div>
      </div>
      {values.length < 2 ? (
        <div style={{ fontSize: 13, opacity: 0.75, marginTop: 8 }}>Недостаточно данных для графика.</div>
      ) : (
        <>
          <div style={{ marginTop: 6 }}>
            <svg width="100%" height="84" viewBox="0 0 280 84" preserveAspectRatio="none">
              <path d={path} fill="none" stroke={color} strokeWidth="2" />
            </svg>
          </div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Δ: {delta >= 0 ? "+" : ""}{delta.toFixed(0)}</div>
        </>
      )}
    </Card>
  );
}

function BigChart({
  title,
  points,
  color,
  highlighted,
}: {
  title: string;
  points?: HistoryPoint[];
  color: string;
  highlighted?: boolean;
}) {
  const values = (points || []).map((p) => Number(p.value || 0));
  const w = 620;
  const h = 180;
  if (values.length < 2) {
    return (
      <Card style={highlightStyle(Boolean(highlighted))}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 13, opacity: 0.75 }}>Недостаточно данных для графика.</div>
      </Card>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const mid = min + (max - min) / 2;
  const span = Math.max(1, max - min);
  const pointsData = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 80) + 50;
      const y = h - 20 - ((v - min) / span) * (h - 40);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const ticks = [max, mid, min];
  const t1 = new Date((points?.[0]?.ts || 0) * 1000).toLocaleTimeString("ru-RU");
  const t2 = new Date((points?.[points.length - 1]?.ts || 0) * 1000).toLocaleTimeString("ru-RU");
  const d = values[values.length - 1] - values[0];
  const y = (v: number) => h - 20 - ((v - min) / span) * (h - 40);

  return (
    <Card style={highlightStyle(Boolean(highlighted))}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          min: {min.toFixed(0)} | max: {max.toFixed(0)} | Δ: {d >= 0 ? "+" : ""}
          {d.toFixed(0)}
        </div>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={50} y1={y(tick)} x2={w - 10} y2={y(tick)} stroke="#3335" strokeWidth="1" />
            <text x={4} y={y(tick) + 4} fill="#bbb" fontSize="11">
              {tick.toFixed(0)}
            </text>
          </g>
        ))}
        <line x1={50} y1={20} x2={50} y2={h - 20} stroke="#3337" strokeWidth="1" />
        <path d={pointsData} fill="none" stroke={color} strokeWidth="2.2" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.7 }}>
        <span>{t1}</span>
        <span>{t2}</span>
      </div>
    </Card>
  );
}

export default function MonitoringPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const [metrics, setMetrics] = useState<Record<string, MetricItem[]>>({});
  const [history, setHistory] = useState<MonitoringHistoryResponse | null>(null);
  const [settings, setSettings] = useState<MonitoringSettings | null>(null);
  const [focusHistory, setFocusHistory] = useState<FocusHistoryResponse | null>(null);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [editingThresholds, setEditingThresholds] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showServiceCharts, setShowServiceCharts] = useState(false);

  const [group, setGroup] = useState<Group>((params.get("group") as Group) || "all");
  const [query, setQuery] = useState(params.get("query") || "");
  const [historyRange, setHistoryRange] = useState<HistoryRange>(60);
  const [rowsVisible, setRowsVisible] = useState(BASE_ROWS);
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");
  const tableCardRef = useRef<HTMLDivElement | null>(null);
  const metricsAbortRef = useRef<AbortController | null>(null);
  const settingsAbortRef = useRef<AbortController | null>(null);
  const focusAbortRef = useRef<AbortController | null>(null);

  const highlightKey = (params.get("highlight_key") as HighlightKey) || null;
  const focusMetric = params.get("focus_metric") || "";
  const focusPath = params.get("focus_path") || "";
  const hasEventContext = Boolean(highlightKey || focusMetric || focusPath);

  function clearEventContext() {
    setGroup("all");
    setQuery("");
    navigate("/monitoring", { replace: true });
  }

  function focusOnMetric(nextGroup: Group, metricName: string) {
    setGroup(nextGroup);
    setQuery(metricName);
    tableCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const loadMetricsHistory = useCallback(async () => {
    metricsAbortRef.current?.abort();
    const controller = new AbortController();
    metricsAbortRef.current = controller;
    setError("");
    try {
      const [m, h] = await Promise.all([
        apiGet<MetricsResponse>("/metrics", { signal: controller.signal }),
        apiGet<MonitoringHistoryResponse>(`/admin/monitoring/history?range_minutes=${historyRange}&step_seconds=30`, { signal: controller.signal }),
      ]);
      if (metricsAbortRef.current !== controller) return;
      setMetrics(m.counters || {});
      setHistory(h);
      setLastUpdated(new Date().toLocaleTimeString("ru-RU"));
    } catch (e) {
      if (isAbortError(e)) return;
      setError(String(e));
    } finally {
      if (metricsAbortRef.current === controller) {
        metricsAbortRef.current = null;
      }
    }
  }, [historyRange]);

  const loadSettings = useCallback(async () => {
    settingsAbortRef.current?.abort();
    const controller = new AbortController();
    settingsAbortRef.current = controller;
    setError("");
    try {
      const s = await apiGet<MonitoringSettings>("/admin/monitoring/settings", { signal: controller.signal });
      if (settingsAbortRef.current !== controller) return;
      setSettings(s);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(String(e));
    } finally {
      if (settingsAbortRef.current === controller) {
        settingsAbortRef.current = null;
      }
    }
  }, []);

  const loadFocus = useCallback(async () => {
    if (!focusMetric) {
      focusAbortRef.current?.abort();
      focusAbortRef.current = null;
      setFocusHistory(null);
      return;
    }
    focusAbortRef.current?.abort();
    const controller = new AbortController();
    focusAbortRef.current = controller;
    try {
      const qp = new URLSearchParams({ metric_name: focusMetric, range_minutes: String(historyRange), step_seconds: "30" });
      if (focusPath) qp.set("metric_path", focusPath);
      const data = await apiGet<FocusHistoryResponse>(`/admin/monitoring/history/focus?${qp.toString()}`, { signal: controller.signal });
      if (focusAbortRef.current !== controller) return;
      setFocusHistory(data);
    } catch (e) {
      if (isAbortError(e)) return;
      setFocusHistory(null);
    } finally {
      if (focusAbortRef.current === controller) {
        focusAbortRef.current = null;
      }
    }
  }, [focusMetric, focusPath, historyRange]);

  useEffect(() => {
    loadMetricsHistory();
    loadSettings();
  }, [loadMetricsHistory, loadSettings]);

  useEffect(() => {
    loadFocus();
  }, [loadFocus]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadMetricsHistory();
      if (focusMetric) {
        loadFocus();
      }
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [focusMetric, loadFocus, loadMetricsHistory]);

  useEffect(() => {
    return () => {
      metricsAbortRef.current?.abort();
      settingsAbortRef.current?.abort();
      focusAbortRef.current?.abort();
      metricsAbortRef.current = null;
      settingsAbortRef.current = null;
      focusAbortRef.current = null;
    };
  }, []);

  const kpi = useMemo(
    () => ({
      req: sumMetric(metrics.http_requests_total),
      err: sumMetric(metrics.http_errors_total),
      auth: sumMetric(metrics.auth_start_total),
      admin: sumMetric(metrics.admin_action_total),
    }),
    [metrics],
  );

  const summary = useMemo(() => {
    const reqDelta = Math.max(0, latest(history?.series?.http_requests) - prev(history?.series?.http_requests));
    const errDelta = Math.max(0, latest(history?.series?.http_errors) - prev(history?.series?.http_errors));
    const invalid = latest(history?.series?.invalid_code);
    const rate = reqDelta > 0 ? (errDelta / reqDelta) * 100 : 0;
    const warnDelta = settings?.warn_error_delta ?? 1;
    const warnRate = settings?.warn_error_rate ?? 3;
    const critDelta = settings?.crit_error_delta ?? 3;
    const critRate = settings?.crit_error_rate ?? 10;

    let level: "ok" | "warn" | "crit" = "ok";
    let title = "Стабильно";
    if (errDelta >= critDelta || rate >= critRate) {
      level = "crit";
      title = "Критично";
    } else if (errDelta >= warnDelta || rate >= warnRate) {
      level = "warn";
      title = "Внимание";
    }

    return { level, title, reqDelta, errDelta, invalid, rate };
  }, [history, settings]);

  async function saveThresholds() {
    if (!settings) return;
    setError("");
    try {
      const updated = await apiPost<MonitoringSettings>("/admin/monitoring/settings", settings);
      setSettings(updated);
      setEditingThresholds(false);
      await loadMetricsHistory();
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshMonitoring() {
    await loadMetricsHistory();
    if (focusMetric) {
      await loadFocus();
    }
  }

  async function exportMetrics() {
    try {
      const qp = new URLSearchParams({ group, query });
      const ext = exportFormat;
      const url = `/metrics/export.${ext}?${qp.toString()}`;
      await downloadBlobFile(url, `metrics.${ext}`);
    } catch (e) {
      setError(String(e));
    }
  }

  const selectedNames = useMemo(() => {
    const names = Object.keys(metrics).sort();
    if (group === "all") return names;
    return names.filter((n) => n.startsWith(`${group}_`));
  }, [group, metrics]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return selectedNames
      .flatMap((name) =>
        (metrics[name] || []).map((entry, index) => ({
          id: `${name}-${index}`,
          name,
          description: METRIC_DESCRIPTIONS[name] || "Служебная метрика.",
          labels:
            Object.keys(entry.labels || {}).length > 0
              ? Object.entries(entry.labels)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(", ")
              : "-",
          value: Number(entry.value || 0),
        })),
      )
      .filter((row) => !q || `${row.name} ${row.labels} ${row.description}`.toLowerCase().includes(q))
      .sort((a, b) => b.value - a.value);
  }, [metrics, query, selectedNames]);

  useEffect(() => {
    setRowsVisible(BASE_ROWS);
  }, [group, query, metrics]);

  const visibleRows = useMemo(() => rows.slice(0, rowsVisible), [rows, rowsVisible]);

  useWorkspaceInfiniteScroll({
    canLoadMore: rowsVisible < rows.length,
    isLoading: false,
    onLoadMore: () => {
      setRowsVisible((v) => Math.min(v + BASE_ROWS, rows.length));
    },
    contentKey: `${rowsVisible}:${rows.length}`,
  });

  const topEndpoints = useMemo(
    () =>
      (metrics.http_requests_total || [])
        .map((r) => ({
          method: r.labels?.method || "-",
          path: r.labels?.path || "-",
          status: r.labels?.status || "-",
          value: Number(r.value || 0),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
    [metrics],
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <h2 style={{ marginTop: 0, marginBottom: 4 }}>Мониторинг</h2>
      </div>

      <Card style={highlightStyle(highlightKey === "summary")}>
        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr auto auto", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: summary.level === "crit" ? "#ff8f8f" : summary.level === "warn" ? "#ffcf8a" : "#d8e9ff" }}>
            {summary.title}
          </div>
          <div style={{ opacity: 0.85, fontSize: 13 }}>
            за последнее обновление: errors +{summary.errDelta.toFixed(0)}, requests +{summary.reqDelta.toFixed(0)}, error-rate {summary.rate.toFixed(1)}%
          </div>
          <div style={{ opacity: 0.85, fontSize: 13 }}>invalid_code total: {summary.invalid.toFixed(0)}</div>
          <Button onClick={() => setEditingThresholds((v) => !v)}>
            {editingThresholds ? "Скрыть пороги" : "Настроить пороги"}
          </Button>
        </div>

        {editingThresholds && settings && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(140px, 1fr)) auto", gap: 8, alignItems: "end" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>warn: delta</span>
              <input type="number" min={0} step={0.1} value={settings.warn_error_delta} onChange={(e) => setSettings((p) => (p ? { ...p, warn_error_delta: Number(e.target.value) } : p))} style={{ padding: "8px 10px", borderRadius: 10 }} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>warn: rate %</span>
              <input type="number" min={0} step={0.1} value={settings.warn_error_rate} onChange={(e) => setSettings((p) => (p ? { ...p, warn_error_rate: Number(e.target.value) } : p))} style={{ padding: "8px 10px", borderRadius: 10 }} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>crit: delta</span>
              <input type="number" min={0} step={0.1} value={settings.crit_error_delta} onChange={(e) => setSettings((p) => (p ? { ...p, crit_error_delta: Number(e.target.value) } : p))} style={{ padding: "8px 10px", borderRadius: 10 }} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>crit: rate %</span>
              <input type="number" min={0} step={0.1} value={settings.crit_error_rate} onChange={(e) => setSettings((p) => (p ? { ...p, crit_error_rate: Number(e.target.value) } : p))} style={{ padding: "8px 10px", borderRadius: 10 }} />
            </label>
            <Button onClick={saveThresholds} variant="primary">
              Сохранить
            </Button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginTop: 10 }}>
          <Card className="interactive-row" style={{ ...highlightStyle(highlightKey === "http_requests"), cursor: "pointer" }} onClick={() => focusOnMetric("http", "http_requests_total")}><div style={{ fontSize: 12, opacity: 0.75 }}>HTTP запросы</div><div style={{ fontSize: 30, fontWeight: 700 }}>{kpi.req}</div></Card>
          <Card className="interactive-row" style={{ ...highlightStyle(highlightKey === "http_errors"), cursor: "pointer" }} onClick={() => focusOnMetric("http", "http_errors_total")}><div style={{ fontSize: 12, opacity: 0.75 }}>HTTP ошибки</div><div style={{ fontSize: 30, fontWeight: 700 }}>{kpi.err}</div></Card>
          <Card className="interactive-row" style={{ ...highlightStyle(highlightKey === "auth_starts"), cursor: "pointer" }} onClick={() => focusOnMetric("auth", "auth_start_total")}><div style={{ fontSize: 12, opacity: 0.75 }}>Старт авторизации</div><div style={{ fontSize: 30, fontWeight: 700 }}>{kpi.auth}</div></Card>
          <Card className="interactive-row" style={{ ...highlightStyle(highlightKey === "admin_actions"), cursor: "pointer" }} onClick={() => focusOnMetric("admin", "admin_action_total")}><div style={{ fontSize: 12, opacity: 0.75 }}>Admin действия</div><div style={{ fontSize: 30, fontWeight: 700 }}>{kpi.admin}</div></Card>
        </div>
      </Card>

      {focusMetric && (
        <BigChart
          title={`Фокус по событию: ${focusMetric}${focusPath ? ` (${focusPath})` : ""}`}
          points={focusHistory?.series}
          color="#a58dff"
          highlighted
        />
      )}

      <Card>
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700 }}>Исторические графики (Prometheus)</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <UiSelect value={historyRange} onChange={(e) => setHistoryRange(Number(e.target.value) as HistoryRange)}>
              <option value={15}>15 минут</option>
              <option value={60}>1 час</option>
              <option value={360}>6 часов</option>
              <option value={1440}>24 часа</option>
            </UiSelect>
            <Button onClick={refreshMonitoring} variant="secondary">Обновить графики</Button>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, opacity: 0.85 }}>
              <input type="checkbox" checked={showServiceCharts} onChange={(e) => setShowServiceCharts(e.target.checked)} />
              Показать служебные
            </label>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, marginTop: 8 }}>
          <SmallHistoryCard title="HTTP запросы" points={history?.series?.http_requests} color="#78a8ff" highlighted={highlightKey === "http_requests"} />
          <SmallHistoryCard title="HTTP ошибки" points={history?.series?.http_errors} color="#f08f8f" highlighted={highlightKey === "http_errors"} />
          <SmallHistoryCard title="Старт авторизации" points={history?.series?.auth_starts} color="#8dded6" highlighted={highlightKey === "auth_starts"} />
          <SmallHistoryCard title="Admin действия" points={history?.series?.admin_actions} color="#ffb56a" highlighted={highlightKey === "admin_actions"} />
          {showServiceCharts && <SmallHistoryCard title="Центр событий" points={history?.series?.events_center} color="#9d8fff" highlighted={highlightKey === "events_center"} />}
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontWeight: 700 }}>Дополнительно</div>
          <Button onClick={() => setShowAdvanced((v) => !v)} variant="secondary">{showAdvanced ? "Свернуть" : "Развернуть"}</Button>
        </div>
        {showAdvanced && (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <Card style={highlightStyle(highlightKey === "top_endpoints")}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Топ endpoint'ов по запросам</div>
              {topEndpoints.length === 0 ? (
                <EmptyState text="По endpoint'ам пока нет данных." />
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", opacity: 0.8 }}>
                      <th style={{ padding: "6px 8px", borderBottom: "1px solid #3333" }}>Method</th>
                      <th style={{ padding: "6px 8px", borderBottom: "1px solid #3333" }}>Path</th>
                      <th style={{ padding: "6px 8px", borderBottom: "1px solid #3333" }}>Status</th>
                      <th style={{ padding: "6px 8px", borderBottom: "1px solid #3333" }}>Запросов</th>
                      <th style={{ padding: "6px 8px", borderBottom: "1px solid #3333" }}>Доля</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topEndpoints.map((r) => (
                      <tr key={`${r.method}-${r.path}-${r.status}`} style={{ borderBottom: "1px solid #2226" }}>
                        <td style={{ padding: "8px", fontFamily: "monospace" }}>{r.method}</td>
                        <td style={{ padding: "8px", fontFamily: "monospace" }}>{r.path}</td>
                        <td style={{ padding: "8px" }}>{r.status}</td>
                        <td style={{ padding: "8px", fontWeight: 700 }}>{r.value}</td>
                        <td style={{ padding: "8px" }}>{pct(kpi.req, r.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Grafana / Prometheus</div>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <Card>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>Prometheus UI</div>
                  <div style={{ marginTop: 6 }}><a href={PROMETHEUS_UI_URL} target="_blank" rel="noreferrer" style={{ color: "#9ec2ff" }}>Открыть Prometheus</a></div>
                </Card>
                <Card>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>Grafana UI</div>
                  <div style={{ marginTop: 6 }}><a href={GRAFANA_UI_URL} target="_blank" rel="noreferrer" style={{ color: "#9ec2ff" }}>Открыть Grafana</a></div>
                </Card>
              </div>
            </Card>
          </div>
        )}
      </Card>

      {error && <div style={{ color: "#d55" }}>{error}</div>}
      {history && history.enabled === false && (
        <Card style={{ border: "1px solid rgba(255,166,0,0.45)" }}>
          <div style={{ color: "#ffcf8a", fontWeight: 700 }}>Prometheus недоступен</div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>История графиков не загружена.</div>
          {history.error && <div style={{ fontSize: 12, marginTop: 6, opacity: 0.85 }}>Ошибка: {history.error}</div>}
        </Card>
      )}

      <Card ref={tableCardRef} style={{ overflowX: "auto", ...highlightStyle(highlightKey === "table") }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <div><div style={{ fontWeight: 700 }}>Таблица метрик (текущий срез)</div><div style={{ fontSize: 12, opacity: 0.75 }}>{lastUpdated ? `обновлено: ${lastUpdated}` : ""}</div></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <UiSelect value={exportFormat} onChange={(e) => setExportFormat(e.target.value as "csv" | "xlsx")}>
              <option value="csv">CSV</option>
              <option value="xlsx">XLSX</option>
            </UiSelect>
            <Button onClick={exportMetrics} variant="secondary">Экспорт</Button>
          </div>
        </div>

        {hasEventContext && (
          <Card style={{ marginBottom: 10, borderColor: "rgba(106,160,255,0.4)", background: "rgba(106,160,255,0.08)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ fontSize: 13 }}>
                Открыт контекст события: {focusMetric || "highlight"}{focusPath ? ` (${focusPath})` : ""}
              </div>
              <Button onClick={clearEventContext} size="sm" variant="ghost">Сбросить контекст</Button>
            </div>
          </Card>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <SegmentedControl
              value={group}
              onChange={(next) => {
                setGroup(next as Group);
                setQuery("");
              }}
              options={[
                { value: "all", label: "Все" },
                { value: "http", label: "HTTP/API" },
                { value: "auth", label: "Авторизация" },
                { value: "admin", label: "Админ-действия" },
                { value: "events", label: "События" },
              ]}
            />
            <ClearableInput
              value={query}
              onChange={setQuery}
              placeholder="Поиск по метрике/labels"
              containerStyle={{ minWidth: 240 }}
              style={{ borderRadius: 10 }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button onClick={refreshMonitoring} variant="secondary">Обновить</Button>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState text="Метрики по текущему фильтру отсутствуют." />
        ) : (
          <>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>Показано: {visibleRows.length} из {rows.length}</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", opacity: 0.8 }}>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid #3333" }}>Метрика</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid #3333" }}>Описание</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid #3333" }}>Labels</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid #3333" }}>Значение</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #2226" }}>
                    <td style={{ padding: "8px", fontFamily: "monospace", verticalAlign: "top" }}>{r.name}</td>
                    <td style={{ padding: "8px", verticalAlign: "top", opacity: 0.85 }}>{r.description}</td>
                    <td style={{ padding: "8px", verticalAlign: "top" }}>{r.labels}</td>
                    <td style={{ padding: "8px", verticalAlign: "top", fontWeight: 700 }}>{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );
}






