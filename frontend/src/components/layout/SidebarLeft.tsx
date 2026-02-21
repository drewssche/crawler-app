import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/auth";
import { hasPermission } from "../../utils/permissions";
import { getProfilesCached, type ProfileListItem } from "../../utils/profileListCache";
import { resolveDisplayRole } from "../../utils/roles";
import appLogo from "../../assets/logo-crawler.svg";
import Button from "../ui/Button";
import ClearableInput from "../ui/ClearableInput";
import RoleBadge from "../ui/RoleBadge";

export default function SidebarLeft() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, refreshMe } = useAuth();
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [search, setSearch] = useState("");
  const lastMeRefreshRef = useRef(0);

  const inProfilesDomain =
    location.pathname === "/" ||
    location.pathname === "/compare" ||
    location.pathname.startsWith("/profiles/");

  useEffect(() => {
    if (!inProfilesDomain) return;
    const force = location.pathname.startsWith("/profiles/new");
    getProfilesCached(force)
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, [inProfilesDomain, location.pathname]);

  useEffect(() => {
    const now = Date.now();
    if (now - lastMeRefreshRef.current < 60_000) return;
    lastMeRefreshRef.current = now;
    refreshMe().catch(() => null);
  }, [location.pathname, refreshMe]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => p.name.toLowerCase().includes(q) || p.start_url.toLowerCase().includes(q));
  }, [profiles, search]);

  const inSettings =
    location.pathname === "/settings" ||
    location.pathname.startsWith("/users") ||
    location.pathname.startsWith("/logs") ||
    location.pathname.startsWith("/monitoring") ||
    location.pathname.startsWith("/events") ||
    location.pathname.startsWith("/root-admins");

  const inWorkspace =
    location.pathname === "/" ||
    location.pathname.startsWith("/profiles/") ||
    location.pathname === "/compare";

  const envLabel = (import.meta.env.MODE || "dev").toUpperCase();
  const canOpenSettings = hasPermission(user?.role, "users.manage");

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
        <div
          style={{
            minHeight: 76,
            borderRadius: 10,
            border: "1px solid #3333",
            background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
            display: "grid",
            gridTemplateColumns: "48px minmax(0, 1fr)",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            opacity: 0.92,
            marginBottom: 10,
            padding: "10px 12px",
          }}
        >
          <img src={appLogo} alt="Crawler logo" width={36} height={36} style={{ display: "block" }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, letterSpacing: 0.2, lineHeight: 1.2 }}>Crawler App</div>
            <div style={{ fontSize: 11, opacity: 0.75, lineHeight: 1.2 }}>control panel</div>
            <div
              style={{
                marginTop: 4,
                display: "inline-flex",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.3,
                borderRadius: 999,
                border: "1px solid rgba(106,160,255,0.45)",
                background: "rgba(106,160,255,0.14)",
                color: "#cfe0ff",
                padding: "2px 8px",
                whiteSpace: "nowrap",
                maxWidth: "100%",
              }}
              title="Текущее окружение"
            >
              {envLabel}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <Button onClick={() => navigate("/")} variant="secondary" active={inWorkspace} fullWidth>
            {"\u0420\u0430\u0431\u043e\u0447\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c"}
          </Button>
          {canOpenSettings && (
            <Button onClick={() => navigate("/settings")} variant="secondary" active={inSettings} fullWidth>
              {"\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438"}
            </Button>
          )}
        </div>

        <hr style={{ margin: "10px 0", borderColor: "#3333" }} />

        <Button onClick={() => navigate("/profiles/new")} variant="primary" fullWidth>
          + {"\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c"}
        </Button>

        <ClearableInput
          placeholder={"\u041f\u043e\u0438\u0441\u043a \u043f\u0440\u043e\u0444\u0438\u043b\u0435\u0439..."}
          value={search}
          onChange={setSearch}
          containerStyle={{ marginTop: 12 }}
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
        <div style={{ fontWeight: 700 }}>{user?.email ?? "\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e"}</div>
        <div style={{ marginTop: 6, marginBottom: 10 }}>
          <RoleBadge role={resolveDisplayRole({ role: user?.role })} />
        </div>
        <Button
          onClick={() => {
            logout();
            navigate("/login");
          }}
          size="sm"
          variant="secondary"
        >
          {"\u0412\u044b\u0439\u0442\u0438"}
        </Button>
      </div>
    </aside>
  );
}
