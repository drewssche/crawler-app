import { useCallback, useEffect, useState } from "react";
import {
  createProjectSitePersona,
  createProjectSite,
  deleteProjectSitePersonaSessionBundle,
  deleteProjectSite,
  listProjectSitePersonas,
  saveProjectSitePersonaSessionBundle,
  listProjectSites,
  updateProjectSite,
  type CrawlPersonaSummary,
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
import AccentPill from "../ui/AccentPill";
import { MetaText, StatusText } from "../ui/StatusText";
import SiteScopeFields from "./SiteScopeFields";
import UiSelect from "../ui/UiSelect";
import { formatOperationalDateTime } from "../../utils/datetime";

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

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: 10,
  borderRadius: 10,
};

const textAreaStyle = {
  ...inputStyle,
  minHeight: 110,
  resize: "vertical" as const,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
};

type PersonaDraft = {
  key: string;
  label: string;
  kind: string;
  description: string;
};

const EMPTY_PERSONA_DRAFT: PersonaDraft = {
  key: "",
  label: "",
  kind: "authenticated",
  description: "",
};

function personaKindLabel(kind: string): string {
  if (kind === "guest") return "Гость";
  if (kind === "authenticated") return "Авторизованный";
  if (kind === "partner") return "Партнёр";
  return kind || "Другая роль";
}

function personaSecretLabel(persona: CrawlPersonaSummary): { tone: "success" | "warning" | "neutral"; label: string; title: string } {
  if (persona.kind === "guest") {
    return {
      tone: "neutral",
      label: "Без сессии",
      title: "Гостевой контекст открывает сайт без cookies и токенов.",
    };
  }
  if (persona.has_secrets) {
    return {
      tone: "success",
      label: "Сессия подключена",
      title: "Для этой персоны сохранён encrypted session bundle. Значения cookies/tokens не показываются в интерфейсе.",
    };
  }
  return {
    tone: "warning",
    label: "Сессия не подключена",
    title: "Персону можно выбрать, но без session bundle она фактически откроется как обычный браузер без авторизации.",
  };
}

function makePersonaKey(label: string, kind: string): string {
  const raw = (label || kind || "persona")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  const translit = raw
    .replace(/[а-яё]/gi, (char) => {
      const map: Record<string, string> = {
        а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
        к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
        х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
      };
      return map[char.toLowerCase()] || "";
    })
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return translit || kind || "persona";
}

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

