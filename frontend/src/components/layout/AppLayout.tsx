import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import SidebarLeft from "./SidebarLeft";
import SidebarRight from "./SidebarRight";

function parentPathFor(pathname: string) {
  const path = pathname.split("?")[0];
  if (path === "/" || path === "") return null;
  if (path === "/settings") return "/";
  if (path === "/users" || path === "/logs" || path === "/root-admins") return "/settings";
  if (path === "/compare") return "/";
  if (path === "/profiles/new") return "/";
  if (/^\/profiles\/[0-9]+$/.test(path)) return "/";

  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  const next = `/${parts.slice(0, -1).join("/")}`;
  return next === "" ? "/" : next;
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const path = location.pathname.split("?")[0];
  const crumbs: Array<{ label: string; path: string }> = [{ label: "Рабочая область", path: "/" }];

  if (path === "/settings") {
    crumbs.push({ label: "Настройки", path: "/settings" });
  } else if (path === "/users") {
    crumbs.push({ label: "Настройки", path: "/settings" });
    crumbs.push({ label: "Пользователи", path: "/users" });
  } else if (path === "/logs") {
    crumbs.push({ label: "Настройки", path: "/settings" });
    crumbs.push({ label: "Журнал действий", path: "/logs" });
  } else if (path === "/root-admins") {
    crumbs.push({ label: "Настройки", path: "/settings" });
    crumbs.push({ label: "Системные администраторы", path: "/root-admins" });
  } else if (path === "/compare") {
    crumbs.push({ label: "Сравнение", path: "/compare" });
  } else if (path === "/profiles/new") {
    crumbs.push({ label: "Создать профиль", path: "/profiles/new" });
  } else {
    const match = path.match(/^\/profiles\/([0-9]+)$/);
    if (match) {
      crumbs.push({ label: `Профиль #${match[1]}`, path });
    }
  }

  function onBack() {
    const parent = parentPathFor(location.pathname);
    if (!parent) return;
    navigate(parent);
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: rightCollapsed ? "260px minmax(0, 1fr) 52px" : "260px minmax(0, 1fr) 320px",
        gap: 16,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <aside style={{ padding: 16, boxSizing: "border-box", minHeight: 0 }}>
        <SidebarLeft />
      </aside>

      <main style={{ padding: 16, boxSizing: "border-box", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <div
          style={{
            border: "1px solid #3333",
            borderRadius: 16,
            height: "100%",
            overflow: "hidden",
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr)",
            background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
          }}
        >
          <div style={{ borderBottom: "1px solid #3333", padding: "10px 14px", display: "flex", gap: 12, alignItems: "center" }}>
            <button
              onClick={onBack}
              disabled={!parentPathFor(location.pathname)}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                cursor: parentPathFor(location.pathname) ? "pointer" : "not-allowed",
                opacity: parentPathFor(location.pathname) ? 1 : 0.45,
              }}
              title="Назад"
            >
              ←
            </button>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 13, opacity: 0.9 }}>
              {crumbs.map((c, idx) => (
                <div key={c.path} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {idx > 0 && <span style={{ opacity: 0.6 }}>/</span>}
                  <button
                    onClick={() => navigate(c.path)}
                    style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", color: "inherit" }}
                  >
                    {c.label}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: 18, overflowY: "auto", overflowX: "hidden", minHeight: 0 }}>
            <Outlet />
          </div>
        </div>
      </main>

      <aside style={{ padding: 16, boxSizing: "border-box", minHeight: 0 }}>
        <SidebarRight collapsed={rightCollapsed} onToggle={() => setRightCollapsed((v) => !v)} />
      </aside>
    </div>
  );
}
