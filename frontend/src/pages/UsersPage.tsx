import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client";

type PendingUser = {
  id: number;
  email: string;
  role: string;
  is_approved: boolean;
};

export default function UsersPage() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [error, setError] = useState("");

  async function loadPending() {
    setError("");
    try {
      const data = await apiGet<PendingUser[]>("/admin/users?status=pending");
      setUsers(data);
    } catch (e) {
      setError(String(e));
    }
  }

  async function approve(userId: number, role: "viewer" | "editor") {
    setError("");
    try {
      await apiPost(`/admin/users/${userId}/approve`, { role });
      await loadPending();
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    loadPending();
  }, []);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Заявки на доступ</h2>
      {error && <div style={{ color: "#d55", marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "grid", gap: 10 }}>
        {users.map((u) => (
          <div
            key={u.id}
            style={{
              border: "1px solid #3333",
              borderRadius: 12,
              padding: 12,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>{u.email}</div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>id: {u.id}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => approve(u.id, "viewer")}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Подтвердить как Viewer
              </button>
              <button
                onClick={() => approve(u.id, "editor")}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Подтвердить как Editor
              </button>
            </div>
          </div>
        ))}
        {users.length === 0 && <div style={{ opacity: 0.7 }}>Нет заявок в ожидании.</div>}
      </div>
    </div>
  );
}