function ProjectSitePersonasPanel({
  projectId,
  site,
}: {
  projectId: number;
  site: ProjectSite;
}) {
  const [personas, setPersonas] = useState<CrawlPersonaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState<PersonaDraft>(EMPTY_PERSONA_DRAFT);
  const [sessionPersonaId, setSessionPersonaId] = useState<number | null>(null);
  const [sessionJson, setSessionJson] = useState("{\n  \"cookies\": [],\n  \"localStorage\": [],\n  \"sessionStorage\": []\n}");
  const [pending, setPending] = useState<number | "new" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadPersonas = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPersonas(await listProjectSitePersonas(projectId, site.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить контексты доступа.");
    } finally {
      setLoading(false);
    }
  }, [projectId, site.id]);

  useEffect(() => {
    void loadPersonas();
  }, [loadPersonas]);

  async function handleCreatePersona() {
    const label = draft.label.trim();
    const key = (draft.key.trim() || makePersonaKey(label, draft.kind)).toLowerCase();
    if (!label) {
      setError("Укажите понятное название персоны, например «Партнёр» или «Авторизованный редактор».");
      return;
    }
    setPending("new");
    setError("");
    setMessage("");
    try {
      const created = await createProjectSitePersona(projectId, site.id, {
        key,
        label,
        kind: draft.kind,
        description: draft.description.trim(),
      });
      setPersonas((current) => [...current, created]);
      setDraft(EMPTY_PERSONA_DRAFT);
      setIsAdding(false);
      setMessage("Персона добавлена. Если ей нужна авторизация, подключите session JSON ниже.");
    } catch (err) {
      if (err instanceof ApiError && err.code === "crawl_persona_key_conflict") {
        setError("Персона с таким ключом уже есть у этого сайта. Измените ключ.");
      } else {
        setError(err instanceof Error ? err.message : "Не удалось добавить персону.");
      }
    } finally {
      setPending(null);
    }
  }

  async function handleSaveSession(persona: CrawlPersonaSummary) {
    let bundle: Record<string, unknown>;
    try {
      const parsed = JSON.parse(sessionJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Session JSON должен быть объектом.");
      }
      bundle = parsed as Record<string, unknown>;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session JSON не похож на корректный JSON.");
      return;
    }
    setPending(persona.id);
    setError("");
    setMessage("");
    try {
      const updated = await saveProjectSitePersonaSessionBundle(projectId, site.id, persona.id, bundle);
      setPersonas((current) => current.map((row) => row.id === updated.id ? updated : row));
      setSessionPersonaId(null);
      setMessage("Session bundle сохранён encrypted-at-rest. В интерфейсе виден только статус подключения.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить session bundle.");
    } finally {
      setPending(null);
    }
  }

  async function handleDeleteSession(persona: CrawlPersonaSummary) {
    setPending(persona.id);
    setError("");
    setMessage("");
    try {
      const updated = await deleteProjectSitePersonaSessionBundle(projectId, site.id, persona.id);
      setPersonas((current) => current.map((row) => row.id === updated.id ? updated : row));
      setMessage("Session bundle удалён. Персона осталась, но теперь без подключённой сессии.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сбросить session bundle.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Card variant="hint" style={{ display: "grid", gap: 10 }}>
      <SectionHeaderRow
        title={
          <div>
            <div style={{ fontWeight: 700 }}>Контексты доступа</div>
            <MetaText opacity={0.72}>
              Персона показывает, как crawler открывает сайт: гостем, авторизованным пользователем, партнёром или другой ролью.
            </MetaText>
          </div>
        }
        actions={
          <CardActionButton
            variant="secondary"
            compact
            onClick={() => {
              setIsAdding((value) => !value);
              setError("");
              setMessage("");
            }}
          >
            {isAdding ? "Закрыть" : "+ Персона"}
          </CardActionButton>
        }
      />

      <Card variant="default" style={{ padding: 10 }}>
        <MetaText opacity={0.72}>
          MVP: session bundle вставляется вручную JSON-объектом, например cookies/localStorage/sessionStorage. Значения cookies и tokens не показываются после сохранения.
        </MetaText>
      </Card>

      {loading && <MetaText>Загрузка контекстов...</MetaText>}
      {error && <StatusText tone="danger">{error}</StatusText>}
      {message && <StatusText tone="success">{message}</StatusText>}

      {isAdding && (
        <Card style={{ display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 700 }}>Новая персона</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Название</span>
              <input
                value={draft.label}
                onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                placeholder="Партнёр"
                disabled={pending === "new"}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Тип</span>
              <UiSelect
                value={draft.kind}
                disabled={pending === "new"}
                onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value }))}
              >
                <option value="authenticated">Авторизованный пользователь</option>
                <option value="partner">Партнёр</option>
                <option value="other">Другая роль</option>
              </UiSelect>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Ключ</span>
              <input
                value={draft.key}
                onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))}
                placeholder={makePersonaKey(draft.label, draft.kind)}
                disabled={pending === "new"}
                style={inputStyle}
              />
            </label>
          </div>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Пояснение для команды</span>
            <input
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              placeholder="Например: пользователь партнёрского портала с доступом к закрытому разделу"
              disabled={pending === "new"}
              style={inputStyle}
            />
          </label>
          <CardFooterActions>
            <CardActionButton variant="primary" disabled={pending === "new"} onClick={() => void handleCreatePersona()}>
              {pending === "new" ? "Добавление..." : "Добавить персону"}
            </CardActionButton>
            <CardActionButton variant="ghost" disabled={pending === "new"} onClick={() => setIsAdding(false)}>
              Отмена
            </CardActionButton>
          </CardFooterActions>
        </Card>
      )}

      {!loading && personas.map((persona) => {
        const secret = personaSecretLabel(persona);
        const editingSession = sessionPersonaId === persona.id;
        return (
          <Card key={persona.id} style={{ display: "grid", gap: 8 }}>
            <SectionHeaderRow
              title={
                <div style={{ display: "grid", gap: 3 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontWeight: 700 }}>{persona.label}</span>
                    <AccentPill tone="info">{personaKindLabel(persona.kind)}</AccentPill>
                    {persona.is_default && <AccentPill tone="neutral">По умолчанию</AccentPill>}
                    {!persona.is_enabled && <AccentPill tone="warning">Отключена</AccentPill>}
                  </div>
                  {persona.description && <MetaText opacity={0.7}>{persona.description}</MetaText>}
                </div>
              }
              actions={
                <AccentPill tone={secret.tone} title={secret.title}>
                  {secret.label}
                </AccentPill>
              }
            />
            <MetaText opacity={0.7}>
              Ключ: {persona.key}
              {persona.session_bundle_updated_at ? ` · сессия обновлена ${formatOperationalDateTime(persona.session_bundle_updated_at)}` : ""}
            </MetaText>
            {persona.kind !== "guest" && (
              <>
                {editingSession ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span>Session JSON</span>
                      <textarea
                        value={sessionJson}
                        onChange={(event) => setSessionJson(event.target.value)}
                        disabled={pending === persona.id}
                        style={textAreaStyle}
                      />
                    </label>
                    <MetaText opacity={0.68}>
                      Рекомендуемый формат: объект с массивами `cookies`, `localStorage`, `sessionStorage`. После сохранения значения будут зашифрованы и скрыты.
                    </MetaText>
                    <CardFooterActions>
                      <CardActionButton variant="primary" disabled={pending === persona.id} onClick={() => void handleSaveSession(persona)}>
                        {pending === persona.id ? "Сохранение..." : "Сохранить сессию"}
                      </CardActionButton>
                      <CardActionButton variant="ghost" disabled={pending === persona.id} onClick={() => setSessionPersonaId(null)}>
                        Отмена
                      </CardActionButton>
                    </CardFooterActions>
                  </div>
                ) : (
                  <CardFooterActions>
                    <CardActionButton
                      variant="secondary"
                      compact
                      disabled={pending === persona.id}
                      onClick={() => {
                        setSessionPersonaId(persona.id);
                        setSessionJson("{\n  \"cookies\": [],\n  \"localStorage\": [],\n  \"sessionStorage\": []\n}");
                        setError("");
                        setMessage("");
                      }}
                    >
                      {persona.has_secrets ? "Обновить сессию" : "Подключить сессию"}
                    </CardActionButton>
                    {persona.has_secrets && (
                      <CardActionButton
                        variant="ghost"
                        compact
                        disabled={pending === persona.id}
                        onClick={() => void handleDeleteSession(persona)}
                      >
                        Сбросить сессию
                      </CardActionButton>
                    )}
                  </CardFooterActions>
                )}
              </>
            )}
          </Card>
        );
      })}
    </Card>
  );
}

export default function ProjectSitesSettings({
  projectId,
  onChanged,
}: {
  projectId: number;
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
      setSites(await listProjectSites(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить сайты проекта.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

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
      const created = await createProjectSite(projectId, {
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
      const updated = await updateProjectSite(projectId, site.id, {
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
      const updated = await updateProjectSite(projectId, site.id, { is_enabled: !site.is_enabled });
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
      await deleteProjectSite(projectId, deleteSite.id);
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
                      <AccentPill
                        tone={site.is_enabled ? "success" : "warning"}
                        title={site.is_enabled ? "Сайт участвует в новых запусках." : "Новые прогоны сайта отключены, история сохранена."}
                      >
                        {site.is_enabled ? "Включён" : "Отключён"}
                      </AccentPill>
                    }
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <MetaText>Область: {scopeLabel(site)}</MetaText>
                    <MetaText>Лимит: {site.max_pages} страниц</MetaText>
                    <MetaText>Роль: {site.role}</MetaText>
                  </div>
                  <ProjectSitePersonasPanel projectId={projectId} site={site} />
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
