import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import Button from "../components/ui/Button";
import { useAuth } from "../hooks/auth";
import { normalizeError } from "../utils/errors";

type InvitePreview = {
  email: string;
  role: string;
  expires_at: string;
};

type InviteAcceptResponse = {
  status: string;
  challenge_id?: number;
  message: string;
  dev_code?: string;
};

const ROLE_LABELS: Record<string, string> = {
  viewer: "Наблюдатель",
  editor: "Редактор",
  admin: "Администратор",
  "root-admin": "Root-admin",
};

export default function InvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { verifyCode } = useAuth();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [challengeId, setChallengeId] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    apiGet<InvitePreview>(`/auth/invites/${encodeURIComponent(token)}`)
      .then((data) => {
        if (!active) return;
        setPreview(data);
      })
      .catch((e) => {
        if (!active) return;
        setError(normalizeError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function acceptInvite() {
    setError("");
    setMessage("");
    try {
      const data = await apiPost<InviteAcceptResponse>("/auth/invites/accept", { token });
      if (data.challenge_id) {
        setChallengeId(data.challenge_id);
      }
      setMessage(data.dev_code ? `${data.message} Код: ${data.dev_code}` : data.message);
    } catch (e) {
      setError(normalizeError(e));
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setError("");
    try {
      await verifyCode(challengeId, code.trim());
      navigate("/", { replace: true });
    } catch (err) {
      setError(normalizeError(err));
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 520, border: "1px solid #3338", borderRadius: 16, padding: 18, display: "grid", gap: 14 }}>
        <div>
          <h1 style={{ margin: 0 }}>Приглашение в Crawler App</h1>
          <div style={{ opacity: 0.72, marginTop: 6 }}>Подтвердите доступ кодом из письма.</div>
        </div>

        {loading && <div style={{ opacity: 0.75 }}>Проверяем ссылку...</div>}
        {error && <div style={{ color: "#ff8a8a" }}>{error}</div>}

        {preview && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ border: "1px solid #3f67b7aa", borderRadius: 14, padding: 14, background: "#263142" }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{preview.email}</div>
              <div style={{ marginTop: 8, opacity: 0.82 }}>Роль: {ROLE_LABELS[preview.role] || preview.role}</div>
              <div style={{ marginTop: 4, opacity: 0.7 }}>Ссылка действует до: {new Date(preview.expires_at).toLocaleString()}</div>
            </div>

            {!challengeId ? (
              <Button type="button" variant="primary" onClick={acceptInvite}>Получить код входа</Button>
            ) : (
              <form onSubmit={submitCode} style={{ display: "grid", gap: 10 }}>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Код из письма"
                  style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
                />
                <Button type="submit" variant="primary">Войти</Button>
              </form>
            )}

            {message && <div style={{ color: "#8fd18f", fontSize: 13 }}>{message}</div>}
          </div>
        )}

        <Link to="/login" style={{ color: "#9bbcff" }}>Перейти ко входу</Link>
      </div>
    </div>
  );
}
