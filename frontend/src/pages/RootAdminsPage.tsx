import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import AccentPill from "../components/ui/AccentPill";
import Card from "../components/ui/Card";
import RoleBadge from "../components/ui/RoleBadge";
import { useAuth } from "../hooks/auth";

type AdminSettingsResponse = {
  admin_emails: string[];
  db_admins: string[];
  is_root_admin: boolean;
};

type SaveAdminEmailsResponse = {
  ok: boolean;
  admin_emails: string[];
  sync: {
    created: number;
    promoted: number;
    demoted: number;
    skipped_create_without_password: number;
  };
  note: string;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function RootAdminsPage() {
  const { user } = useAuth();
  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setError("");
    try {
      const data = await apiGet<AdminSettingsResponse>("/admin/settings/admin-emails");
      setAdminEmails(data.admin_emails);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveList(nextEmails: string[], reasonText: string) {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await apiPost<SaveAdminEmailsResponse>("/admin/settings/admin-emails", {
        emails: nextEmails,
        reason: reasonText,
      });
      setAdminEmails(res.admin_emails);
      setMessage("Список системных администраторов обновлен.");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function addEmail() {
    const normalized = newEmail.trim().toLowerCase();
    const reasonText = reason.trim();
    if (!EMAIL_RE.test(normalized)) {
      setError("Введите корректный email.");
      return;
    }
    if (!reasonText) {
      setError("Укажите причину изменения списка.");
      return;
    }
    if (adminEmails.includes(normalized)) {
      setError("Этот email уже в списке.");
      return;
    }
    await saveList([...adminEmails, normalized], reasonText);
    setModalOpen(false);
    setNewEmail("");
    setReason("");
  }

  async function removeEmail(email: string) {
    const reasonText = reason.trim();
    if (adminEmails.length <= 1) {
      setError("Должен остаться хотя бы один системный администратор.");
      return;
    }
    if (!reasonText) {
      setError("Укажите причину изменения списка.");
      return;
    }
    if (email === (user?.email ?? "").toLowerCase()) {
      setError("Нельзя удалить самого себя из системных администраторов.");
      return;
    }
    await saveList(adminEmails.filter((x) => x !== email), reasonText);
    setReason("");
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Системные администраторы</h2>
      <p style={{ opacity: 0.8 }}>
        Раздел доступен только root-admin. Изменения сохраняются в `ADMIN_EMAILS` и синхронизируются с базой.
      </p>

      {error && <div style={{ color: "#d55", marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ color: "#8fd18f", marginBottom: 10 }}>{message}</div>}

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Причина изменения списка (обязательно)"
        style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10, marginBottom: 12 }}
      />

      <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
        {adminEmails.map((email) => {
          const self = email === (user?.email ?? "").toLowerCase();
          const cannotDelete = self || adminEmails.length <= 1 || loading;
          const hint = self
            ? "Нельзя удалить себя."
            : adminEmails.length <= 1
              ? "Нельзя оставить список пустым."
              : "Удалить из списка";
          return (
            <Card
              key={email}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{email}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <RoleBadge role="root-admin" />
                  {self && <AccentPill tone="info">вы</AccentPill>}
                </div>
              </div>
              <button
                onClick={() => removeEmail(email)}
                disabled={cannotDelete}
                title={hint}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: cannotDelete ? "not-allowed" : "pointer" }}
              >
                Удалить
              </button>
            </Card>
          );
        })}
      </div>

      <button
        onClick={() => {
          setError("");
          setMessage("");
          setModalOpen(true);
        }}
        disabled={loading}
        style={{ padding: "10px 12px", borderRadius: 10, cursor: loading ? "not-allowed" : "pointer" }}
      >
        Добавить
      </button>

      {modalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 20,
          }}
        >
          <Card style={{ width: 420, maxWidth: "92vw", padding: 14, background: "#1a1a1a" }}>
            <h3 style={{ marginTop: 0 }}>Добавить администратора</h3>
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="email@company.com"
              style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10, marginBottom: 10 }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setModalOpen(false)} style={{ padding: "8px 12px", borderRadius: 10, cursor: "pointer" }}>
                Отмена
              </button>
              <button onClick={addEmail} style={{ padding: "8px 12px", borderRadius: 10, cursor: "pointer" }}>
                Ок
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

