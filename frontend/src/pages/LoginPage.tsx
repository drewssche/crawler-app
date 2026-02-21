import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiPost } from "../api/client";
import Button from "../components/ui/Button";
import SegmentedControl from "../components/ui/SegmentedControl";
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
      throw new Error("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 email.");
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
      setMessage(res.dev_code ? `${res.message} \u041a\u043e\u0434: ${res.dev_code}` : res.message);
      return;
    }

    if (res.status === "not_found") {
      setMessage("\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d. \u041f\u0435\u0440\u0435\u0439\u0434\u0438\u0442\u0435 \u043d\u0430 \u0432\u043a\u043b\u0430\u0434\u043a\u0443 '\u0417\u0430\u043f\u0440\u043e\u0441 \u0434\u043e\u0441\u0442\u0443\u043f\u0430'.");
      return;
    }

    if (res.status === "pending") {
      setMessage("\u0417\u0430\u044f\u0432\u043a\u0430 \u0443\u0436\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0430 \u0438 \u043e\u0436\u0438\u0434\u0430\u0435\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430.");
      return;
    }

    if (res.status === "blocked") {
      setMessage("\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d. \u041e\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044c \u043a \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0443.");
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
      setError("\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 '\u0414\u0430\u043b\u0435\u0435'.");
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
        <SegmentedControl
          value={tab}
          onChange={(nextTab) => {
            setTab(nextTab);
            setChallengeId(null);
            setCode("");
            setError("");
            setMessage("");
            if (nextTab === "signin" && DEFAULT_ADMIN_EMAIL) {
              setEmail(DEFAULT_ADMIN_EMAIL);
            }
          }}
          options={[
            { value: "signin", label: "\u0412\u0445\u043e\u0434" },
            { value: "request", label: "\u0417\u0430\u043f\u0440\u043e\u0441 \u0434\u043e\u0441\u0442\u0443\u043f\u0430" },
          ]}
        />

        {!isCodeStep && (
          <form onSubmit={startByEmail} style={{ display: "grid", gap: 10 }}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isSignIn ? (DEFAULT_ADMIN_EMAIL || "Email \u0434\u043b\u044f \u0432\u0445\u043e\u0434\u0430") : "\u0412\u0430\u0448 \u0440\u0430\u0431\u043e\u0447\u0438\u0439 email"}
              style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
            />

            {error && <div style={{ color: "#d55", fontSize: 13 }}>{error}</div>}
            {message && <div style={{ color: "#8fd18f", fontSize: 13 }}>{message}</div>}

            <Button type="submit" variant="primary">{"\u0414\u0430\u043b\u0435\u0435"}</Button>
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
              placeholder={"\u041a\u043e\u0434 \u0438\u0437 \u043f\u0438\u0441\u044c\u043c\u0430"}
              style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
            />

            {error && <div style={{ color: "#d55", fontSize: 13 }}>{error}</div>}
            {message && <div style={{ color: "#8fd18f", fontSize: 13 }}>{message}</div>}

            <Button type="submit" variant="primary">{"\u0412\u043e\u0439\u0442\u0438"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
