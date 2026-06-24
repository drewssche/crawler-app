import { useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, apiPost } from "../api/client";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import { StatusText } from "../components/ui/StatusText";
import { deriveProjectName, domainToStartUrl, parseProjectDomainsInput } from "../utils/projectDomains";
import { invalidateProfilesCache } from "../utils/profileListCache";

type ProfileOut = {
  id: number;
  name: string;
  start_url: string;
  allowed_domains_csv: string;
};

type ExistingProjectConflict = Pick<ProfileOut, "id" | "name" | "start_url">;

export default function ProfileNewPage() {
  const navigate = useNavigate();
  const domainsInputRef = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState("");
  const [domainsInput, setDomainsInput] = useState("");
  const [error, setError] = useState("");
  const [existingProject, setExistingProject] = useState<ExistingProjectConflict | null>(null);
  const [pending, setPending] = useState(false);

  const parsed = useMemo(() => parseProjectDomainsInput(domainsInput), [domainsInput]);
  const domains = parsed.domains;
  const draftName = name.trim() || deriveProjectName(domains);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setExistingProject(null);
    if (domains.length < 1) {
      setError("Добавьте хотя бы один валидный домен.");
      return;
    }
    if (parsed.invalid.length > 0) {
      setError(`Исправьте невалидные значения: ${parsed.invalid.join(", ")}`);
      return;
    }

    setPending(true);
    try {
      const payload = {
        name: draftName,
        start_url: domainToStartUrl(domains[0]),
        allowed_domains_csv: domains.join(","),
      };
      const created = await apiPost<ProfileOut>("/profiles", payload);
      invalidateProfilesCache();
      navigate(`/profiles/${created.id}`, { state: { projectName: created.name } });
    } catch (err) {
      if (err instanceof ApiError && err.code === "profile_scope_conflict") {
        const details = err.details as { existing_project?: ExistingProjectConflict } | undefined;
        if (details?.existing_project) {
          setExistingProject(details.existing_project);
          setError("");
        } else {
          setError("Проект для этого адреса уже существует.");
        }
      } else {
        setError(err instanceof Error ? err.message : "Не удалось создать проект.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 760 }}>
      <h2 style={{ marginTop: 0 }}>Создать проект</h2>
      <Card>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Название проекта (необязательно)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Мониторинг сайта компании"
              style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Домены (обязательно, 1+)</span>
            <textarea
              ref={domainsInputRef}
              value={domainsInput}
              onChange={(e) => setDomainsInput(e.target.value)}
              placeholder={"example.com\nhelp.example.com\nили через запятую: example.com, help.example.com"}
              rows={5}
              style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10, resize: "vertical" }}
            />
          </label>

          <div style={{ fontSize: 13, opacity: 0.82 }}>
            Будет сохранено:
            <br />
            имя: <b>{draftName || "—"}</b>
            <br />
            доменов: <b>{domains.length}</b>
            {parsed.invalid.length > 0 && (
              <>
                <br />
                невалидных значений: <b>{parsed.invalid.length}</b>
              </>
            )}
          </div>

          {error && <StatusText tone="danger">{error}</StatusText>}

          {existingProject && (
            <Card style={{ padding: 12 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <StatusText tone="warning">
                  Проект для этого адреса уже существует: «{existingProject.name}».
                </StatusText>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => navigate(`/profiles/${existingProject.id}`)}
                  >
                    Открыть существующий
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setExistingProject(null);
                      domainsInputRef.current?.focus();
                    }}
                  >
                    Изменить адрес
                  </Button>
                </div>
              </div>
            </Card>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Создание..." : "+ Создать проект"}
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
