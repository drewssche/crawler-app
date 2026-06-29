import { useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { createProjectSite, type SiteScopeMode } from "../api/projectSites";
import { ApiError, apiPost } from "../api/client";
import SiteScopeFields from "../components/projects/SiteScopeFields";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import CardActionButton from "../components/ui/CardActionButton";
import { MetaText, StatusText } from "../components/ui/StatusText";
import {
  deriveSiteName,
  normalizePathPrefix,
  normalizeSiteUrl,
  validateSiteDraft,
} from "../utils/siteScope";
import { invalidateProjectsCache } from "../utils/projectListCache";
import { formatQuotaError, isQuotaError } from "../utils/quotaErrors";

type ProjectOut = {
  id: number;
  name: string;
  start_url: string;
};

type SiteDraft = {
  id: number;
  name: string;
  startUrl: string;
  scopeMode: SiteScopeMode;
  pathPrefix: string;
};

const FIRST_DRAFT_ID = 1;

function newSiteDraft(id: number): SiteDraft {
  return {
    id,
    name: "",
    startUrl: "",
    scopeMode: "whole_site",
    pathPrefix: "/",
  };
}

function normalizeScopePath(raw: string): string {
  const normalized = normalizePathPrefix(raw);
  return normalized === "/" ? "/" : `${normalized.replace(/\/+$/, "")}/`;
}

function siteScopeKey(draft: SiteDraft): string | null {
  try {
    const url = new URL(normalizeSiteUrl(draft.startUrl));
    const port = url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))
      ? `:${url.port}`
      : "";
    const origin = `${url.protocol}//${url.hostname.toLowerCase()}${port}`;
    const path = draft.scopeMode === "whole_site" ? "/" : normalizeScopePath(draft.pathPrefix);
    return `${origin}|${draft.scopeMode}|${path}`;
  } catch {
    return null;
  }
}

function siteFinalName(draft: SiteDraft): string {
  return draft.name.trim() || deriveSiteName(draft.startUrl);
}

function siteScopeLabel(draft: SiteDraft): string {
  return draft.scopeMode === "whole_site" ? "весь сайт" : `раздел ${normalizePathPrefix(draft.pathPrefix)}`;
}

