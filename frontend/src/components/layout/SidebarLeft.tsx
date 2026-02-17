import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiGet } from "../../api/client";
import RoleBadge from "../ui/RoleBadge";
import { useAuth } from "../../hooks/auth";

type Profile = {
  id: number;
  name: string;
  start_url: string;
};

export default function SidebarLeft() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, refreshMe } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    apiGet<Profile[]>("/profiles")
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, [location.pathname]);

  useEffect(() => {
    refreshMe().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => p.name.toLowerCase().includes(q) || p.start_url.toLowerCase().includes(q));
  }, [profiles, search]);

  return (
    <aside
      style={{
        border: "1px solid #3333",
        borderRadius: 16,
        padding: 14,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div>
        <button
          onClick={() => navigate("/settings")}
          style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer", width: "100%" }}
        >
          Настройки
        </button>
        <hr style={{ margin: "10px 0", borderColor: "#3333" }} />
        <button
          onClick={() => navigate("/profiles/new")}
          style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer", width: "100%" }}
        >
          + Создать профиль
        </button>
        <input
          placeholder="Поиск профилей..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10, marginTop: 12 }}
        />
      </div>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          marginTop: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          minHeight: 0,
        }}
      >
        {filtered.map((p) => {
          const active = location.pathname === `/profiles/${p.id}`;
          return (
            <div
              key={p.id}
              onClick={() => navigate(`/profiles/${p.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  navigate(`/profiles/${p.id}`);
                }
              }}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: active ? "1px solid #6aa0ff" : "1px solid rgba(255,255,255,0.08)",
                background: active ? "rgba(106, 160, 255, 0.12)" : "rgba(255,255,255,0.04)",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>{p.name}</div>
              <div style={{ fontSize: 12, opacity: 0.7, wordBreak: "break-word" }}>{p.start_url}</div>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: "1px solid #3333", marginTop: 12, paddingTop: 12 }}>
        <div style={{ fontWeight: 700 }}>{user?.email ?? "неизвестно"}</div>
        <div style={{ marginTop: 6, marginBottom: 10 }}><RoleBadge role={user?.role ?? "-"} /></div>
        <button
          onClick={() => {
            logout();
            navigate("/login");
          }}
          style={{ padding: "8px 12px", borderRadius: 10, cursor: "pointer" }}
        >
          Выйти
        </button>
      </div>
    </aside>
  );
}
