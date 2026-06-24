import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, apiDelete, apiGet, apiPost } from "../api/client";
import Card from "../components/ui/Card";
import CardActionButton from "../components/ui/CardActionButton";
import CardFooterActions from "../components/ui/CardFooterActions";
import ClearableInput from "../components/ui/ClearableInput";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import ListTotalMeta from "../components/ui/ListTotalMeta";
import ProjectDomainPills from "../components/ui/ProjectDomainPills";
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
  const [runs, setRuns] = useState<ProjectRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runPending, setRunPending] = useState(false);
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
  const canRunCrawler = hasPermission(user?.role, "crawler.run");
  const canEditProject = hasPermission(user?.role, "profiles.edit");

  async function fetchRunPages(runId: number): Promise<ProjectPage[]> {
    const rows = await apiGet<ProjectPage[]>(`/runs/${runId}/pages`);
    return Array.isArray(rows) ? rows : [];
  }

  async function loadRuns(profileId: string, silent = false) {
    if (!silent) setRunsLoading(true);
    setRunsError("");
    try {
      const data = await apiGet<ProjectRun[]>(`/runs/by-profile/${profileId}`);
      const next = Array.isArray(data) ? data : [];
      setRuns(next);
      const first = next[0];
      if (first) {
        publishProjectRunLive({
          profileId: Number(profileId),
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
  }

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError("");
    setProject(null);
    apiGet<ProjectProfile>(`/profiles/${id}`)
      .then(setProject)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    void loadRuns(id);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const hasRunning = runs.some((r) => r.status === "RUNNING");
    if (!hasRunning) return;
    const timer = window.setInterval(() => {
      void loadRuns(id, true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [id, runs]);

  async function handleStartRun() {
    if (!project || runPending) return;
    setRunPending(true);
    setRunsError("");
    setRuns((prev) => {
      if (prev.some((r) => r.status === "RUNNING")) return prev;
      return [
        {
          id: -Date.now(),
          profile_id: project.id,
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
      await apiPost(`/runs/start/${project.id}`, {});
      await loadRuns(String(project.id), true);
    } catch (e) {
      await loadRuns(String(project.id), true);
      if (e instanceof ApiError && e.code === "run_already_active") {
        setRunsError("Для этого проекта уже выполняется прогон. Другие проекты можно запускать независимо.");
      } else if (e instanceof ApiError && e.status !== 502) {
        setRunsError(e.message);
      } else if (!(e instanceof ApiError)) {
        setRunsError("Не удалось запустить прогон.");
      }
    } finally {
      setRunPending(false);
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

  const domains = useMemo(() => parseDomains(project?.allowed_domains_csv || ""), [project?.allowed_domains_csv]);
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
                      variant="primary"
                      onClick={() => {
                        void handleStartRun();
                      }}
                      disabled={runPending || hasRunning}
                      title={hasRunning ? "Этот проект уже сканируется. Другие проекты можно запускать независимо." : undefined}
                    >
                      {runPending ? "Запуск..." : hasRunning ? "Прогон выполняется" : "Запустить прогон"}
                    </CardActionButton>
                  </div>
                ) : undefined}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <MetaText opacity={0.86}>
                  Ручной запуск доступен сейчас. Параметры сканирования и статус расписания находятся в настройках проекта.
                </MetaText>
              </div>
              {hasRunning && (
                <MetaText opacity={0.72}>
                  Сейчас сканируется только этот проект. В других проектах запуск остается доступен.
                </MetaText>
              )}
              <ProjectDomainPills csv={project.allowed_domains_csv} fallbackUrl={project.start_url} />
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
              <Card>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>Последний прогон</div>
                  {runsError ? <StatusText tone="danger">{runsError}</StatusText> : null}
                  {!runsLoading && !lastRun && (
                    <div style={{ display: "grid", gap: 8 }}>
                      <MetaText>Прогонов пока нет. Запустите первый сбор, чтобы получить структуру и метрики проекта.</MetaText>
                      {canRunCrawler && <div>
                        <CardActionButton
                          variant="primary"
                          onClick={() => void handleStartRun()}
                          disabled={runPending || hasRunning}
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
                                disabled={runPending || hasRunning}
                              >
                                Повторить
                              </CardActionButton>
                              <CardActionButton
                                variant="secondary"
                                onClick={() => window.open(project.start_url, "_blank", "noopener,noreferrer")}
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
                                Код: {lastRun.failure_code || "unknown_error"}; run #{lastRun.id}; адрес: {project.start_url}
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
                    <ProjectStructureTree rows={structureRowsFiltered} query={structureSearch} />
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
                  title={<div style={{ fontWeight: 700 }}>История прогонов</div>}
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
              <Card>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontWeight: 700 }}>Основные параметры</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                    <Card style={{ padding: 10, display: "grid", gap: 6 }}>
                      <MetaText opacity={0.68}>Название</MetaText>
                      <div style={{ fontWeight: 700 }}>{project.name}</div>
                    </Card>
                    <Card style={{ padding: 10, display: "grid", gap: 6 }}>
                      <MetaText opacity={0.68}>Стартовый адрес</MetaText>
                      <div style={{ wordBreak: "break-word" }}>{project.start_url}</div>
                    </Card>
                    <Card style={{ padding: 10, display: "grid", gap: 6 }}>
                      <MetaText opacity={0.68}>Состояние проекта</MetaText>
                      <StatusText tone={project.is_enabled ? "success" : "warning"}>
                        {project.is_enabled ? "Активен" : "Отключен"}
                      </StatusText>
                    </Card>
                  </div>
                  <div>
                    <MetaText opacity={0.68} style={{ marginBottom: 6 }}>Разрешенные домены</MetaText>
                    <ProjectDomainPills csv={project.allowed_domains_csv} fallbackUrl={project.start_url} />
                  </div>
                  <MetaText opacity={0.68}>
                    Редактирование названия и области сканирования появится вместе с безопасным update API и проверкой canonical scope.
                  </MetaText>
                </div>
              </Card>

              <Card>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontWeight: 700 }}>Сканирование и лимиты</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                    <Card style={{ padding: 10 }}>
                      <MetaText opacity={0.68}>Лимит страниц</MetaText>
                      <div style={{ marginTop: 6, fontWeight: 800, fontSize: 20 }}>{project.max_pages}</div>
                    </Card>
                    <Card style={{ padding: 10 }}>
                      <MetaText opacity={0.68}>Параллельность</MetaText>
                      <div style={{ marginTop: 6, fontWeight: 800, fontSize: 20 }}>{project.concurrency}</div>
                    </Card>
                    <Card style={{ padding: 10 }}>
                      <MetaText opacity={0.68}>robots.txt</MetaText>
                      <div style={{ marginTop: 6, fontWeight: 700 }}>{project.respect_robots ? "Соблюдается" : "Игнорируется"}</div>
                    </Card>
                  </div>
                  <MetaText opacity={0.68}>
                    Исключения путей: {project.exclude_paths_csv || "не заданы"}
                  </MetaText>
                  <MetaText opacity={0.68}>
                    Исключения расширений: {project.exclude_ext_csv || "не заданы"}
                  </MetaText>
                </div>
              </Card>

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
    </div>
  );
}
