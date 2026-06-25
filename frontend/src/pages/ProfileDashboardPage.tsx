import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { listProjectSiteSummaries, type ProjectSiteSummary } from "../api/projectSites";
import { getPageContext, type PageContext } from "../api/pageContext";
import { ApiError, apiDelete, apiGet, apiPost } from "../api/client";
import PageContextDrawer from "../components/projects/PageContextDrawer";
import ProjectSiteContextCards from "../components/projects/ProjectSiteContextCards";
import ProjectSitesSettings from "../components/projects/ProjectSitesSettings";
import Card from "../components/ui/Card";
import CardActionButton from "../components/ui/CardActionButton";
import CardFooterActions from "../components/ui/CardFooterActions";
import ClearableInput from "../components/ui/ClearableInput";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import ListTotalMeta from "../components/ui/ListTotalMeta";
import ProjectRunBadge from "../components/ui/ProjectRunBadge";
import StructureLegendHint from "../components/ui/StructureLegendHint";
import ProjectStructureTree from "../components/ui/ProjectStructureTree";
import SegmentedControl from "../components/ui/SegmentedControl";
import SectionHeaderRow from "../components/ui/SectionHeaderRow";
import UiSelect from "../components/ui/UiSelect";
import { MetaText, StatusText } from "../components/ui/StatusText";
import { formatOperationalDateTime } from "../utils/datetime";
import { invalidateProfilesCache } from "../utils/profileListCache";
import { publishProjectRunLive } from "../utils/projectRunLiveStore";
import { useAuth } from "../hooks/auth";
import { hasPermission } from "../utils/permissions";

type ProjectProfile = {
  id: number;
  name: string;
  start_url: string;
  allowed_domains_csv: string;
  exclude_paths_csv: string;
  exclude_ext_csv: string;
  respect_robots: boolean;
  max_pages: number;
  concurrency: number;
  is_enabled: boolean;
};

type ProjectRun = {
  id: number;
  profile_id: number;
  project_site_id: number;
  status: "CREATED" | "RUNNING" | "FINISHED" | "FAILED" | string;
  started_at: string;
  finished_at: string | null;
  pages_total: number;
  pages_changed: number;
  failure_code: string | null;
  failure_message: string | null;
};

type ProjectPage = {
  id: number;
  run_id: number;
  url: string;
  status_code: number;
  html_hash: string;
};

type ProjectRunResult = {
  project_site_id: number;
  site_name: string;
  run_id: number | null;
  status: string;
  failure_code: string | null;
  failure_message: string | null;
};

type ProjectRunBatch = {
  ok: boolean;
  profile_id: number;
  sites_total: number;
  finished: number;
  failed: number;
  skipped: number;
  results: ProjectRunResult[];
};

type ProjectTab = "main" | "history" | "settings";

type StructureStatus = "unchanged" | "changed" | "added" | "deleted" | "error";

type StructureRow = {
  url: string;
  domain: string;
  status: StructureStatus;
  statusCode: number;
};

