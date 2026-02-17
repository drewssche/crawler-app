import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiPost } from "../api/client";
import { useAuth } from "../hooks/auth";

type AuthTab = "signin" | "request";

type RequestAccessResponse = {
  ok: boolean;
  status: string;
  message: string;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ADMIN_EMAILS_RAW = String(import.meta.env.VITE_ADMIN_EMAILS ?? "").trim();
const DEFAULT_ADMIN_EMAIL = ADMIN_EMAILS_RAW.split(",").map((x) => x.trim()).filter(Boolean)[0] ?? "";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, verifyCode } = useAuth();

  const [tab, setTab] = useState<AuthTab>("request");
  const [email, setEmail] = useState(DEFAULT_ADMIN_EMAIL);
  const [challengeId, setChallengeId] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/settings";
  const isSignIn = tab === "signin";
  const isCodeStep = isSignIn && challengeId !== null;

  function validateEmailOrThrow(raw: string): string {
    const normalized = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      throw new Error("Введите корректный email.");
    }
    return normalized;
  }

  async function onSignInStart(normalizedEmail: string) {
    const res = await login(normalizedEmail);

    if (res.status === "authenticated") {
      navigate(redirectTo, { replace: true });
      return;
    }

    if (res.status === "code_sent" || res.status === "code_not_sent") {
      if (res.challenge_id) {
        setChallengeId(res.challenge_id);
      }
      setMessage(res.dev_code ? `${res.message} Код: ${res.dev_code}` : res.message);
      return;
    }

    if (res.status === "not_found") {
      setMessage("Пользователь не найден. Перейдите на вкладку 'Запрос доступа'.");
      return;
    }

    if (res.status === "pending") {
      setMessage("Заявка уже отправлена и ожидает подтверждения администратора.");
      return;
    }

    if (res.status === "blocked") {
      setMessage("Пользователь заблокирован. Обратитесь к администратору.");
      return;
    }

    setMessage(res.message);
  }

  async function onRequestAccess(normalizedEmail: string) {
    const req = await apiPost<RequestAccessResponse>("/auth/request-access", { email: normalizedEmail });
    setMessage(req.message);
  }

  async function startByEmail(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setChallengeId(null);

    try {
      const normalizedEmail = validateEmailOrThrow(email);
      setEmail(normalizedEmail);

      if (tab === "request") {
        await onRequestAccess(normalizedEmail);
        return;
      }

      await onSignInStart(normalizedEmail);
    } catch (err) {
      setError(String(err));
    }
  }

  async function onVerifyCode(e: FormEvent) {
    e.preventDefault();
    if (!challengeId) {
      setError("Сначала нажмите 'Далее'.");
      return;
    }

    setError("");
    setMessage("");
    try {
      await verifyCode(challengeId, code.trim());
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          border: "1px solid #3333",
          borderRadius: 12,
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button
            onClick={() => {
              setTab("signin");
              setChallengeId(null);
              setCode("");
              setError("");
              setMessage("");
              if (DEFAULT_ADMIN_EMAIL) {
                setEmail(DEFAULT_ADMIN_EMAIL);
              }
            }}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              cursor: "pointer",
              border: isSignIn ? "1px solid #6aa0ff" : "1px solid #3333",
              background: isSignIn ? "rgba(106,160,255,0.12)" : "transparent",
            }}
          >
            Вход
          </button>
          <button
            onClick={() => {
              setTab("request");
              setChallengeId(null);
              setCode("");
              setError("");
              setMessage("");
            }}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              cursor: "pointer",
              border: !isSignIn ? "1px solid #6aa0ff" : "1px solid #3333",
              background: !isSignIn ? "rgba(106,160,255,0.12)" : "transparent",
            }}
          >
            Запрос доступа
          </button>
        </div>

        {!isCodeStep && (
          <form onSubmit={startByEmail} style={{ display: "grid", gap: 10 }}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isSignIn ? (DEFAULT_ADMIN_EMAIL || "Email для входа") : "Ваш рабочий email"}
              style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
            />

            {error && <div style={{ color: "#d55", fontSize: 13 }}>{error}</div>}
            {message && <div style={{ color: "#8fd18f", fontSize: 13 }}>{message}</div>}

            <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer" }}>
              Далее
            </button>
          </form>
        )}

        {isCodeStep && (
          <form onSubmit={onVerifyCode} style={{ display: "grid", gap: 10 }}>
            <input
              value={email}
              disabled
              style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10, opacity: 0.75 }}
            />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Код из письма"
              style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
            />

            {error && <div style={{ color: "#d55", fontSize: 13 }}>{error}</div>}
            {message && <div style={{ color: "#8fd18f", fontSize: 13 }}>{message}</div>}

            <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer" }}>
              Войти
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
