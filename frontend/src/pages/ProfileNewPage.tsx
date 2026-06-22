import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api/client";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import { StatusText } from "../components/ui/StatusText";
import { deriveProjectName, domainToStartUrl, parseProjectDomainsInput } from "../utils/projectDomains";

type ProfileOut = {
  id: number;
  name: string;
  start_url: string;
  allowed_domains_csv: string;
};

export default function ProfileNewPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [domainsInput, setDomainsInput] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const parsed = useMemo(() => parseProjectDomainsInput(domainsInput), [domainsInput]);
  const domains = parsed.domains;
  const draftName = name.trim() || deriveProjectName(domains);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
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
      navigate(`/profiles/${created.id}`, { state: { projectName: created.name } });
    } catch (err) {
      setError(String(err));
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
