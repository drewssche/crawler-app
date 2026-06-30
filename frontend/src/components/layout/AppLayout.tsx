import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Button from "../ui/Button";
import InlineActionButton from "../ui/InlineActionButton";
import { apiGet } from "../../api/client";
import SidebarLeft from "./SidebarLeft";
import SidebarRight from "./SidebarRight";
import { getProjectsCached } from "../../utils/projectListCache";
import { useAuth } from "../../hooks/auth";
import { hasPermission } from "../../utils/permissions";

const SIDEBAR_LEFT_COLLAPSED_STORAGE_KEY = "crawler.sidebarLeft.collapsed";

function readSidebarLeftCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_LEFT_COLLAPSED_STORAGE_KEY) === "1";
}

function normalizeProjectLabel(name: string | null | undefined, fallbackId?: number): string {
  const raw = (name || "").trim();
  if (!raw) {
    return Number.isFinite(fallbackId) ? `Проект #${fallbackId}` : "Проект";
  }
  return raw;
}

function parentPathFor(pathname: string) {
  const path = pathname.split("?")[0];
  if (path === "/" || path === "") return null;
  if (path === "/settings") return null;
  if (path === "/users" || path === "/logs" || path === "/monitoring" || path === "/events" || path === "/root-admins" || path === "/ui-debug") return "/settings";
  if (/^\/projects\/[0-9]+\/compare$/.test(path)) return path.replace(/\/compare$/, "");
  if (/^\/projects\/[0-9]+\/inspect$/.test(path)) return path.replace(/\/inspect$/, "");
  if (path === "/projects/new") return "/";
  if (/^\/projects\/[0-9]+$/.test(path)) return "/";

  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  const next = `/${parts.slice(0, -1).join("/")}`;
  return next === "" ? "/" : next;
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [leftCollapsed, setLeftCollapsed] = useState(() => readSidebarLeftCollapsed());
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [projectCrumbLabel, setProjectCrumbLabel] = useState<string | null>(null);

  const path = location.pathname.split("?")[0];
  const stateProjectName =
    location.state && typeof location.state === "object" && "projectName" in location.state
      ? String((location.state as { projectName?: unknown }).projectName || "")
      : "";
  const isSettingsTree =
    path === "/settings" ||
    path === "/users" ||
    path === "/logs" ||
    path === "/monitoring" ||
    path === "/events" ||
    path === "/root-admins" ||
    path === "/ui-debug";
  const canViewEvents = hasPermission(user?.role, "events.view");
  const focusWorkspaceMode = /^\/projects\/[0-9]+\/(?:compare|inspect)$/.test(path);

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
    } else if (path === "/ui-debug") {
      crumbs.push({ label: "UI Debug Center", path: "/ui-debug" });
    }
  } else {
    crumbs.push({ label: "\u0420\u0430\u0431\u043e\u0447\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c", path: "/" });
    const compareMatch = path.match(/^\/projects\/([0-9]+)\/compare$/);
    const inspectMatch = path.match(/^\/projects\/([0-9]+)\/inspect$/);
    if (compareMatch || inspectMatch) {
      const projectMatch = compareMatch || inspectMatch!;
      crumbs.push({
        label: projectCrumbLabel || `Проект #${projectMatch[1]}`,
        path: `/projects/${projectMatch[1]}`,
      });
      crumbs.push({ label: compareMatch ? "Сравнение" : "Анализ страницы", path });
    } else if (path === "/projects/new") {
      crumbs.push({ label: "\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u043f\u0440\u043e\u0435\u043a\u0442", path: "/projects/new" });
    } else {
      const match = path.match(/^\/projects\/([0-9]+)$/);
      if (match) {
        const immediate = normalizeProjectLabel(stateProjectName, Number(match[1]));
        crumbs.push({ label: projectCrumbLabel || immediate, path });
      }
    }
  }

  useEffect(() => {
    const match = path.match(/^\/projects\/([0-9]+)(?:\/(?:compare|inspect))?$/);
    if (!match) return;
    const projectId = Number(match[1]);
    if (!Number.isFinite(projectId) || projectId <= 0) return;

    let cancelled = false;
    async function loadProjectLabel() {
      try {
        const cached = await getProjectsCached(false);
        if (cancelled) return;
        const hit = cached.find((p) => p.id === projectId);
        if (hit?.name) {
          setProjectCrumbLabel(normalizeProjectLabel(hit.name, projectId));
          return;
        }
        const row = await apiGet<{ id: number; name: string }>(`/projects/${projectId}`);
        if (cancelled) return;
        setProjectCrumbLabel(normalizeProjectLabel(row?.name, projectId));
      } catch {
        if (cancelled) return;
        setProjectCrumbLabel(`\u041f\u0440\u043e\u0435\u043a\u0442 #${projectId}`);
      }
    }
    void loadProjectLabel();

    return () => {
      cancelled = true;
    };
  }, [path, stateProjectName]);

  function onBack() {
    const parent = parentPathFor(location.pathname);
    if (!parent) return;
    navigate(parent);
  }

  function toggleLeftSidebar() {
    setLeftCollapsed((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SIDEBAR_LEFT_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      }
      return next;
    });
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: focusWorkspaceMode
          ? "minmax(0, 1fr)"
          : canViewEvents
            ? rightCollapsed
              ? `${leftCollapsed ? 68 : 260}px minmax(0, 1fr) 68px`
              : `${leftCollapsed ? 68 : 260}px minmax(0, 1fr) 320px`
            : `${leftCollapsed ? 68 : 260}px minmax(0, 1fr)`,
        gap: focusWorkspaceMode ? 0 : 16,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        transition: "grid-template-columns 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      }}
    >
      {!focusWorkspaceMode && (
        <aside style={{ padding: leftCollapsed ? 8 : 16, boxSizing: "border-box", minHeight: 0, transition: "padding 220ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
          <SidebarLeft collapsed={leftCollapsed} onToggleCollapsed={toggleLeftSidebar} />
        </aside>
      )}

      <main style={{ padding: focusWorkspaceMode ? 8 : 16, boxSizing: "border-box", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
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
              variant="accent"
              style={{ opacity: parentPathFor(location.pathname) ? 1 : 0.45 }}
              title="Назад"
            >
              {"\u2190"}
            </Button>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 13, opacity: 0.9 }}>
              {crumbs.map((c, idx) => (
                <div key={c.path} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {idx > 0 && <span style={{ opacity: 0.6 }}>/</span>}
                  <InlineActionButton
                    onClick={() => navigate(c.path)}
                    style={{ opacity: 0.92 }}
                  >
                    {c.label}
                  </InlineActionButton>
                </div>
              ))}
            </div>
          </div>

          <div id="workspace-scroll-container" style={{ padding: 18, overflowY: "auto", overflowX: "hidden", minHeight: 0 }}>
            <Outlet />
          </div>
        </div>
      </main>

      {canViewEvents && !focusWorkspaceMode && (
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
      )}
    </div>
  );
}
