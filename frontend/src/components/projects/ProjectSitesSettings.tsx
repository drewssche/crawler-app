import { useCallback, useEffect, useState } from "react";
import {
  createProjectSite,
  deleteProjectSite,
  listProjectSites,
  updateProjectSite,
  type ProjectSite,
  type SiteScopeMode,
} from "../../api/projectSites";
import { ApiError } from "../../api/client";
import { normalizePathPrefix, normalizeSiteUrl, validateSiteDraft } from "../../utils/siteScope";
import Card from "../ui/Card";
import CardActionButton from "../ui/CardActionButton";
import CardFooterActions from "../ui/CardFooterActions";
import ConfirmDialog from "../ui/ConfirmDialog";
import SectionHeaderRow from "../ui/SectionHeaderRow";
import { MetaText, StatusText } from "../ui/StatusText";
import SiteScopeFields from "./SiteScopeFields";

type Draft = {
  name: string;
  startUrl: string;
  scopeMode: SiteScopeMode;
  pathPrefix: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  startUrl: "",
  scopeMode: "whole_site",
  pathPrefix: "/",
};

function draftFromSite(site: ProjectSite): Draft {
  return {
    name: site.name,
    startUrl: site.start_url,
    scopeMode: site.scope_mode,
    pathPrefix: site.path_prefix,
  };
}

function scopeLabel(site: ProjectSite): string {
  return site.scope_mode === "whole_site" ? "Весь сайт" : `Раздел ${site.path_prefix}`;
}

