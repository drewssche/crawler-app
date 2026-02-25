import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiGet, apiPost, isAbortError } from "../api/client";
import { formatLocalDateTimeWithOffset } from "../utils/datetime";
import { downloadBlobFile } from "../utils/download";
import { normalizeError } from "../utils/errors";
import { buildMonitoringExportRequest } from "../utils/exportUrl";
import {
  MONITORING_PRIMARY_CHARTS,
  MONITORING_STATUS_TOKENS,
  type MonitoringPrimaryChartKey,
} from "../utils/monitoringChartConfig";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import ClearableInput from "../components/ui/ClearableInput";
import EmptyState from "../components/ui/EmptyState";
import HintCard from "../components/ui/HintCard";
import HintTable from "../components/ui/HintTable";
import InteractiveLineChart from "../components/monitoring/InteractiveLineChart";
import SegmentedControl from "../components/ui/SegmentedControl";
import UiSelect from "../components/ui/UiSelect";
import { useWorkspaceInfiniteScroll } from "../hooks/useWorkspaceInfiniteScroll";

type MetricItem = { labels: Record<string, string>; value: number };
type MetricsResponse = { counters: Record<string, MetricItem[]> };
type HistoryPoint = { ts: number; value: number };
type Group = "all" | "http" | "events";

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
  | "table"
  | null;

const AUTO_REFRESH_MS = 15000;
const BASE_ROWS = 20;

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

function highlightStyle(active: boolean) {
  return active
    ? { borderColor: "rgba(106,160,255,0.72)", boxShadow: "0 0 0 2px rgba(106,160,255,0.2)" }
    : {};
}

