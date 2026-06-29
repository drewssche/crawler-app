import { useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { SiteScopeMode } from "../api/projectSites";
import { ApiError, apiPost } from "../api/client";
import SiteScopeFields from "../components/projects/SiteScopeFields";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
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

type ExistingProjectConflict = Pick<ProjectOut, "id" | "name" | "start_url">;

export default function ProjectNewPage() {
  const navigate = useNavigate();
  const startUrlRef = useRef<HTMLInputElement>(null);
  const [projectName, setProjectName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [scopeMode, setScopeMode] = useState<SiteScopeMode>("whole_site");
  const [pathPrefix, setPathPrefix] = useState("/");
  const [error, setError] = useState("");
  const [existingProject, setExistingProject] = useState<ExistingProjectConflict | null>(null);
  const [pending, setPending] = useState(false);

  const suggestedSiteName = useMemo(() => deriveSiteName(startUrl), [startUrl]);
  const finalSiteName = siteName.trim() || suggestedSiteName;
  const finalProjectName = projectName.trim() || finalSiteName;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setExistingProject(null);
    const validationError = validateSiteDraft(startUrl, scopeMode, pathPrefix);
    if (validationError) {
      setError(validationError);
      startUrlRef.current?.focus();
      return;
    }

    setPending(true);
    try {
      const normalizedUrl = normalizeSiteUrl(startUrl);
      const created = await apiPost<ProjectOut>("/projects", {
        name: finalProjectName,
        site_name: finalSiteName,
        start_url: normalizedUrl,
        scope_mode: scopeMode,
        path_prefix: scopeMode === "path_prefix" ? normalizePathPrefix(pathPrefix) : "/",
        allowed_domains_csv: "",
      });
      invalidateProjectsCache();
      navigate(`/projects/${created.id}`, { state: { projectName: created.name } });
    } catch (err) {
      if (err instanceof ApiError && err.code === "project_scope_conflict") {
        const details = err.details as { existing_project?: ExistingProjectConflict } | undefined;
        if (details?.existing_project) {
          setExistingProject(details.existing_project);
        } else {
          setError("Проект для этого адреса уже существует.");
        }
      } else {
        setError(isQuotaError(err) ? formatQuotaError(err) : err instanceof Error ? err.message : "Не удалось создать проект.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 820 }}>
      <div>
        <h2 style={{ margin: 0 }}>Создать проект</h2>
        <MetaText opacity={0.72} style={{ marginTop: 5 }}>
          Начните с одного сайта. Дополнительные сайты можно добавить в настройках проекта.
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

          <Card variant="hint" style={{ display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 700 }}>Первый сайт</div>
            <SiteScopeFields
              name={siteName}
              startUrl={startUrl}
              scopeMode={scopeMode}
              pathPrefix={pathPrefix}
              disabled={pending}
              startUrlInputRef={startUrlRef}
              onNameChange={setSiteName}
              onStartUrlChange={setStartUrl}
              onScopeModeChange={setScopeMode}
              onPathPrefixChange={setPathPrefix}
            />
          </Card>

          <Card style={{ padding: 10 }}>
            <MetaText opacity={0.72}>Будет создано</MetaText>
            <div style={{ marginTop: 5, fontWeight: 700 }}>{finalProjectName}</div>
            <MetaText style={{ marginTop: 3 }}>
              {finalSiteName} · {scopeMode === "whole_site" ? "весь сайт" : `раздел ${normalizePathPrefix(pathPrefix)}`}
            </MetaText>
          </Card>

          {error && <StatusText tone="danger">{error}</StatusText>}

          {existingProject && (
            <Card variant="warning" style={{ display: "grid", gap: 8 }}>
              <StatusText tone="warning">
                Проект для этого адреса уже существует: «{existingProject.name}».
              </StatusText>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button type="button" variant="primary" onClick={() => navigate(`/projects/${existingProject.id}`)}>
                  Открыть существующий
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setExistingProject(null);
                    startUrlRef.current?.focus();
                  }}
                >
                  Изменить адрес
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