export default function ProjectSitesSettings({
  profileId,
  onChanged,
}: {
  profileId: number;
  onChanged?: () => void;
}) {
  const [sites, setSites] = useState<ProjectSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [pendingId, setPendingId] = useState<number | "new" | null>(null);
  const [deleteSite, setDeleteSite] = useState<ProjectSite | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSites(await listProjectSites(profileId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить сайты проекта.");
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateDraftField(setter: typeof setDraft, key: keyof Draft, value: string) {
    setter((current) => ({ ...current, [key]: value }));
  }

  async function handleCreate() {
    const validationError = validateSiteDraft(draft.startUrl, draft.scopeMode, draft.pathPrefix);
    if (validationError) {
      setError(validationError);
      return;
    }
    setPendingId("new");
    setError("");
    setMessage("");
    try {
      const created = await createProjectSite(profileId, {
        name: draft.name.trim() || new URL(normalizeSiteUrl(draft.startUrl)).hostname,
        start_url: normalizeSiteUrl(draft.startUrl),
        scope_mode: draft.scopeMode,
        path_prefix: draft.scopeMode === "path_prefix" ? normalizePathPrefix(draft.pathPrefix) : "/",
        role: "peer",
      });
      setSites((current) => [...current, created]);
      setDraft(EMPTY_DRAFT);
      setAdding(false);
      setMessage("Сайт добавлен. Его прогоны и результаты будут храниться отдельно.");
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "project_site_scope_conflict"
          ? "Сайт с такой областью мониторинга уже есть в проекте."
          : err instanceof Error ? err.message : "Не удалось добавить сайт.",
      );
    } finally {
      setPendingId(null);
    }
  }

  async function handleSave(site: ProjectSite) {
    const validationError = validateSiteDraft(editDraft.startUrl, editDraft.scopeMode, editDraft.pathPrefix);
    if (validationError) {
      setError(validationError);
      return;
    }
    setPendingId(site.id);
    setError("");
    setMessage("");
    try {
      const updated = await updateProjectSite(profileId, site.id, {
        name: editDraft.name.trim(),
        start_url: normalizeSiteUrl(editDraft.startUrl),
        scope_mode: editDraft.scopeMode,
        path_prefix: editDraft.scopeMode === "path_prefix" ? normalizePathPrefix(editDraft.pathPrefix) : "/",
      });
      setSites((current) => current.map((row) => row.id === updated.id ? updated : row));
      setEditingId(null);
      setMessage("Настройки сайта сохранены.");
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "project_site_scope_conflict"
          ? "Сайт с такой областью мониторинга уже есть в проекте."
          : err instanceof Error ? err.message : "Не удалось сохранить сайт.",
      );
    } finally {
      setPendingId(null);
    }
  }

  async function handleToggle(site: ProjectSite) {
    setPendingId(site.id);
    setError("");
    setMessage("");
    try {
      const updated = await updateProjectSite(profileId, site.id, { is_enabled: !site.is_enabled });
      setSites((current) => current.map((row) => row.id === updated.id ? updated : row));
      setMessage(updated.is_enabled ? "Сайт включён." : "Сайт отключён. История сохранена.");
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить состояние сайта.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteSite) return;
    setPendingId(deleteSite.id);
    setError("");
    setMessage("");
    try {
      await deleteProjectSite(profileId, deleteSite.id);
      setSites((current) => current.filter((row) => row.id !== deleteSite.id));
      setDeleteSite(null);
      setMessage("Сайт удалён.");
      onChanged?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === "project_site_has_runs") {
        setError("У сайта уже есть история. Отключите его — данные останутся доступны.");
      } else if (err instanceof ApiError && err.code === "project_requires_site") {
        setError("В проекте должен оставаться хотя бы один сайт.");
      } else {
        setError(err instanceof Error ? err.message : "Не удалось удалить сайт.");
      }
      setDeleteSite(null);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card>
      <div style={{ display: "grid", gap: 10 }}>
        <SectionHeaderRow
          title={
            <div>
              <div style={{ fontWeight: 700 }}>Сайты проекта</div>
              <MetaText opacity={0.68}>Каждый сайт имеет собственную область, историю и результаты.</MetaText>
            </div>
          }
          actions={
            <CardActionButton
              variant="primary"
              onClick={() => {
                setAdding((value) => !value);
                setError("");
                setMessage("");
              }}
            >
              {adding ? "Закрыть форму" : "+ Добавить сайт"}
            </CardActionButton>
          }
        />

        {loading && <MetaText>Загрузка сайтов...</MetaText>}
        {error && <StatusText tone="danger">{error}</StatusText>}
        {message && <StatusText tone="success">{message}</StatusText>}

        {adding && (
          <Card variant="hint" style={{ display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 700 }}>Новый сайт</div>
            <SiteScopeFields
              name={draft.name}
              startUrl={draft.startUrl}
              scopeMode={draft.scopeMode}
              pathPrefix={draft.pathPrefix}
              disabled={pendingId === "new"}
              onNameChange={(value) => updateDraftField(setDraft, "name", value)}
              onStartUrlChange={(value) => updateDraftField(setDraft, "startUrl", value)}
              onScopeModeChange={(value) => updateDraftField(setDraft, "scopeMode", value)}
              onPathPrefixChange={(value) => updateDraftField(setDraft, "pathPrefix", value)}
            />
            <CardFooterActions>
              <CardActionButton variant="primary" disabled={pendingId === "new"} onClick={() => void handleCreate()}>
                {pendingId === "new" ? "Добавление..." : "Добавить сайт"}
              </CardActionButton>
              <CardActionButton variant="ghost" disabled={pendingId === "new"} onClick={() => setAdding(false)}>
                Отмена
              </CardActionButton>
            </CardFooterActions>
          </Card>
        )}

        {!loading && sites.map((site) => {
          const editing = editingId === site.id;
          return (
            <Card key={site.id} style={{ display: "grid", gap: 9 }}>
              {editing ? (
                <>
                  <SiteScopeFields
                    name={editDraft.name}
                    startUrl={editDraft.startUrl}
                    scopeMode={editDraft.scopeMode}
                    pathPrefix={editDraft.pathPrefix}
                    disabled={pendingId === site.id}
                    onNameChange={(value) => updateDraftField(setEditDraft, "name", value)}
                    onStartUrlChange={(value) => updateDraftField(setEditDraft, "startUrl", value)}
                    onScopeModeChange={(value) => updateDraftField(setEditDraft, "scopeMode", value)}
                    onPathPrefixChange={(value) => updateDraftField(setEditDraft, "pathPrefix", value)}
                  />
                  <CardFooterActions>
                    <CardActionButton variant="primary" disabled={pendingId === site.id} onClick={() => void handleSave(site)}>
                      {pendingId === site.id ? "Сохранение..." : "Сохранить"}
                    </CardActionButton>
                    <CardActionButton variant="ghost" disabled={pendingId === site.id} onClick={() => setEditingId(null)}>
                      Отмена
                    </CardActionButton>
                  </CardFooterActions>
                </>
              ) : (
                <>
                  <SectionHeaderRow
                    title={
                      <div>
                        <div style={{ fontWeight: 700 }}>{site.name}</div>
                        <MetaText opacity={0.72} style={{ wordBreak: "break-word" }}>{site.start_url}</MetaText>
                      </div>
                    }
                    actions={
                      <StatusText tone={site.is_enabled ? "success" : "warning"}>
                        {site.is_enabled ? "Включён" : "Отключён"}
                      </StatusText>
                    }
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <MetaText>Область: {scopeLabel(site)}</MetaText>
                    <MetaText>Лимит: {site.max_pages} страниц</MetaText>
                    <MetaText>Роль: {site.role}</MetaText>
                  </div>
                  <CardFooterActions>
                    <CardActionButton
                      variant="secondary"
                      onClick={() => {
                        setEditingId(site.id);
                        setEditDraft(draftFromSite(site));
                        setError("");
                        setMessage("");
                      }}
                    >
                      Изменить
                    </CardActionButton>
                    <CardActionButton
                      variant="ghost"
                      disabled={pendingId === site.id}
                      onClick={() => void handleToggle(site)}
                    >
                      {site.is_enabled ? "Отключить" : "Включить"}
                    </CardActionButton>
                    <CardActionButton
                      variant="danger"
                      disabled={sites.length <= 1 || pendingId === site.id}
                      title={sites.length <= 1 ? "В проекте должен оставаться хотя бы один сайт." : undefined}
                      onClick={() => setDeleteSite(site)}
                    >
                      Удалить
                    </CardActionButton>
                  </CardFooterActions>
                </>
              )}
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={Boolean(deleteSite)}
        title="Удалить сайт?"
        description={
          deleteSite
            ? `Сайт «${deleteSite.name}» можно удалить только если у него ещё нет истории запусков.`
            : ""
        }
        confirmText="Удалить сайт"
        confirmVariant="danger"
        loading={deleteSite ? pendingId === deleteSite.id : false}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (deleteSite && pendingId === deleteSite.id) return;
          setDeleteSite(null);
        }}
      />
    </Card>
  );
}
