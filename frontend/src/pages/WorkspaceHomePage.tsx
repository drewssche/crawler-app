import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import ClearableInput from "../components/ui/ClearableInput";
import EmptyState from "../components/ui/EmptyState";
import ListTotalMeta from "../components/ui/ListTotalMeta";
import ProjectRunBadge, { getProjectRunBadgeMeta } from "../components/ui/ProjectRunBadge";
import HighlightedText from "../components/ui/HighlightedText";
import { MetaText, StatusText } from "../components/ui/StatusText";
import { formatOperationalDateTime } from "../utils/datetime";
import { getProjectsSummaryCached, type ProjectSummaryItem } from "../utils/projectListCache";
import { applyProjectRunLiveUpdate, subscribeProjectRunLive } from "../utils/projectRunLiveStore";
import { isMeaningfulProjectSearch, searchProjects, shouldShowProjectMatchHint } from "../utils/projectSearch";
import { summarizeProjectDomains } from "../utils/projectDomains";
import { useAuth } from "../hooks/auth";
import { hasPermission } from "../utils/permissions";

function lastRunLabel(project: ProjectSummaryItem): string {
  const run = project.last_run;
  if (!run) return "Еще не запускался";
  if (run.status === "RUNNING") {
    return run.started_at ? `Запущен ${formatOperationalDateTime(run.started_at)}` : "Прогон выполняется";
  }
  const timestamp = run.finished_at || run.started_at;
  return timestamp ? `Последний прогон ${formatOperationalDateTime(timestamp)}` : "Время прогона не указано";
}

export default function WorkspaceHomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => searchProjects(projects, search), [projects, search]);
  const searchActive = isMeaningfulProjectSearch(search);
  const canEditProjects = hasPermission(user?.role, "profiles.edit");

  useEffect(() => {
    getProjectsSummaryCached(false)
      .then((items) => setProjects(items))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => subscribeProjectRunLive((update) => {
    setProjects((prev) => prev.map((row) => applyProjectRunLiveUpdate(row, update)));
  }), []);

  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 1040 }}>
      <h2 style={{ marginTop: 0 }}>{"\u0420\u0430\u0431\u043e\u0447\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c"}</h2>
      <Card>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Проекты</div>
            {canEditProjects && (
              <Button variant="primary" onClick={() => navigate("/profiles/new")}>
                + Создать проект
              </Button>
            )}
          </div>

          <ClearableInput
            value={search}
            onChange={setSearch}
            placeholder="Поиск проектов..."
          />
          <ListTotalMeta label="Проектов" total={filtered.length} />

          {loading && <div>Загрузка...</div>}
          {error && <StatusText tone="danger">{error}</StatusText>}

          {!loading && !error && filtered.length === 0 && (
            searchActive ? (
              <Card variant="hint" style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>Проекты не найдены</div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>По запросу «{search.trim()}» нет совпадений.</div>
                <div>
                  <Button size="sm" variant="ghost" onClick={() => setSearch("")}>Очистить поиск</Button>
                </div>
              </Card>
            ) : (
              <EmptyState text="Проектов пока нет." />
            )
          )}

          {!loading && !error && filtered.length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              {filtered.map((match) => {
                const p = match.project;
                const status = getProjectRunBadgeMeta(p.last_run?.status);
                const domainSummary = summarizeProjectDomains(p.allowed_domains_csv, p.start_url);
                const showMatchHint = shouldShowProjectMatchHint(match, [
                  p.name,
                  domainSummary,
                ]);
                const openProject = () => navigate(`/profiles/${p.id}`, { state: { projectName: p.name } });
                return (
                  <Card
                    key={p.id}
                    interactive
                    className="project-row"
                    style={{
                      // Status-specific soft accent with shared hover animation.
                      "--project-row-base-bg": status.rowBaseBg,
                      "--project-row-base-border": status.rowBaseBorder,
                      "--project-row-hover-bg": status.rowHoverBg,
                      "--project-row-hover-border": status.rowHoverBorder,
                      padding: "9px 12px",
                      background: status.rowBaseBg,
                      border: `1px solid ${status.rowBaseBorder}`,
                      display: "grid",
                      gap: 6,
                    } as CSSProperties}
                    onClick={openProject}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openProject();
                      }
                    }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "center" }}>
                      <div style={{ minWidth: 0 }}>
                        <div
                          title={p.name}
                          style={{
                            fontWeight: 750,
                            minWidth: 0,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          <HighlightedText value={p.name} query={match.highlightQuery} />
                        </div>
                        <MetaText opacity={0.7} style={{ marginTop: 3, wordBreak: "break-word" }}>
                          <HighlightedText value={domainSummary} query={match.highlightQuery} />
                        </MetaText>
                      </div>
                      <ProjectRunBadge status={p.last_run?.status} />
                    </div>
                    {showMatchHint && match.matchedValue && (
                      <div style={{ fontSize: 12, opacity: 0.72 }}>
                        Совпадение: <HighlightedText value={match.matchedValue} query={match.highlightQuery} />
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 10,
                        alignItems: "center",
                        fontSize: 12,
                      }}
                    >
                      <MetaText opacity={0.72} style={{ flex: "1 1 220px" }}>{lastRunLabel(p)}</MetaText>
                      <MetaText opacity={0.72} style={{ flex: "0 1 110px" }}>
                        Страниц: <strong>{p.last_run ? p.last_run.pages_total : "—"}</strong>
                      </MetaText>
                      <MetaText opacity={0.72} style={{ flex: "0 1 120px" }}>
                        Изменений: <strong>{p.last_run ? p.last_run.pages_changed : "—"}</strong>
                      </MetaText>
                      <MetaText opacity={0.72} style={{ flex: "0 1 100px" }}>
                        Прогонов: <strong>{p.runs_total}</strong>
                      </MetaText>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
