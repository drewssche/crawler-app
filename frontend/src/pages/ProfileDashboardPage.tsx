import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { listProjectSiteSummaries, type ProjectSiteSummary } from "../api/projectSites";
import {
  getPageContext,
  retryProblemPages,
  type PageContext,
  type RetryPagesResult,
} from "../api/pageContext";
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
import ToastHost, { type ToastItem } from "../components/ui/ToastHost";
import UiSelect from "../components/ui/UiSelect";
import { MetaText, StatusText } from "../components/ui/StatusText";
import { formatOperationalDateTime } from "../utils/datetime";
import { invalidateProfilesCache } from "../utils/profileListCache";
import { publishProjectRunLive } from "../utils/projectRunLiveStore";
import { useAuth } from "../hooks/auth";
import { hasPermission } from "../utils/permissions";
import { refreshEventCenterPollingNow } from "../utils/eventCenterPollingManager";

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
  pages_discovered: number;
  current_batch_no: number;
  current_url: string | null;
  progress_updated_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
};

type ProjectPage = {
  id: number;
  run_id: number;
  url: string;
  status_code: number;
  html_hash: string;
  final_url: string | null;
  final_status_code: number | null;
  fetch_error_code: string | null;
  fetch_error_message: string | null;
  redirect_chain_json: Array<{ url: string; status_code: number; location: string | null }> | null;
  crawl_batch_no: number | null;
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
type StructureViewFilter = "all" | "added" | "error";

type StructureStatus = "unchanged" | "changed" | "added" | "deleted" | "redirect" | "error";

type StructureRow = {
  url: string;
  domain: string;
  status: StructureStatus;
  statusCode: number;
  batchNo: number | null;
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
  const [structureViewFilter, setStructureViewFilter] = useState<StructureViewFilter>("all");
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
  const [pageRetryPending, setPageRetryPending] = useState(false);
  const [pageRetryMessage, setPageRetryMessage] = useState("");
  const [pageRetrySucceeded, setPageRetrySucceeded] = useState<boolean | null>(null);
  const [bulkRetryPending, setBulkRetryPending] = useState(false);
  const [bulkRetryResult, setBulkRetryResult] = useState<RetryPagesResult | null>(null);
  const [bulkRetryError, setBulkRetryError] = useState("");
  const [structureRetryingUrl, setStructureRetryingUrl] = useState<string | null>(null);
  const [structureRetryResultByUrl, setStructureRetryResultByUrl] = useState<
    Record<string, "success" | "failed" | "skipped">
  >({});
  const [structureRetryNotice, setStructureRetryNotice] = useState("");
  const [structureRetryNoticeTone, setStructureRetryNoticeTone] = useState<"success" | "warning">("success");
  const [runElapsedSeconds, setRunElapsedSeconds] = useState(0);
  const [runToasts, setRunToasts] = useState<ToastItem[]>([]);
  const canRunCrawler = hasPermission(user?.role, "crawler.run");
  const canEditProject = hasPermission(user?.role, "profiles.edit");
  const canViewEvents = hasPermission(user?.role, "events.view");

  function showRunToast(item: Omit<ToastItem, "id">) {
    const toast = { ...item, id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
    setRunToasts((current) => [toast, ...current].slice(0, 3));
  }

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
    }, 1500);
    return () => window.clearInterval(timer);
  }, [selectedSiteId, runs, project, loadRuns, loadSiteSummaries]);

  useEffect(() => {
    if (!runPending && !projectRunPending) {
      setRunElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setRunElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setRunElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [runPending, projectRunPending]);

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
          pages_discovered: 1,
          current_batch_no: 1,
          current_url: selectedSite.start_url,
          progress_updated_at: new Date().toISOString(),
          failure_code: null,
          failure_message: null,
        },
        ...prev,
      ];
    });
    showRunToast({
      title: `Прогон «${selectedSite.name}» запущен`,
      body: "Crawler начал обход сайта. Результат и структура обновятся автоматически.",
      accent: "info",
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
      showRunToast({
        title: `Прогон «${selectedSite.name}» завершён`,
        body: "Новые результаты уже загружены. Можно открыть структуру и изменения.",
        accent: "success",
      });
      if (canViewEvents) void refreshEventCenterPollingNow().catch(() => undefined);
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
      showRunToast({
        title: `Прогон «${selectedSite.name}» завершился ошибкой`,
        body: e instanceof Error ? e.message : "Откройте карточку прогона, чтобы увидеть причину.",
        accent: "danger",
      });
      if (canViewEvents) void refreshEventCenterPollingNow().catch(() => undefined);
    } finally {
      setRunPending(false);
    }
  }

  async function handleStartAllSites() {
    if (!project || projectRunPending) return;
    setProjectRunPending(true);
    setProjectRunResult(null);
    setRunsError("");
    showRunToast({
      title: "Общий запуск начат",
      body: `Crawler последовательно проверяет включённые сайты проекта «${project.name}».`,
      accent: "info",
    });
    try {
      const result = await apiPost<ProjectRunBatch>(`/runs/start-project/${project.id}`, {});
      setProjectRunResult(result);
      await loadSiteSummaries(project.id, true);
      if (selectedSiteId !== null) await loadRuns(selectedSiteId, true);
      showRunToast({
        title: "Общий запуск завершён",
        body: `Успешно: ${result.finished}. С ошибкой: ${result.failed}. Пропущено: ${result.skipped}.`,
        accent: result.failed > 0 ? "warning" : "success",
      });
      if (canViewEvents) void refreshEventCenterPollingNow().catch(() => undefined);
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : "Не удалось запустить сайты проекта.");
      showRunToast({
        title: "Общий запуск завершился ошибкой",
        body: e instanceof Error ? e.message : "Не удалось получить результат запуска.",
        accent: "danger",
      });
      if (canViewEvents) void refreshEventCenterPollingNow().catch(() => undefined);
    } finally {
      setProjectRunPending(false);
    }
  }

  async function handleOpenPageContext(url: string) {
    if (structureRunId === null) return;
    setPageContextOpen(true);
    setPageContextLoading(true);
    setPageContextError("");
    setPageRetryMessage("");
    setPageRetrySucceeded(null);
    setPageContext(null);
    try {
      setPageContext(await getPageContext(structureRunId, url));
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

  async function handleRetryCurrentPage() {
    if (structureRunId === null || !pageContext || pageRetryPending) return;
    setPageRetryPending(true);
    setPageRetryMessage("");
    setPageRetrySucceeded(null);
    try {
      const result = await retryProblemPages(structureRunId, [pageContext.page.url]);
      const succeeded = result.succeeded > 0;
      setPageRetrySucceeded(succeeded);
      setPageRetryMessage(
        succeeded
          ? "Страница снова доступна. Исходный результат прогона сохранён."
          : result.skipped > 0
            ? "Лимит повторных попыток исчерпан."
            : "Повторная проверка завершена, но ошибка сохранилась.",
      );
      setPageContext(await getPageContext(structureRunId, pageContext.page.url));
    } catch (e) {
      setPageRetrySucceeded(false);
      setPageRetryMessage(e instanceof Error ? e.message : "Не удалось повторно проверить страницу.");
    } finally {
      setPageRetryPending(false);
    }
  }

  async function handleRetryAllProblemPages() {
    if (structureRunId === null || bulkRetryPending) return;
    setBulkRetryPending(true);
    setBulkRetryResult(null);
    setBulkRetryError("");
    try {
      const result = await retryProblemPages(structureRunId);
      setBulkRetryResult(result);
      setStructureRetryResultByUrl((current) => {
        const next = { ...current };
        for (const row of result.results) {
          next[row.url] = row.status === "SUCCEEDED" ? "success" : row.status === "FAILED" ? "failed" : "skipped";
        }
        return next;
      });
    } catch (e) {
      setBulkRetryError(e instanceof Error ? e.message : "Не удалось повторно проверить проблемные страницы.");
    } finally {
      setBulkRetryPending(false);
    }
  }

  async function handleRetryStructurePage(url: string) {
    if (structureRunId === null || structureRetryingUrl) return;
    setStructureRetryingUrl(url);
    setStructureRetryNotice("");
    try {
      const result = await retryProblemPages(structureRunId, [url]);
      const row = result.results[0];
      const state = row?.status === "SUCCEEDED" ? "success" : row?.status === "FAILED" ? "failed" : "skipped";
      setStructureRetryResultByUrl((current) => ({ ...current, [url]: state }));
      setStructureRetryNoticeTone(state === "success" ? "success" : "warning");
      setStructureRetryNotice(
        state === "success"
          ? "Страница снова доступна. Исходная ошибка сохранена в истории прогона."
          : state === "failed"
            ? "Страница проверена повторно, но ошибка сохранилась."
            : row?.message || "Повторная проверка сейчас недоступна.",
      );
    } catch (e) {
      setStructureRetryResultByUrl((current) => ({ ...current, [url]: "failed" }));
      setStructureRetryNoticeTone("warning");
      setStructureRetryNotice(e instanceof Error ? e.message : "Не удалось повторно проверить страницу.");
    } finally {
      setStructureRetryingUrl(null);
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
  const completedRunsWithPages = runs.filter(
    (run) => run.id > 0 && run.status !== "RUNNING" && run.pages_total > 0,
  );
  const structureRun = completedRunsWithPages[0] || null;
  const previousStructureRun = completedRunsWithPages[1] || null;
  const liveStructureRun = runs.find((run) => run.id > 0 && run.status === "RUNNING") || null;
  const displayedStructureRun = liveStructureRun || structureRun;
  const structureIsLive = liveStructureRun !== null;
  const lastSuccessfulRun = runs.find((r) => r.status === "FINISHED" && Boolean(r.finished_at)) || null;
  const hasRunning = runs.some((r) => r.status === "RUNNING");
  const structureUpdatePending = hasRunning || runPending || projectRunPending;
  const runsTotal = runs.length;
  const changedLast = lastRun?.pages_changed ?? 0;
  const pagesLast = lastRun?.pages_total ?? 0;
  const changedShareLast = pagesLast > 0 ? (changedLast / pagesLast) * 100 : 0;
  const lastRunDuration = lastRun ? formatDuration(lastRun.started_at, lastRun.finished_at) : "—";
  const structureRunId = displayedStructureRun?.id ?? null;
  const previousStructureRunId = structureIsLive
    ? structureRun?.id ?? null
    : previousStructureRun?.id ?? null;
  const coveragePercent = lastRunCoverage && lastRunCoverage.total > 0
    ? (lastRunCoverage.ok / lastRunCoverage.total) * 100
    : 0;

  const domainOptions = useMemo(() => ["all", ...domains], [domains]);

  useEffect(() => {
    if (!domainOptions.includes(selectedDomain)) setSelectedDomain("all");
  }, [domainOptions, selectedDomain]);

  useEffect(() => {
    if (structureRunId === null) {
      setLastRunCoverage(null);
      return;
    }
    let cancelled = false;
    setLastRunCoverageLoading(true);
    fetchRunPages(structureRunId)
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
  }, [structureRunId]);

  useEffect(() => {
    if (activeTab !== "main") return;
    if (structureRunId === null) {
      setLastRunPages([]);
      setPrevRunPages([]);
      return;
    }
    let cancelled = false;
    async function loadPages(silent = false) {
      if (!silent) setPagesLoading(true);
      if (!silent) setPagesError("");
      try {
        const [lastRows, prevRows] = await Promise.all([
          fetchRunPages(structureRunId),
          previousStructureRunId !== null
            ? fetchRunPages(previousStructureRunId)
            : Promise.resolve([] as ProjectPage[]),
        ]);
        if (cancelled) return;
        setLastRunPages(lastRows);
        setPrevRunPages(prevRows);
      } catch (e) {
        if (cancelled) return;
        setPagesError(String(e));
      } finally {
        if (!cancelled && !silent) setPagesLoading(false);
      }
    }
    void loadPages();
    const timer = structureIsLive
      ? window.setInterval(() => {
          void loadPages(true);
        }, 1200)
      : null;
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [activeTab, structureRunId, previousStructureRunId, structureIsLive]);

  useEffect(() => {
    setStructureRetryResultByUrl({});
    setStructureRetryNotice("");
    setStructureRetryNoticeTone("success");
    setBulkRetryResult(null);
    setBulkRetryError("");
  }, [selectedSiteId, structureRunId]);

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
      if (row.fetch_error_code || (row.final_status_code || row.status_code) >= 400) status = "error";
      else if (row.redirect_chain_json && row.redirect_chain_json.length > 1) status = "redirect";
      else if (!prevByUrl.has(row.url)) status = "added";
      else if ((prevByUrl.get(row.url) || "") !== (row.html_hash || "")) status = "changed";
      rows.push({
        url: row.url,
        domain: host,
        status,
        statusCode: row.status_code,
        batchNo: row.crawl_batch_no,
      });
    }
    if (!structureIsLive) {
      for (const row of prevRunPages) {
        const host = domainOf(row.url);
        if (selectedDomain !== "all" && host !== selectedDomain) continue;
        if (currentUrls.has(row.url)) continue;
        rows.push({
          url: row.url,
          domain: host,
          status: "deleted",
          statusCode: 0,
          batchNo: null,
        });
      }
    }
    rows.sort((a, b) => a.url.localeCompare(b.url));
    return rows;
  }, [lastRunPages, prevRunPages, selectedDomain, structureIsLive]);

  const structureRowsFiltered = useMemo(() => {
    const q = structureSearch.trim().toLowerCase();
    return structureRows.filter((row) => {
      if (structureViewFilter !== "all" && row.status !== structureViewFilter) return false;
      return !q || row.url.toLowerCase().includes(q);
    });
  }, [structureRows, structureSearch, structureViewFilter]);
  const structureStatusCounts = useMemo(
    () => ({
      added: structureRows.filter((row) => row.status === "added").length,
      error: structureRows.filter((row) => row.status === "error").length,
      changed: structureRows.filter((row) => row.status === "changed").length,
    }),
    [structureRows],
  );
  const problemPagesCount = useMemo(
    () => lastRunPages.filter(
      (row) => Boolean(row.fetch_error_code) || (row.final_status_code || row.status_code) >= 400,
    ).length,
    [lastRunPages],
  );

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
                    setLastRunPages([]);
                    setPrevRunPages([]);
                    setRunsError("");
                    setPagesError("");
                    setStructureSearch("");
                    setStructureViewFilter("all");
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
                        <MetaText opacity={0.68}>
                          {structureIsLive
                            ? `Структура строится в реальном времени · run #${liveStructureRun.id}`
                            : structureUpdatePending && structureRun
                              ? `Показан последний готовый срез · run #${structureRun.id}`
                              : structureRun
                                ? `Готовый срез · run #${structureRun.id}`
                              : "Структура появится после первого успешного обхода"}
                        </MetaText>
                      </div>
                    }
                    actions={(
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {canRunCrawler && problemPagesCount > 0 && (
                          <CardActionButton
                            variant="secondary"
                            disabled={bulkRetryPending || structureUpdatePending}
                            title={
                              structureUpdatePending
                                ? "Повторная проверка станет доступна после завершения текущего прогона."
                                : "Повторно проверить проблемные страницы без изменения исходного результата."
                            }
                            onClick={() => void handleRetryAllProblemPages()}
                          >
                            {bulkRetryPending ? "Проверяем..." : `Повторить проблемные · ${problemPagesCount}`}
                          </CardActionButton>
                        )}
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
                      </div>
                    )}
                  />
                  {structureUpdatePending && (
                    <Card variant="hint" style={{ padding: 10, display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span
                          className="project-run-spinner"
                          aria-hidden="true"
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            border: "2px solid currentColor",
                            borderTopColor: "transparent",
                            display: "inline-block",
                            flex: "0 0 auto",
                          }}
                        />
                        <StatusText tone="success">
                          {projectRunPending ? "Идёт общий запуск сайтов проекта" : "Идёт сканирование выбранного сайта"}
                        </StatusText>
                        </div>
                        <MetaText opacity={0.72}>Прошло: {runElapsedSeconds} сек.</MetaText>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
                        <span style={{ color: "#8fd18f" }}>✓ Запуск принят</span>
                        <span style={{ opacity: 0.45 }}>→</span>
                        <span className="project-run-live-stage">● Crawler обходит страницы</span>
                        <span style={{ opacity: 0.45 }}>→</span>
                        <span style={{ opacity: 0.62 }}>Обновление структуры</span>
                      </div>
                      {liveStructureRun?.current_url && (
                        <Card style={{ padding: 8, display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                          <span
                            className="project-run-spinner"
                            aria-hidden="true"
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              border: "2px solid currentColor",
                              borderTopColor: "transparent",
                              display: "inline-block",
                              flex: "0 0 auto",
                            }}
                          />
                          <MetaText style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            Сейчас обрабатывается: {liveStructureRun.current_url}
                          </MetaText>
                        </Card>
                      )}
                      {liveStructureRun && (
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
                          <span style={{ color: "#8fd18f" }}>
                            ✓ Готово: {liveStructureRun.pages_total}
                          </span>
                          <span>Обнаружено: {Math.max(liveStructureRun.pages_discovered, liveStructureRun.pages_total)}</span>
                          <span style={{ opacity: 0.72 }}>
                            В очереди: {Math.max(0, liveStructureRun.pages_discovered - liveStructureRun.pages_total)}
                          </span>
                          <span style={{ opacity: 0.72 }}>Текущий батч: {liveStructureRun.current_batch_no}</span>
                        </div>
                      )}
                      <MetaText opacity={0.72}>
                        {structureIsLive
                          ? `Уже добавлено в текущий срез: ${lastRunPages.length}. Новые страницы появляются автоматически; дерево не прокручивается само и не сбивает ваше место.`
                          : structureRun
                          ? "Пока показываем последнюю готовую структуру. После завершения нужного прогона она обновится автоматически."
                          : "Собираем первый срез. Структура появится автоматически после завершения нужного прогона."}
                      </MetaText>
                    </Card>
                  )}
                  {!structureUpdatePending && structureRun && (
                    <Card
                      variant={structureStatusCounts.error > 0 ? "warning" : "hint"}
                      style={{ padding: 10, display: "grid", gap: 8 }}
                    >
                      <SectionHeaderRow
                        title={
                          <div>
                            <div style={{ fontWeight: 700 }}>Прогон завершён — структура готова</div>
                            <MetaText opacity={0.68}>
                              Run #{structureRun.id} · {formatDuration(structureRun.started_at, structureRun.finished_at)}
                            </MetaText>
                          </div>
                        }
                        actions={<ProjectRunBadge status={structureRun.status} />}
                      />
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
                        <span>Страниц: {structureRun.pages_total}</span>
                        <span style={{ color: "#8fb7ff" }}>Новых: {structureStatusCounts.added}</span>
                        <span>Изменённых: {structureStatusCounts.changed}</span>
                        <span style={{ color: structureStatusCounts.error > 0 ? "#e7a15a" : "#8fd18f" }}>
                          Ошибок: {structureStatusCounts.error}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {structureStatusCounts.added > 0 && (
                          <CardActionButton
                            compact
                            variant="secondary"
                            onClick={() => setStructureViewFilter("added")}
                          >
                            Показать новые
                          </CardActionButton>
                        )}
                        {structureStatusCounts.error > 0 && (
                          <CardActionButton
                            compact
                            variant="secondary"
                            onClick={() => setStructureViewFilter("error")}
                          >
                            Показать ошибки
                          </CardActionButton>
                        )}
                      </div>
                    </Card>
                  )}
                  {pagesLoading && (
                    <Card variant="hint" style={{ padding: 10, display: "flex", gap: 8, alignItems: "center" }}>
                      <span
                        className="project-run-spinner"
                        aria-hidden="true"
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          border: "2px solid currentColor",
                          borderTopColor: "transparent",
                          display: "inline-block",
                          flex: "0 0 auto",
                        }}
                      />
                      <MetaText>Загружаем готовую структуру и сравниваем её с предыдущим прогоном...</MetaText>
                    </Card>
                  )}
                  {bulkRetryError && <StatusText tone="danger">{bulkRetryError}</StatusText>}
                  {bulkRetryResult && (
                    <Card
                      variant={bulkRetryResult.failed > 0 ? "warning" : "hint"}
                      style={{ padding: 10, display: "grid", gap: 5 }}
                    >
                      <StatusText tone={bulkRetryResult.failed > 0 ? "warning" : "success"}>
                        Повторная проверка: доступно {bulkRetryResult.succeeded}, ошибка сохранилась {bulkRetryResult.failed}, пропущено {bulkRetryResult.skipped}.
                      </StatusText>
                      <MetaText opacity={0.68}>{bulkRetryResult.message}</MetaText>
                    </Card>
                  )}
                  {structureRetryNotice && (
                    <Card
                      variant={structureRetryNoticeTone === "success" ? "hint" : "warning"}
                      style={{ padding: 10 }}
                    >
                      <StatusText tone={structureRetryNoticeTone}>{structureRetryNotice}</StatusText>
                    </Card>
                  )}
                  <SectionHeaderRow
                    title={<ListTotalMeta label="Узлов (текущий срез)" total={structureRows.length} />}
                    actions={
                      structureRows.length > 0 ? (
                        <SegmentedControl
                          value={structureViewFilter}
                          onChange={setStructureViewFilter}
                          options={[
                            { value: "all", label: `Все · ${structureRows.length}` },
                            { value: "added", label: `Новые · ${structureStatusCounts.added}` },
                            { value: "error", label: `Ошибки · ${structureStatusCounts.error}` },
                          ]}
                        />
                      ) : undefined
                    }
                    style={{ alignItems: "flex-start", flexWrap: "wrap" }}
                  />
                  {pagesError && (
                    <StatusText tone="danger">
                      Не удалось обновить структуру. Последний загруженный срез сохранён: {pagesError}
                    </StatusText>
                  )}
                  {(!pagesLoading || structureRows.length > 0) && (
                    <>
                      <StructureLegendHint />
                      <ClearableInput
                        value={structureSearch}
                        onChange={setStructureSearch}
                        placeholder="Поиск по URL/пути (meta-поиск добавим после подключения snapshots)..."
                      />
                    </>
                  )}
                  {!pagesLoading && structureRows.length === 0 && (
                    <MetaText>
                      {structureUpdatePending
                        ? "Первый прогон ещё выполняется — здесь появятся найденные страницы после его завершения."
                        : "Структура пока недоступна: выполните как минимум один прогон."}
                    </MetaText>
                  )}
                  {structureRows.length > 0 && structureRowsFiltered.length > 0 && (
                    <ProjectStructureTree
                      rows={structureRowsFiltered}
                      query={structureSearch}
                      onPageSelect={(url) => void handleOpenPageContext(url)}
                      canRetry={canRunCrawler && !structureUpdatePending}
                      retryingUrl={structureRetryingUrl}
                      retryResultByUrl={structureRetryResultByUrl}
                      onRetryPage={(url) => void handleRetryStructurePage(url)}
                      live={structureIsLive}
                      currentBatchNo={liveStructureRun?.current_batch_no ?? null}
                    />
                  )}
                  {structureRows.length > 0 && structureRowsFiltered.length === 0 && (
                    <MetaText>
                      {structureViewFilter === "added"
                        ? "В текущем срезе нет новых страниц."
                        : structureViewFilter === "error"
                          ? "В текущем срезе нет страниц с ошибками."
                          : "По текущему поиску совпадений не найдено."}
                    </MetaText>
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
      <ToastHost
        items={runToasts}
        onClose={(toastId) => setRunToasts((current) => current.filter((item) => item.id !== toastId))}
        autoCloseMs={7000}
      />
      <PageContextDrawer
        open={pageContextOpen}
        loading={pageContextLoading}
        error={pageContextError}
        context={pageContext}
        canRetry={canRunCrawler && !structureUpdatePending}
        retryPending={pageRetryPending}
        retryMessage={pageRetryMessage}
        retrySucceeded={pageRetrySucceeded}
        onRetry={() => void handleRetryCurrentPage()}
        onClose={() => {
          setPageContextOpen(false);
          setPageContextError("");
        }}
      />
    </div>
  );
}
