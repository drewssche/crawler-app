import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiPost } from "../api/client";
import { useAuth } from "../hooks/auth";

type AuthTab = "signin" | "request";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, verifyCode } = useAuth();

  const [tab, setTab] = useState<AuthTab>("request");
  const [email, setEmail] = useState("admin@local");
  const [password, setPassword] = useState("change_me_now");
  const [challengeId, setChallengeId] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/profiles/new";

  async function onSignIn(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      const res = await login(email, password);
      setChallengeId(res.challenge_id);
      setMessage(res.dev_code ? `${res.message} Код: ${res.dev_code}` : res.message);
    } catch (err) {
      setError(String(err));
    }
  }

  async function onVerifyCode(e: FormEvent) {
    e.preventDefault();
    if (!challengeId) {
      setError("Сначала выполните вход по почте и паролю.");
      return;
    }
    setError("");
    setMessage("");
    try {
      await verifyCode(challengeId, code);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(String(err));
    }
  }

  async function onRequestAccess(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      const res = await apiPost<{ ok: boolean; status: string; message?: string }>("/auth/request-access", {
        email,
        password,
      });
      setMessage(res.message ?? "Заявка отправлена. Ожидайте подтверждения администратора.");
    } catch (err) {
      setError(String(err));
    }
  }

  const isSignIn = tab === "signin";

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
          maxWidth: 440,
          border: "1px solid #3333",
          borderRadius: 12,
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button
            onClick={() => setTab("signin")}
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
            onClick={() => setTab("request")}
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

        <form onSubmit={isSignIn ? onSignIn : onRequestAccess} style={{ display: "grid", gap: 10 }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Почта"
            style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
          />

          {error && <div style={{ color: "#d55", fontSize: 13 }}>{error}</div>}
          {message && <div style={{ color: "#8fd18f", fontSize: 13 }}>{message}</div>}

          <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer" }}>
            {isSignIn ? "Войти" : "Отправить заявку"}
          </button>
        </form>

        {isSignIn && (
          <form onSubmit={onVerifyCode} style={{ display: "grid", gap: 10, marginTop: 6 }}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Код из письма"
              style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
            />
            <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer" }}>
              Подтвердить код
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
