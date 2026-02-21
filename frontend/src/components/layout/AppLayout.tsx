import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Button from "../ui/Button";
import SidebarLeft from "./SidebarLeft";
import SidebarRight from "./SidebarRight";

function parentPathFor(pathname: string) {
  const path = pathname.split("?")[0];
  if (path === "/" || path === "") return null;
  if (path === "/settings") return null;
  if (path === "/users" || path === "/logs" || path === "/monitoring" || path === "/events" || path === "/root-admins") return "/settings";
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
  const isSettingsTree =
    path === "/settings" ||
    path === "/users" ||
    path === "/logs" ||
    path === "/monitoring" ||
    path === "/events" ||
    path === "/root-admins";

  const crumbs: Array<{ label: string; path: string }> = [];

  if (isSettingsTree) {
    crumbs.push({ label: "\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438", path: "/settings" });
    if (path === "/users") {
      crumbs.push({ label: "\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438", path: "/users" });
    } else if (path === "/logs") {
      crumbs.push({ label: "\u0416\u0443\u0440\u043d\u0430\u043b \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439", path: "/logs" });
    } else if (path === "/monitoring") {
      crumbs.push({ label: "\u041c\u043e\u043d\u0438\u0442\u043e\u0440\u0438\u043d\u0433", path: "/monitoring" });
    } else if (path === "/events") {
      crumbs.push({ label: "\u0426\u0435\u043d\u0442\u0440 \u0441\u043e\u0431\u044b\u0442\u0438\u0439", path: "/events" });
    } else if (path === "/root-admins") {
      crumbs.push({ label: "\u0421\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0435 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u044b", path: "/root-admins" });
    }
  } else {
    crumbs.push({ label: "\u0420\u0430\u0431\u043e\u0447\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c", path: "/" });
    if (path === "/compare") {
      crumbs.push({ label: "\u0421\u0440\u0430\u0432\u043d\u0435\u043d\u0438\u0435", path: "/compare" });
    } else if (path === "/profiles/new") {
      crumbs.push({ label: "\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c", path: "/profiles/new" });
    } else {
      const match = path.match(/^\/profiles\/([0-9]+)$/);
      if (match) {
        crumbs.push({ label: `\u041f\u0440\u043e\u0444\u0438\u043b\u044c #${match[1]}`, path });
      }
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
        gridTemplateColumns: rightCollapsed ? "260px minmax(0, 1fr) 68px" : "260px minmax(0, 1fr) 320px",
        gap: 16,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        transition: "grid-template-columns 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
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
            <Button
              onClick={onBack}
              disabled={!parentPathFor(location.pathname)}
              size="sm"
              variant="ghost"
              style={{ opacity: parentPathFor(location.pathname) ? 1 : 0.45 }}
              title="Назад"
            >
              {"\u2190"}
            </Button>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 13, opacity: 0.9 }}>
              {crumbs.map((c, idx) => (
                <div key={c.path} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {idx > 0 && <span style={{ opacity: 0.6 }}>/</span>}
                  <Button
                    onClick={() => navigate(c.path)}
                    variant="ghost"
                    size="sm"
                    style={{ border: "none", background: "transparent", padding: 0, minHeight: "auto" }}
                  >
                    {c.label}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div id="workspace-scroll-container" style={{ padding: 18, overflowY: "auto", overflowX: "hidden", minHeight: 0 }}>
            <Outlet />
          </div>
        </div>
      </main>

      <aside
        style={{
          padding: rightCollapsed ? 8 : 16,
          boxSizing: "border-box",
          minHeight: 0,
          transition: "padding 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      >
        <SidebarRight collapsed={rightCollapsed} onToggle={() => setRightCollapsed((v) => !v)} />
      </aside>
    </div>
  );
}