function SmallHistoryCard({
  title,
  points,
  color,
  highlighted,
  onZoom,
}: {
  title: string;
  points?: HistoryPoint[];
  color: string;
  highlighted?: boolean;
  onZoom?: () => void;
}) {
  const values = (points || []).map((p) => Number(p.value || 0));
  const current = values.length ? values[values.length - 1] : 0;
  const delta = values.length > 1 ? values[values.length - 1] - values[0] : 0;

  return (
    <Card style={highlightStyle(Boolean(highlighted))} interactive={Boolean(onZoom)} onClick={onZoom}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>текущее: {current.toFixed(0)}</div>
      </div>
      {values.length < 2 ? (
        <div style={{ fontSize: 13, opacity: 0.75, marginTop: 8 }}>Недостаточно данных для графика.</div>
      ) : (
        <>
          <div style={{ marginTop: 6 }}>
            <InteractiveLineChart
              points={points || []}
              color={color}
              label={title}
              minTickSpacingPx={108}
            />
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
  const d = values[values.length - 1] - values[0];

  return (
    <Card style={highlightStyle(Boolean(highlighted))}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          min: {min.toFixed(0)} | max: {max.toFixed(0)} | Δ: {d >= 0 ? "+" : ""}
          {d.toFixed(0)}
        </div>
      </div>
      <InteractiveLineChart
        points={points || []}
        color={color}
        label={title}
        height={h}
        chartWidth={760}
        showYAxis
        tickCount={5}
        minTickSpacingPx={140}
      />
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
  const [zoomSeries, setZoomSeries] = useState<MonitoringPrimaryChartKey | null>(null);
  const [showAdditional, setShowAdditional] = useState(false);
  const [customRangeEnabled, setCustomRangeEnabled] = useState(false);
  const [customRangeHours, setCustomRangeHours] = useState(1);

  const [group, setGroup] = useState<Group>((params.get("group") as Group) || "all");
  const [query, setQuery] = useState(params.get("query") || "");
  const [historyRangePreset, setHistoryRangePreset] = useState(60);
  const [rowsVisible, setRowsVisible] = useState(BASE_ROWS);
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");
  const [exportPending, setExportPending] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const tableCardRef = useRef<HTMLDivElement | null>(null);
  const metricsAbortRef = useRef<AbortController | null>(null);
  const settingsAbortRef = useRef<AbortController | null>(null);
  const focusAbortRef = useRef<AbortController | null>(null);

  const highlightKey = (params.get("highlight_key") as HighlightKey) || null;
  const focusMetric = params.get("focus_metric") || "";
  const focusPath = params.get("focus_path") || "";
  const hasEventContext = Boolean(highlightKey || focusMetric || focusPath);
  const historyRange = customRangeEnabled ? customRangeHours * 60 : historyRangePreset;

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
      setLastUpdated(formatLocalDateTimeWithOffset(new Date(), { locale: "ru-RU", includeDate: false, includeSeconds: true }));
    } catch (e) {
      if (isAbortError(e)) return;
      setError(normalizeError(e));
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
      setError(normalizeError(e));
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
    }),
    [metrics],
  );

  const zoomConfig = useMemo(() => {
    const hit = MONITORING_PRIMARY_CHARTS.find((c) => c.key === zoomSeries);
    if (!hit) return null;
    const points = hit.key === "http_requests" ? history?.series?.http_requests || [] : history?.series?.http_errors || [];
    return { title: `Увеличенный график: ${hit.title}`, color: hit.color, points };
  }, [history?.series?.http_errors, history?.series?.http_requests, zoomSeries]);

  const chartSeries = useMemo(
    () =>
      MONITORING_PRIMARY_CHARTS.map((c) => ({
        ...c,
        points: c.key === "http_requests" ? history?.series?.http_requests || [] : history?.series?.http_errors || [],
      })),
    [history?.series?.http_errors, history?.series?.http_requests],
  );

  const thresholdHints = useMemo(
    () => ({
      warnDelta: "Сколько новых ошибок за шаг графика нужно для warning.",
      warnRate: "Доля ошибок (%) за шаг графика, после которой включается warning.",
      critDelta: "Сколько новых ошибок за шаг графика нужно для критичного статуса.",
      critRate: "Доля ошибок (%) за шаг графика, после которой включается критичный статус.",
    }),
    [],
  );

  function applyPresetRange(minutes: number) {
    setCustomRangeEnabled(false);
    setHistoryRangePreset(minutes);
  }

  function toggleZoom(next: MonitoringPrimaryChartKey) {
    setZoomSeries((prev) => (prev === next ? null : next));
  }

  function resetThresholdsToRecommended() {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            warn_error_delta: 1,
            warn_error_rate: 3,
            crit_error_delta: 3,
            crit_error_rate: 10,
          }
        : prev,
    );
  }

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

  const statusLabel = useMemo(() => `Статус: ${summary.title}`, [summary.title]);
  const statusTone = MONITORING_STATUS_TOKENS[summary.level];

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdated) return "Последнее обновление: —";
    return `Последнее обновление: ${lastUpdated}`;
  }, [lastUpdated]);

  async function saveThresholds() {
    if (!settings) return;
    setError("");
    try {
      const updated = await apiPost<MonitoringSettings>("/admin/monitoring/settings", settings);
      setSettings(updated);
      setEditingThresholds(false);
      await loadMetricsHistory();
    } catch (e) {
      setError(normalizeError(e));
    }
  }

  async function refreshMonitoring() {
    await loadMetricsHistory();
    if (focusMetric) {
      await loadFocus();
    }
  }

  async function exportMetrics() {
    if (exportPending) return;
    setExportPending(true);
    setExportProgress(null);
    try {
      const req = buildMonitoringExportRequest({
        format: exportFormat,
        group,
        query,
      });
      await downloadBlobFile(req.url, req.filename, {
        onProgress: (progress) => setExportProgress(progress.percent),
      });
    } catch (e) {
      setError(normalizeError(e));
    } finally {
      setExportPending(false);
      setExportProgress(null);
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

  const topEndpoints = useMemo(() => {
    const source = metrics.http_requests_total || [];
    const grouped = new Map<string, { method: string; path: string; status: string; value: number }>();
    for (const item of source) {
      const method = String(item.labels?.method || "-");
      const path = String(item.labels?.path || "-");
      const status = String(item.labels?.status || "-");
      const key = `${method}|${path}|${status}`;
      const current = grouped.get(key);
      if (current) {
        current.value += Number(item.value || 0);
      } else {
        grouped.set(key, { method, path, status, value: Number(item.value || 0) });
      }
    }
    const rows = Array.from(grouped.values()).sort((a, b) => b.value - a.value);
    const total = rows.reduce((acc, row) => acc + row.value, 0);
    return {
      total,
      rows: rows.slice(0, 10).map((row) => ({
        ...row,
        share: total > 0 ? (row.value / total) * 100 : 0,
      })),
    };
  }, [metrics.http_requests_total]);

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

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <h2 style={{ marginTop: 0, marginBottom: 4 }}>Мониторинг</h2>
      </div>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 2 }}>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                whiteSpace: "nowrap",
                color: statusTone.titleColor,
              }}
            >
              {statusLabel}
            </div>
            <div style={{ opacity: 0.88, fontSize: 13 }}>{lastUpdatedLabel}</div>
            <div style={{ opacity: 0.88, fontSize: 13 }}>
              За интервал: errors +{summary.errDelta.toFixed(0)}, requests +{summary.reqDelta.toFixed(0)}, error-rate {summary.rate.toFixed(1)}%
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ opacity: 0.85, fontSize: 13 }}>invalid_code: {summary.invalid.toFixed(0)}</div>
            <Button variant="panel-toggle" active={editingThresholds} onClick={() => setEditingThresholds((v) => !v)}>
              {editingThresholds ? "Скрыть пороги" : "Настроить пороги"}
            </Button>
          </div>
        </div>

        {editingThresholds && settings && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(140px, 1fr)) auto auto", gap: 8, alignItems: "end" }}>
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
            <Button onClick={resetThresholdsToRecommended} variant="secondary">
              Рекомендованные
            </Button>
            </div>
            <HintCard title="Подсказка по порогам" style={{ padding: 10 }}>
              <HintTable
                columns={[
                  { key: "threshold", label: "Порог", align: "left" },
                  { key: "meaning", label: "Что означает", align: "left" },
                ]}
                rows={[
                  { id: "warn-delta", cells: { threshold: "warn: delta", meaning: thresholdHints.warnDelta } },
                  { id: "warn-rate", cells: { threshold: "warn: rate %", meaning: thresholdHints.warnRate } },
                  { id: "crit-delta", cells: { threshold: "crit: delta", meaning: thresholdHints.critDelta } },
                  { id: "crit-rate", cells: { threshold: "crit: rate %", meaning: thresholdHints.critRate } },
                ]}
                fontSize={12}
                cellPadding="6px 4px"
              />
              <div style={{ opacity: 0.74, fontSize: 12 }}>Пример: 5 ошибок из 100 запросов = 5%.</div>
            </HintCard>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginTop: 10 }}>
          <Card interactive style={{ ...highlightStyle(highlightKey === "http_requests"), cursor: "pointer" }} onClick={() => focusOnMetric("http", "http_requests_total")}><div style={{ fontSize: 12, opacity: 0.75 }}>HTTP запросы</div><div style={{ fontSize: 30, fontWeight: 700 }}>{kpi.req}</div></Card>
          <Card interactive style={{ ...highlightStyle(highlightKey === "http_errors"), cursor: "pointer" }} onClick={() => focusOnMetric("http", "http_errors_total")}><div style={{ fontSize: 12, opacity: 0.75 }}>HTTP ошибки</div><div style={{ fontSize: 30, fontWeight: 700 }}>{kpi.err}</div></Card>
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
      {zoomConfig && (
        <Card interactive style={{ ...highlightStyle(true), display: "grid", gap: 8, cursor: "pointer" }} onClick={() => setZoomSeries(null)}>
          <div style={{ fontWeight: 700 }}>{zoomConfig.title}</div>
          <InteractiveLineChart
            points={zoomConfig.points}
            color={zoomConfig.color}
            label={zoomConfig.title}
            height={220}
            chartWidth={760}
            showYAxis
            tickCount={6}
            minTickSpacingPx={180}
            smoothHover
          />
        </Card>
      )}

      <Card>
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700 }}>Исторические графики (Prometheus)</div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {[
                { label: "15м", value: 15 },
                { label: "1ч", value: 60 },
                { label: "6ч", value: 360 },
                { label: "24ч", value: 1440 },
              ].map((preset) => (
                <Button
                  key={preset.value}
                  size="sm"
                  variant={!customRangeEnabled && historyRangePreset === preset.value ? "primary" : "ghost"}
                  onClick={() => applyPresetRange(preset.value)}
                >
                  {preset.label}
                </Button>
              ))}
              <Button size="sm" variant={customRangeEnabled ? "primary" : "ghost"} onClick={() => setCustomRangeEnabled((v) => !v)}>
                Точный (1-24ч)
              </Button>
            <Button onClick={refreshMonitoring} variant="secondary">Обновить сейчас</Button>
            </div>
            {customRangeEnabled && (
              <div style={{ display: "grid", gap: 4 }}>
                <input
                  type="range"
                  min={1}
                  max={24}
                  step={1}
                  value={customRangeHours}
                  onChange={(e) => setCustomRangeHours(Number(e.target.value))}
                />
                <div style={{ fontSize: 12, opacity: 0.78 }}>Окно графика: {customRangeHours} ч ({customRangeHours * 60} минут)</div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, marginTop: 8 }}>
          {chartSeries.map((chart) => (
            <SmallHistoryCard
              key={chart.key}
              title={chart.title}
              points={chart.points}
              color={chart.color}
              highlighted={highlightKey === chart.highlightKey}
              onZoom={() => toggleZoom(chart.key)}
            />
          ))}
        </div>
      </Card>
      <Card>
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700 }}>Дополнительно</div>
          <Button variant="panel-toggle" active={showAdditional} onClick={() => setShowAdditional((v) => !v)}>
            {showAdditional ? "Скрыть" : "Раскрыть"}
          </Button>
        </div>
        {showAdditional && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Топ endpoint&apos;ов по запросам</div>
            {topEndpoints.rows.length === 0 ? (
              <EmptyState text="Данные по endpoint'ам отсутствуют." />
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
                  {topEndpoints.rows.map((row) => (
                    <tr key={`${row.method}-${row.path}-${row.status}`} className="table-hover-row" style={{ borderBottom: "1px solid #2226" }}>
                      <td style={{ padding: "8px", fontFamily: "monospace" }}>{row.method}</td>
                      <td style={{ padding: "8px", fontFamily: "monospace" }}>{row.path}</td>
                      <td style={{ padding: "8px", fontFamily: "monospace" }}>{row.status}</td>
                      <td style={{ padding: "8px", fontWeight: 700 }}>{row.value.toFixed(0)}</td>
                      <td style={{ padding: "8px" }}>{row.share.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Card>

      {error && <div style={{ color: "#d55" }}>{error}</div>}
      {history && history.enabled === false && (
        <Card variant="warning">
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
            <Button
              onClick={exportMetrics}
              variant="export"
              disabled={exportPending}
              exportProgress={exportPending ? exportProgress : undefined}
            >
              {exportPending ? `Экспорт${exportProgress != null ? ` ${exportProgress}%` : "..."}` : "Экспорт"}
            </Button>
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
                  <tr key={r.id} className="table-hover-row" style={{ borderBottom: "1px solid #2226" }}>
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






