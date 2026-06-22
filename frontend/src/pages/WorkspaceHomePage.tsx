import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiDelete } from "../api/client";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import CardActionButton from "../components/ui/CardActionButton";
import CardFooterActions from "../components/ui/CardFooterActions";
import ClearableInput from "../components/ui/ClearableInput";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import EmptyState from "../components/ui/EmptyState";
import ListTotalMeta from "../components/ui/ListTotalMeta";
import ProjectDomainPills from "../components/ui/ProjectDomainPills";
import ProjectInfoBadge from "../components/ui/ProjectInfoBadge";
import ProjectRunBadge, { getProjectRunBadgeMeta } from "../components/ui/ProjectRunBadge";
import { StatusText } from "../components/ui/StatusText";
import { getProfilesSummaryCached, invalidateProfilesCache, type ProfileSummaryItem } from "../utils/profileListCache";
import { applyProjectRunLiveUpdate, subscribeProjectRunLive } from "../utils/projectRunLiveStore";

export default function WorkspaceHomePage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProfileSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProfileSummaryItem | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.start_url.toLowerCase().includes(q) ||
        (p.allowed_domains_csv || "").toLowerCase().includes(q),
    );
  }, [projects, search]);

  useEffect(() => {
    setLoading(true);
    setError("");
    getProfilesSummaryCached(false)
      .then((items) => setProjects(items))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => subscribeProjectRunLive((update) => {
    setProjects((prev) => prev.map((row) => applyProjectRunLiveUpdate(row, update)));
  }), []);

  async function confirmDeleteProject() {
    if (!deleteTarget) return;
    setDeletePending(true);
    setError("");
    try {
      await apiDelete(`/profiles/${deleteTarget.id}`);
      const next = projects.filter((x) => x.id !== deleteTarget.id);
      setProjects(next);
      invalidateProfilesCache();
      void getProfilesSummaryCached(true);
      setDeleteTarget(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 860 }}>
      <h2 style={{ marginTop: 0 }}>{"\u0420\u0430\u0431\u043e\u0447\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c"}</h2>
      <Card>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Проекты</div>
            <Button variant="primary" onClick={() => navigate("/profiles/new")}>
              + Создать проект
            </Button>
          </div>

          <ClearableInput
            value={search}
            onChange={setSearch}
            placeholder="Поиск проектов..."
          />
          <ListTotalMeta label="Проектов" total={filtered.length} />

          {loading && <div>Загрузка...</div>}
          {error && <StatusText tone="danger">{error}</StatusText>}

          {!loading && !error && filtered.length === 0 && <EmptyState text="Проектов пока нет." />}

          {!loading && !error && filtered.length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              {filtered.map((p) => {
                const status = getProjectRunBadgeMeta(p.last_run?.status);
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
                      padding: "10px 12px",
                      background: status.rowBaseBg,
                      border: `1px solid ${status.rowBaseBorder}`,
                      display: "grid",
                      gap: 8,
                    } as CSSProperties}
                    onClick={() => navigate(`/profiles/${p.id}`, { state: { projectName: p.name } })}
                    >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div
                          title={p.name}
                          style={{
                            fontWeight: 700,
                            minWidth: 0,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: "min(42vw, 420px)",
                          }}
                        >
                          {p.name}
                        </div>
                        <ProjectRunBadge status={p.last_run?.status} />
                      </div>
                    </div>
                    <ProjectDomainPills csv={p.allowed_domains_csv} fallbackUrl={p.start_url} />
                    <div>
                      <ProjectInfoBadge label={`прогонов: ${p.runs_total}`} />
                    </div>
                    <CardFooterActions>
                      <CardActionButton
                        variant="danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteTarget(p);
                        }}
                      >
                        Удалить
                      </CardActionButton>
                    </CardFooterActions>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </Card>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить проект?"
        description={deleteTarget ? `Проект "${deleteTarget.name}" будет удален без возможности восстановления.` : ""}
        confirmText="Удалить"
        cancelText="Отмена"
        confirmVariant="danger"
        loading={deletePending}
        onConfirm={() => {
          void confirmDeleteProject();
        }}
        onCancel={() => {
          if (deletePending) return;
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