function projectCreateErrorMessage(err: unknown): string {
  if (isQuotaError(err)) return formatQuotaError(err);
  if (err instanceof ApiError) {
    if (err.code === "project_site_scope_conflict") {
      return "Такой сайт или раздел уже есть в проекте. Проверьте карточки сайтов.";
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Не удалось создать проект.";
}

export default function ProjectNewPage() {
  const navigate = useNavigate();
  const firstStartUrlRef = useRef<HTMLInputElement>(null);
  const nextDraftIdRef = useRef(FIRST_DRAFT_ID + 1);
  const [projectName, setProjectName] = useState("");
  const [siteDrafts, setSiteDrafts] = useState<SiteDraft[]>([newSiteDraft(FIRST_DRAFT_ID)]);
  const [error, setError] = useState("");
  const [partialProject, setPartialProject] = useState<ProjectOut | null>(null);
  const [pending, setPending] = useState(false);

  const firstDraft = siteDrafts[0];
  const suggestedSiteName = useMemo(() => deriveSiteName(firstDraft?.startUrl || ""), [firstDraft?.startUrl]);
  const finalProjectName = projectName.trim() || siteFinalName(firstDraft);

  function updateDraft(id: number, patch: Partial<SiteDraft>) {
    setSiteDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  }

  function addDraft() {
    const id = nextDraftIdRef.current;
    nextDraftIdRef.current += 1;
    setSiteDrafts((current) => [...current, newSiteDraft(id)]);
  }

  function removeDraft(id: number) {
    setSiteDrafts((current) => current.length <= 1 ? current : current.filter((draft) => draft.id !== id));
  }

  function validateDrafts(): string {
    const seen = new Map<string, number>();
    for (let index = 0; index < siteDrafts.length; index += 1) {
      const draft = siteDrafts[index];
      const validationError = validateSiteDraft(draft.startUrl, draft.scopeMode, draft.pathPrefix);
      if (validationError) {
        return `Сайт ${index + 1}: ${validationError}`;
      }
      const key = siteScopeKey(draft);
      if (!key) {
        return `Сайт ${index + 1}: укажите корректный адрес сайта.`;
      }
      const previousIndex = seen.get(key);
      if (previousIndex !== undefined) {
        return `Сайты ${previousIndex + 1} и ${index + 1} указывают на одну и ту же область. Оставьте одну карточку или выберите другой раздел.`;
      }
      seen.set(key, index);
    }
    return "";
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPartialProject(null);
    const validationError = validateDrafts();
    if (validationError) {
      setError(validationError);
      firstStartUrlRef.current?.focus();
      return;
    }

    setPending(true);
    try {
      const [primaryDraft, ...extraDrafts] = siteDrafts;
      const created = await apiPost<ProjectOut>("/projects", {
        name: finalProjectName,
        site_name: siteFinalName(primaryDraft),
        start_url: normalizeSiteUrl(primaryDraft.startUrl),
        scope_mode: primaryDraft.scopeMode,
        path_prefix: primaryDraft.scopeMode === "path_prefix" ? normalizePathPrefix(primaryDraft.pathPrefix) : "/",
        allowed_domains_csv: "",
      });

      for (const draft of extraDrafts) {
        try {
          await createProjectSite(created.id, {
            name: siteFinalName(draft),
            start_url: normalizeSiteUrl(draft.startUrl),
            scope_mode: draft.scopeMode,
            path_prefix: draft.scopeMode === "path_prefix" ? normalizePathPrefix(draft.pathPrefix) : "/",
            role: "peer",
          });
        } catch (err) {
          invalidateProjectsCache();
          setPartialProject(created);
          setError(`Проект создан, но сайт «${siteFinalName(draft)}» не добавлен: ${projectCreateErrorMessage(err)}`);
          return;
        }
      }

      invalidateProjectsCache();
      navigate(`/projects/${created.id}`, { state: { projectName: created.name } });
    } catch (err) {
      setError(projectCreateErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 900 }}>
      <div>
        <h2 style={{ margin: 0 }}>Создать проект</h2>
        <MetaText opacity={0.72} style={{ marginTop: 5 }}>
          Добавьте один или несколько сайтов сразу. Один и тот же домен можно использовать в разных проектах,
          а внутри проекта каждая карточка должна вести на отдельный сайт или раздел.
        </MetaText>
      </div>

      <Card>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Название проекта</span>
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder={`Например: ${suggestedSiteName === "Сайт" ? "Мониторинг продукта" : suggestedSiteName}`}
              disabled={pending}
              style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
            />
            <MetaText opacity={0.65}>Можно оставить пустым — используем название первого сайта.</MetaText>
          </label>

          <div style={{ display: "grid", gap: 10 }}>
            {siteDrafts.map((draft, index) => (
              <Card key={draft.id} variant="hint" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{index === 0 ? "Первый сайт" : `Сайт ${index + 1}`}</div>
                    <MetaText opacity={0.65}>
                      {index === 0 ? "По нему создаётся проект." : "Будет добавлен в проект сразу после создания."}
                    </MetaText>
                  </div>
                  {siteDrafts.length > 1 && (
                    <CardActionButton type="button" variant="ghost" disabled={pending} onClick={() => removeDraft(draft.id)}>
                      Убрать
                    </CardActionButton>
                  )}
                </div>
                <SiteScopeFields
                  name={draft.name}
                  startUrl={draft.startUrl}
                  scopeMode={draft.scopeMode}
                  pathPrefix={draft.pathPrefix}
                  disabled={pending}
                  startUrlInputRef={index === 0 ? firstStartUrlRef : undefined}
                  onNameChange={(value) => updateDraft(draft.id, { name: value })}
                  onStartUrlChange={(value) => updateDraft(draft.id, { startUrl: value })}
                  onScopeModeChange={(value) => updateDraft(draft.id, { scopeMode: value })}
                  onPathPrefixChange={(value) => updateDraft(draft.id, { pathPrefix: value })}
                />
              </Card>
            ))}
          </div>

          <div>
            <CardActionButton type="button" variant="secondary" disabled={pending} onClick={addDraft}>
              + Добавить сайт
            </CardActionButton>
          </div>

          <Card style={{ padding: 10 }}>
            <MetaText opacity={0.72}>Будет создано</MetaText>
            <div style={{ marginTop: 5, fontWeight: 700 }}>{finalProjectName}</div>
            <MetaText style={{ marginTop: 3 }}>
              Сайтов: {siteDrafts.length}
            </MetaText>
            <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
              {siteDrafts.map((draft, index) => (
                <MetaText key={draft.id}>
                  {index + 1}. {siteFinalName(draft)} · {siteScopeLabel(draft)}
                </MetaText>
              ))}
            </div>
          </Card>

          {error && <StatusText tone="danger">{error}</StatusText>}

          {partialProject && (
            <Card variant="warning" style={{ display: "grid", gap: 8 }}>
              <StatusText tone="warning">
                Проект «{partialProject.name}» уже создан. Откройте его, чтобы проверить добавленные сайты или добавить недостающие вручную.
              </StatusText>
              <div>
                <Button type="button" variant="primary" onClick={() => navigate(`/projects/${partialProject.id}`)}>
                  Открыть созданный проект
                </Button>
              </div>
            </Card>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Создание..." : "Создать проект"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/")} disabled={pending}>
              Отмена
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