function parseDomains(csv: string): string[] {
  return (csv || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function formatDuration(startedAt?: string, finishedAt?: string | null): string {
  if (!startedAt || !finishedAt) return "—";
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  const totalSec = Math.round((end - start) / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins <= 0) return `${secs} сек`;
  return `${mins} мин ${secs} сек`;
}

function formatTimeAgo(raw?: string | null): string {
  if (!raw) return "—";
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec} сек назад`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

export default function ProfileDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectProfile | null>(null);
  const [sites, setSites] = useState<ProjectSiteSummary[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [runs, setRuns] = useState<ProjectRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runPending, setRunPending] = useState(false);
  const [projectRunPending, setProjectRunPending] = useState(false);
  const [projectRunResult, setProjectRunResult] = useState<ProjectRunBatch | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [activeTab, setActiveTab] = useState<ProjectTab>("main");
  const [selectedDomain, setSelectedDomain] = useState<string>("all");
  const [structureSearch, setStructureSearch] = useState("");
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState("");
  const [lastRunPages, setLastRunPages] = useState<ProjectPage[]>([]);
  const [prevRunPages, setPrevRunPages] = useState<ProjectPage[]>([]);
  const [lastRunCoverage, setLastRunCoverage] = useState<{ ok: number; total: number } | null>(null);
  const [lastRunCoverageLoading, setLastRunCoverageLoading] = useState(false);
  const [failureDetailsOpen, setFailureDetailsOpen] = useState(false);
  const [pageContextOpen, setPageContextOpen] = useState(false);
  const [pageContextLoading, setPageContextLoading] = useState(false);
  const [pageContextError, setPageContextError] = useState("");
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const canRunCrawler = hasPermission(user?.role, "crawler.run");
  const canEditProject = hasPermission(user?.role, "profiles.edit");

  async function fetchRunPages(runId: number): Promise<ProjectPage[]> {
    const rows = await apiGet<ProjectPage[]>(`/runs/${runId}/pages`);
    return Array.isArray(rows) ? rows : [];
  }

  const loadSiteSummaries = useCallback(async (profileId: number, silent = false) => {
    if (!silent) setSitesLoading(true);
    try {
      const next = await listProjectSiteSummaries(profileId);
      setSites(next);
      setSelectedSiteId((current) => {
        if (current && next.some((site) => site.id === current)) return current;
        return next.find((site) => site.is_enabled)?.id ?? next[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить сайты проекта.");
    } finally {
      if (!silent) setSitesLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async (siteId: number, silent = false) => {
    if (!silent) setRunsLoading(true);
    setRunsError("");
    try {
      const data = await apiGet<ProjectRun[]>(`/runs/by-site/${siteId}`);
      const next = Array.isArray(data) ? data : [];
      setRuns(next);
      const first = next[0];
      if (first && project) {
        publishProjectRunLive({
          profileId: project.id,
          status: first.status,
          startedAt: first.started_at,
          finishedAt: first.finished_at,
          pagesTotal: first.pages_total,
          pagesChanged: first.pages_changed,
          runsTotal: next.length,
        });
      }
    } catch (e) {
      setRunsError(String(e));
    } finally {
      if (!silent) setRunsLoading(false);
    }
  }, [project]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError("");
    setProject(null);
    setSelectedSiteId(null);
    Promise.all([
      apiGet<ProjectProfile>(`/profiles/${id}`),
      listProjectSiteSummaries(Number(id)),
    ])
      .then(([nextProject, nextSites]) => {
        setProject(nextProject);
        setSites(nextSites);
        setSelectedSiteId(nextSites.find((site) => site.is_enabled)?.id ?? nextSites[0]?.id ?? null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => {
        setLoading(false);
        setSitesLoading(false);
      });
  }, [id]);

  useEffect(() => {
    if (selectedSiteId === null) {
      setRuns([]);
      return;
    }
    void loadRuns(selectedSiteId);
  }, [selectedSiteId, loadRuns]);

  useEffect(() => {
    if (selectedSiteId === null) return;
    const hasRunning = runs.some((r) => r.status === "RUNNING");
    if (!hasRunning) return;
    const timer = window.setInterval(() => {
      void loadRuns(selectedSiteId, true);
      if (project) void loadSiteSummaries(project.id, true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [selectedSiteId, runs, project, loadRuns, loadSiteSummaries]);

  async function handleStartRun() {
    const selectedSite = sites.find((site) => site.id === selectedSiteId);
    if (!project || !selectedSite || runPending) return;
    setRunPending(true);
    setRunsError("");
    setRuns((prev) => {
      if (prev.some((r) => r.status === "RUNNING")) return prev;
      return [
        {
          id: -Date.now(),
          profile_id: project.id,
          project_site_id: selectedSite.id,
          status: "RUNNING",
          started_at: new Date().toISOString(),
          finished_at: null,
          pages_total: 0,
          pages_changed: 0,
          failure_code: null,
          failure_message: null,
        },
        ...prev,
      ];
    });
    publishProjectRunLive({
      profileId: project.id,
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      pagesTotal: 0,
      pagesChanged: 0,
    });
    try {
      await apiPost(`/runs/start-site/${selectedSite.id}`, {});
      await Promise.all([
        loadRuns(selectedSite.id, true),
        loadSiteSummaries(project.id, true),
      ]);
    } catch (e) {
      await Promise.all([
        loadRuns(selectedSite.id, true),
        loadSiteSummaries(project.id, true),
      ]);
      if (e instanceof ApiError && ["run_already_active", "site_run_already_active"].includes(e.code)) {
        setRunsError("Для выбранного сайта уже выполняется прогон.");
      } else if (e instanceof ApiError && e.status !== 502) {
        setRunsError(e.message);
      } else if (!(e instanceof ApiError)) {
        setRunsError("Не удалось запустить прогон.");
      }
    } finally {
      setRunPending(false);
    }
  }

  async function handleStartAllSites() {
    if (!project || projectRunPending) return;
    setProjectRunPending(true);
    setProjectRunResult(null);
    setRunsError("");
    try {
      const result = await apiPost<ProjectRunBatch>(`/runs/start-project/${project.id}`, {});
      setProjectRunResult(result);
      await loadSiteSummaries(project.id, true);
      if (selectedSiteId !== null) await loadRuns(selectedSiteId, true);
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : "Не удалось запустить сайты проекта.");
    } finally {
      setProjectRunPending(false);
    }
  }

  async function handleOpenPageContext(url: string) {
    if (lastRunId === null) return;
    setPageContextOpen(true);
    setPageContextLoading(true);
    setPageContextError("");
    setPageContext(null);
    try {
      setPageContext(await getPageContext(lastRunId, url));
    } catch (e) {
      setPageContextError(
        e instanceof ApiError && e.status === 404
          ? "Страница отсутствует в текущем run. Возможно, она была удалена после предыдущего прогона."
          : e instanceof Error ? e.message : "Не удалось загрузить контекст страницы.",
      );
    } finally {
      setPageContextLoading(false);
    }
  }

  async function handleDeleteProject() {
    if (!project || deletePending) return;
    setDeletePending(true);
    setError("");
    try {
      await apiDelete(`/profiles/${project.id}`);
      invalidateProfilesCache();
      navigate("/", { replace: true });
    } catch (e) {
      setError(String(e));
    } finally {
      setDeletePending(false);
      setDeleteConfirmOpen(false);
    }
  }

  const selectedSite = sites.find((site) => site.id === selectedSiteId) || null;
  const domains = useMemo(
    () => parseDomains(selectedSite?.allowed_domains_csv || ""),
    [selectedSite?.allowed_domains_csv],
  );
  const lastRun = runs[0] || null;
  const prevRun = runs[1] || null;
  const lastSuccessfulRun = runs.find((r) => r.status === "FINISHED" && Boolean(r.finished_at)) || null;
  const hasRunning = runs.some((r) => r.status === "RUNNING");
  const runsTotal = runs.length;
  const changedLast = lastRun?.pages_changed ?? 0;
  const pagesLast = lastRun?.pages_total ?? 0;
  const changedShareLast = pagesLast > 0 ? (changedLast / pagesLast) * 100 : 0;
  const lastRunDuration = lastRun ? formatDuration(lastRun.started_at, lastRun.finished_at) : "—";
  const lastRunId = lastRun?.id ?? null;
  const prevRunId = prevRun?.id ?? null;
  const coveragePercent = lastRunCoverage && lastRunCoverage.total > 0
    ? (lastRunCoverage.ok / lastRunCoverage.total) * 100
    : 0;

  const domainOptions = useMemo(() => ["all", ...domains], [domains]);

  useEffect(() => {
    if (!domainOptions.includes(selectedDomain)) setSelectedDomain("all");
  }, [domainOptions, selectedDomain]);

  useEffect(() => {
    if (lastRunId === null) {
      setLastRunCoverage(null);
      return;
    }
    let cancelled = false;
    setLastRunCoverageLoading(true);
    fetchRunPages(lastRunId)
      .then((rows) => {
        if (cancelled) return;
        const ok = rows.filter((row) => row.status_code >= 200 && row.status_code < 300).length;
        setLastRunCoverage({ ok, total: rows.length });
      })
      .catch(() => {
        if (cancelled) return;
        setLastRunCoverage(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLastRunCoverageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lastRunId]);

  useEffect(() => {
    if (activeTab !== "main") return;
    if (lastRunId === null) return;
    let cancelled = false;
    async function loadPages() {
      setPagesLoading(true);
      setPagesError("");
      try {
        const [lastRows, prevRows] = await Promise.all([
          fetchRunPages(lastRunId),
          prevRunId !== null ? fetchRunPages(prevRunId) : Promise.resolve([] as ProjectPage[]),
        ]);
        if (cancelled) return;
        setLastRunPages(lastRows);
        setPrevRunPages(prevRows);
      } catch (e) {
        if (cancelled) return;
        setPagesError(String(e));
      } finally {
        if (!cancelled) setPagesLoading(false);
      }
    }
    void loadPages();
    return () => {
      cancelled = true;
    };
  }, [activeTab, lastRunId, prevRunId]);

  const structureRows = useMemo<StructureRow[]>(() => {
    const prevByUrl = new Map<string, string>();
    for (const row of prevRunPages) prevByUrl.set(row.url, row.html_hash || "");
    const currentUrls = new Set<string>();
    const rows: StructureRow[] = [];
    for (const row of lastRunPages) {
      const host = domainOf(row.url);
      if (selectedDomain !== "all" && host !== selectedDomain) continue;
      currentUrls.add(row.url);
      let status: StructureStatus = "unchanged";
      if (row.status_code >= 400) status = "error";
      else if (!prevByUrl.has(row.url)) status = "added";
      else if ((prevByUrl.get(row.url) || "") !== (row.html_hash || "")) status = "changed";
      rows.push({
        url: row.url,
        domain: host,
        status,
        statusCode: row.status_code,
      });
    }
    for (const row of prevRunPages) {
      const host = domainOf(row.url);
      if (selectedDomain !== "all" && host !== selectedDomain) continue;
      if (currentUrls.has(row.url)) continue;
      rows.push({
        url: row.url,
        domain: host,
        status: "deleted",
        statusCode: 0,
      });
    }
    rows.sort((a, b) => a.url.localeCompare(b.url));
    return rows;
  }, [lastRunPages, prevRunPages, selectedDomain]);

  const structureRowsFiltered = useMemo(() => {
    const q = structureSearch.trim().toLowerCase();
    if (!q) return structureRows;
    return structureRows.filter((row) => row.url.toLowerCase().includes(q));
  }, [structureRows, structureSearch]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {loading && <div>Загрузка...</div>}
      {error && <StatusText tone="danger">{error}</StatusText>}

      {!loading && !error && project && (
        <>
          <Card>
            <div style={{ display: "grid", gap: 10 }}>
              <SectionHeaderRow
                title={
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800, fontSize: 20 }}>{project.name}</div>
                    <ProjectRunBadge status={lastRun?.status} />
                  </div>
                }
                actions={canRunCrawler ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <CardActionButton
                      variant="ghost"
                      onClick={() => navigate(`/profiles/${project.id}/compare`, { state: { projectName: project.name } })}
                    >
                      Сравнить страницы
                    </CardActionButton>
                    <CardActionButton
                      variant="secondary"
                      onClick={() => void handleStartAllSites()}
                      disabled={projectRunPending || runPending || sites.every((site) => !site.is_enabled)}
                      title={sites.every((site) => !site.is_enabled) ? "В проекте нет включённых сайтов." : undefined}
                    >
                      {projectRunPending ? "Запуск всех..." : "Запустить все сайты"}
                    </CardActionButton>
                    <CardActionButton
                      variant="primary"
                      onClick={() => {
                        void handleStartRun();
                      }}
                      disabled={runPending || projectRunPending || hasRunning || !selectedSite?.is_enabled}
                      title={
                        !selectedSite?.is_enabled
                          ? "Включите выбранный сайт в настройках."
                          : hasRunning ? "Выбранный сайт уже сканируется." : undefined
                      }
                    >
                      {runPending ? "Запуск..." : hasRunning ? "Прогон выполняется" : "Запустить выбранный сайт"}
                    </CardActionButton>
                  </div>
                ) : undefined}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <MetaText opacity={0.86}>
                  Выберите сайт карточкой: показатели, структура, история и ручной запуск ниже относятся только к нему.
                </MetaText>
              </div>
              {hasRunning && (
                <MetaText opacity={0.72}>
                  Сейчас сканируется выбранный сайт. Остальные сайты проекта сохраняют независимую историю.
                </MetaText>
              )}
            </div>
          </Card>

          <Card>
            <div style={{ display: "grid", gap: 10 }}>
              <SectionHeaderRow
                title={
                  <div>
                    <div style={{ fontWeight: 700 }}>Сайты проекта</div>
                    <MetaText opacity={0.68}>Карточка задаёт рабочий контекст страницы.</MetaText>
                  </div>
                }
                actions={<MetaText opacity={0.68}>{sites.length} сайт(а)</MetaText>}
              />
              {sitesLoading && <MetaText>Загрузка сайтов...</MetaText>}
              {!sitesLoading && sites.length === 0 && (
                <StatusText tone="warning">В проекте пока нет доступных сайтов.</StatusText>
              )}
              {!sitesLoading && sites.length > 0 && (
                <ProjectSiteContextCards
                  sites={sites}
                  selectedSiteId={selectedSiteId}
                  onSelect={(siteId) => {
                    setSelectedSiteId(siteId);
                    setRunsError("");
                    setPagesError("");
                    setStructureSearch("");
                    setFailureDetailsOpen(false);
                  }}
                />
              )}
              {projectRunResult && (
                <Card
                  variant={projectRunResult.failed > 0 || projectRunResult.skipped > 0 ? "warning" : "hint"}
                  style={{ display: "grid", gap: 6 }}
                >
                  <div style={{ fontWeight: 700 }}>Общий запуск завершён</div>
                  <MetaText>
                    Успешно: {projectRunResult.finished} · с ошибкой: {projectRunResult.failed} · пропущено: {projectRunResult.skipped}
                  </MetaText>
                  {projectRunResult.results
                    .filter((result) => result.status !== "FINISHED")
                    .map((result) => (
                      <StatusText
                        key={result.project_site_id}
                        tone={result.status === "FAILED" ? "danger" : "warning"}
                        style={{ fontSize: 12 }}
                      >
                        {result.site_name}: {result.failure_message || result.status}
                      </StatusText>
                    ))}
                </Card>
              )}
            </div>
          </Card>

          <Card style={{ padding: 10 }}>
            <SegmentedControl
              value={activeTab}
              onChange={(next) => setActiveTab(next)}
              options={[
                { value: "main", label: "Основная" },
                { value: "history", label: "История" },
                ...(canEditProject ? [{ value: "settings" as const, label: "Настройки" }] : []),
              ]}
            />
          </Card>

          {activeTab === "main" && (
            <>
              {selectedSite && (
                <Card
                  variant={
                    selectedSite.anomaly.status === "anomaly"
                      ? selectedSite.anomaly.severity === "danger" ? "danger" : "warning"
                      : selectedSite.anomaly.status === "normal" ? "hint" : "default"
                  }
                >
                  <div style={{ display: "grid", gap: 7 }}>
                    <SectionHeaderRow
                      title={<div style={{ fontWeight: 700 }}>Состояние сайта: {selectedSite.name}</div>}
                      actions={
                        selectedSite.anomaly.status === "anomaly"
                          ? <StatusText tone={selectedSite.anomaly.severity === "danger" ? "danger" : "warning"}>Аномалия</StatusText>
                          : selectedSite.anomaly.status === "normal"
                            ? <StatusText tone="success">Норма</StatusText>
                            : <StatusText tone="muted">Недостаточно данных</StatusText>
                      }
                    />
                    <MetaText>{selectedSite.anomaly.message}</MetaText>
                    {selectedSite.anomaly.status === "insufficient_data" && (
                      <MetaText opacity={0.68}>
                        Успешных прогонов: {selectedSite.anomaly.successful_runs}. Для оценки нужны текущий прогон и минимум {selectedSite.anomaly.baseline_runs_required} предыдущих успешных прогона.
                      </MetaText>
                    )}
                    {selectedSite.anomaly.reasons.map((reason) => (
                      <StatusText
                        key={reason.code}
                        tone={reason.severity === "danger" ? "danger" : "warning"}
                        style={{ fontSize: 13 }}
                      >
                        {reason.message}
                      </StatusText>
                    ))}
                    {selectedSite.anomaly.baseline && selectedSite.anomaly.latest && (
                      <MetaText opacity={0.65}>
                        Baseline: в среднем {selectedSite.anomaly.baseline.pages_average} страниц · последний прогон: {selectedSite.anomaly.latest.pages_total}.
                      </MetaText>
                    )}
                  </div>
                </Card>
              )}

              <Card>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>Последний прогон</div>
                  {runsError ? <StatusText tone="danger">{runsError}</StatusText> : null}
                  {!runsLoading && !lastRun && (
                    <div style={{ display: "grid", gap: 8 }}>
                      <MetaText>Для выбранного сайта прогонов пока нет. Запустите первый сбор, чтобы получить структуру и метрики.</MetaText>
                      {canRunCrawler && <div>
                        <CardActionButton
                          variant="primary"
                          onClick={() => void handleStartRun()}
                          disabled={runPending || projectRunPending || hasRunning || !selectedSite?.is_enabled}
                        >
                          {runPending ? "Запуск..." : "Запустить первый прогон"}
                        </CardActionButton>
                      </div>}
                    </div>
                  )}
                  {!runsLoading && lastRun && (
                    <div style={{ display: "grid", gap: 6 }}>
                      <MetaText>Статус: {lastRun.status}</MetaText>
                      <MetaText>Старт: {formatOperationalDateTime(lastRun.started_at)}</MetaText>
                      <MetaText>
                        Завершение: {lastRun.finished_at ? formatOperationalDateTime(lastRun.finished_at) : "еще выполняется"}
                      </MetaText>
                      <MetaText>Длительность: {formatDuration(lastRun.started_at, lastRun.finished_at)}</MetaText>
                      <MetaText>
                        Страниц: {lastRun.pages_total}, изменений: {lastRun.pages_changed}
                      </MetaText>
                      {lastRun.status === "FAILED" && (
                        <Card variant="danger" style={{ padding: 12 }}>
                          <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ fontWeight: 700 }}>Прогон не завершен</div>
                            <MetaText>{lastRun.failure_message || "Не удалось получить страницы сайта."}</MetaText>
                            {canRunCrawler && <CardFooterActions>
                              <CardActionButton
                                variant="primary"
                                onClick={() => void handleStartRun()}
                                disabled={runPending || projectRunPending || hasRunning || !selectedSite?.is_enabled}
                              >
                                Повторить
                              </CardActionButton>
                              <CardActionButton
                                variant="secondary"
                                onClick={() => selectedSite && window.open(selectedSite.start_url, "_blank", "noopener,noreferrer")}
                              >
                                Проверить адрес
                              </CardActionButton>
                              <CardActionButton
                                variant="ghost"
                                onClick={() => setFailureDetailsOpen((open) => !open)}
                              >
                                {failureDetailsOpen ? "Скрыть детали" : "Технические детали"}
                              </CardActionButton>
                            </CardFooterActions>}
                            {failureDetailsOpen && (
                              <MetaText opacity={0.68}>
                                Код: {lastRun.failure_code || "unknown_error"}; run #{lastRun.id}; адрес: {selectedSite?.start_url || "—"}
                              </MetaText>
                            )}
                          </div>
                        </Card>
                      )}
                    </div>
                  )}
                </div>
              </Card>

              <Card>
                <div style={{ display: "grid", gap: 8 }}>
                  <SectionHeaderRow
                    title={<div style={{ fontWeight: 700 }}>Показатели последнего прогона</div>}
                    actions={lastRun?.finished_at ? (
                      <MetaText opacity={0.68}>{formatOperationalDateTime(lastRun.finished_at)}</MetaText>
                    ) : undefined}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                    <Card style={{ padding: 10, display: "grid", alignContent: "space-between", minHeight: 108 }}>
                      <MetaText opacity={0.7} style={{ minHeight: 38 }}>Доля изменений (последний прогон)</MetaText>
                      <div style={{ fontWeight: 800, fontSize: 22 }}>
                        {lastRun && pagesLast > 0 ? `${changedShareLast.toFixed(1)}%` : "—"}
                      </div>
                    </Card>
                    <Card style={{ padding: 10, display: "grid", alignContent: "space-between", minHeight: 108 }}>
                      <MetaText opacity={0.7} style={{ minHeight: 38 }}>Последний успешный прогон</MetaText>
                      <div style={{ fontWeight: 800, fontSize: 20 }}>
                        {lastSuccessfulRun?.finished_at ? formatOperationalDateTime(lastSuccessfulRun.finished_at) : "—"}
                      </div>
                      <MetaText opacity={0.65}>
                        {lastSuccessfulRun?.finished_at ? formatTimeAgo(lastSuccessfulRun.finished_at) : "Нет завершенных успешных прогонов"}
                      </MetaText>
                    </Card>
                    <Card style={{ padding: 10, display: "grid", alignContent: "space-between", minHeight: 108 }}>
                      <MetaText opacity={0.7} style={{ minHeight: 38 }}>Длительность последнего прогона</MetaText>
                      <div style={{ fontWeight: 800, fontSize: 22 }}>{lastRunDuration}</div>
                      <MetaText opacity={0.65}>{lastRun?.status === "RUNNING" ? "Прогон еще выполняется" : "По меткам start/finish"}</MetaText>
                    </Card>
                    <Card style={{ padding: 10, display: "grid", alignContent: "space-between", minHeight: 108 }}>
                      <MetaText opacity={0.7} style={{ minHeight: 38 }}>Покрытие (2xx/всего)</MetaText>
                      <div style={{ fontWeight: 800, fontSize: 22 }}>
                        {lastRunCoverageLoading ? "..." : lastRunCoverage ? `${lastRunCoverage.ok}/${lastRunCoverage.total}` : "—"}
                      </div>
                      <MetaText opacity={0.65}>
                        {lastRunCoverage && lastRunCoverage.total > 0 ? `${coveragePercent.toFixed(1)}% успешных ответов` : "Недостаточно данных"}
                      </MetaText>
                    </Card>
                    <Card style={{ padding: 10, display: "grid", alignContent: "space-between", minHeight: 108 }}>
                      <MetaText opacity={0.7} style={{ minHeight: 38 }}>Прогонов всего</MetaText>
                      <div style={{ fontWeight: 800, fontSize: 22 }}>{runsTotal}</div>
                    </Card>
                    <Card style={{ padding: 10, display: "grid", alignContent: "space-between", minHeight: 108 }}>
                      <MetaText opacity={0.7} style={{ minHeight: 38 }}>Страниц (последний прогон)</MetaText>
                      <div style={{ fontWeight: 800, fontSize: 22 }}>{pagesLast}</div>
                    </Card>
                    <Card style={{ padding: 10, display: "grid", alignContent: "space-between", minHeight: 108 }}>
                      <MetaText opacity={0.7} style={{ minHeight: 38 }}>Изменений (последний прогон)</MetaText>
                      <div style={{ fontWeight: 800, fontSize: 22 }}>{changedLast}</div>
                    </Card>
                  </div>
                </div>
              </Card>

              <Card>
                <div style={{ display: "grid", gap: 10 }}>
                  <SectionHeaderRow
                    title={
                      <div>
                        <div style={{ fontWeight: 700 }}>Структура сайта</div>
                        <MetaText opacity={0.68}>Текущий срез последнего прогона</MetaText>
                      </div>
                    }
                    actions={(
                      <UiSelect
                        value={selectedDomain}
                        onChange={(e) => setSelectedDomain(e.target.value)}
                        style={{ minWidth: 180 }}
                      >
                        <option value="all">Домен: все</option>
                        {domains.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </UiSelect>
                    )}
                  />
                  <ListTotalMeta label="Узлов (текущий срез)" total={structureRows.length} />
                  {pagesLoading && <MetaText>Загрузка структуры...</MetaText>}
                  {pagesError && <StatusText tone="danger">{pagesError}</StatusText>}
                  {!pagesLoading && (
                    <>
                      <StructureLegendHint />
                      <ClearableInput
                        value={structureSearch}
                        onChange={setStructureSearch}
                        placeholder="Поиск по URL/пути (meta-поиск добавим после подключения snapshots)..."
                      />
                    </>
                  )}
                  {!pagesLoading && !pagesError && structureRows.length === 0 && (
                    <MetaText>Структура пока недоступна: выполните как минимум один прогон.</MetaText>
                  )}
                  {!pagesLoading && !pagesError && structureRows.length > 0 && structureRowsFiltered.length > 0 && (
                    <ProjectStructureTree
                      rows={structureRowsFiltered}
                      query={structureSearch}
                      onPageSelect={(url) => void handleOpenPageContext(url)}
                    />
                  )}
                  {!pagesLoading && !pagesError && structureRows.length > 0 && structureRowsFiltered.length === 0 && (
                    <MetaText>По текущему поиску совпадений не найдено.</MetaText>
                  )}
                </div>
              </Card>
            </>
          )}

          {activeTab === "history" && (
            <Card>
              <div style={{ display: "grid", gap: 10 }}>
                <SectionHeaderRow
                  title={
                    <div>
                      <div style={{ fontWeight: 700 }}>История прогонов</div>
                      <MetaText opacity={0.68}>{selectedSite?.name || "Сайт не выбран"}</MetaText>
                    </div>
                  }
                  actions={<ListTotalMeta label="Прогонов" total={runs.length} />}
                />
                <div style={{ display: "grid", gap: 8 }}>
                  {runs.map((run) => (
                    <Card key={run.id} style={{ padding: 10 }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 700 }}>run #{run.id}</div>
                          <ProjectRunBadge status={run.status} />
                        </div>
                        <MetaText>Старт: {formatOperationalDateTime(run.started_at)}</MetaText>
                        <MetaText>Завершение: {run.finished_at ? formatOperationalDateTime(run.finished_at) : "еще выполняется"}</MetaText>
                        <MetaText>Длительность: {formatDuration(run.started_at, run.finished_at)}</MetaText>
                        <MetaText>Страниц: {run.pages_total}, изменений: {run.pages_changed}</MetaText>
                        {run.status === "FAILED" && run.failure_message && (
                          <StatusText tone="danger">{run.failure_message}</StatusText>
                        )}
                      </div>
                    </Card>
                  ))}
                  {runs.length === 0 && <MetaText>История пока пуста.</MetaText>}
                </div>
              </div>
            </Card>
          )}

          {activeTab === "settings" && canEditProject && (
            <div style={{ display: "grid", gap: 12 }}>
              <ProjectSitesSettings
                profileId={project.id}
                onChanged={() => {
                  void loadSiteSummaries(project.id, true);
                }}
              />

              <Card variant="hint">
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>Расписание</div>
                  <MetaText>
                    Сейчас прогоны запускаются вручную. Автозапуск появится после backend-контракта расписаний и защиты от дублирующих запусков.
                  </MetaText>
                  <div>
                    <CardActionButton
                      variant="primary"
                      onClick={() => void handleStartRun()}
                      disabled={runPending || hasRunning}
                    >
                      {hasRunning ? "Прогон выполняется" : "Запустить сейчас"}
                    </CardActionButton>
                  </div>
                </div>
              </Card>

              <Card variant="danger">
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>Опасная зона</div>
                  <MetaText opacity={0.72}>
                    Удаление проекта необратимо: будут удалены связанные прогоны и артефакты.
                  </MetaText>
                  <CardFooterActions>
                    <CardActionButton
                      variant="danger"
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      Удалить проект
                    </CardActionButton>
                  </CardFooterActions>
                </div>
              </Card>
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Удалить проект?"
        description={project ? `Проект "${project.name}" будет удален без возможности восстановления.` : ""}
        confirmText="Удалить"
        cancelText="Отмена"
        confirmVariant="danger"
        loading={deletePending}
        onConfirm={() => {
          void handleDeleteProject();
        }}
        onCancel={() => {
          if (deletePending) return;
          setDeleteConfirmOpen(false);
        }}
      />
      <PageContextDrawer
        open={pageContextOpen}
        loading={pageContextLoading}
        error={pageContextError}
        context={pageContext}
        onClose={() => {
          setPageContextOpen(false);
          setPageContextError("");
        }}
      />
    </div>
  );
}
