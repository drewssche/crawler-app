import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/auth";
import { hasPermission } from "../../utils/permissions";
import { getProjectsSummaryCached, type ProjectSummaryItem } from "../../utils/projectListCache";
import { summarizeProjectSites } from "../../utils/projectSitesSummary";
import { applyProjectRunLiveUpdate, subscribeProjectRunLive } from "../../utils/projectRunLiveStore";
import { isMeaningfulProjectSearch, searchProjects, shouldShowProjectMatchHint } from "../../utils/projectSearch";
import { resolveDisplayRole } from "../../utils/roles";
import appLogo from "../../assets/logo-crawler.svg";
import Button from "../ui/Button";
import Card from "../ui/Card";
import ClearableInput from "../ui/ClearableInput";
import HighlightedText from "../ui/HighlightedText";
import ProjectRunBadge, { getProjectRunBadgeMeta } from "../ui/ProjectRunBadge";
import ScrollableRegion from "../ui/ScrollableRegion";
import RoleBadge from "../ui/RoleBadge";

export default function SidebarLeft() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, refreshMe } = useAuth();
  const [projects, setProjects] = useState<ProjectSummaryItem[]>([]);
  const [search, setSearch] = useState("");
  const lastMeRefreshRef = useRef(0);

  useEffect(() => {
    const force = location.pathname.startsWith("/projects/new");
    getProjectsSummaryCached(force)
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [location.pathname]);

  useEffect(() => subscribeProjectRunLive((update) => {
    setProjects((prev) => prev.map((row) => applyProjectRunLiveUpdate(row, update)));
  }), []);

  useEffect(() => {
    const now = Date.now();
    if (now - lastMeRefreshRef.current < 60_000) return;
    lastMeRefreshRef.current = now;
    refreshMe().catch(() => null);
  }, [location.pathname, refreshMe]);

  const filtered = useMemo(() => searchProjects(projects, search), [projects, search]);
  const searchActive = isMeaningfulProjectSearch(search);

  const inSettings =
    location.pathname === "/settings" ||
    location.pathname.startsWith("/users") ||
    location.pathname.startsWith("/logs") ||
    location.pathname.startsWith("/monitoring") ||
    location.pathname.startsWith("/events") ||
    location.pathname.startsWith("/root-admins") ||
    location.pathname.startsWith("/ui-debug");

  const inWorkspace =
    location.pathname === "/" ||
    location.pathname.startsWith("/projects/");

  const envLabel = (import.meta.env.MODE || "dev").toUpperCase();
  const canOpenSettings = hasPermission(user?.role, "users.manage");
  const canEditProjects = hasPermission(user?.role, "projects.edit");

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
          <Button onClick={() => navigate("/")} variant="accent" active={inWorkspace} fullWidth>
            {"\u0420\u0430\u0431\u043e\u0447\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c"}
          </Button>
          {canOpenSettings && (
            <Button onClick={() => navigate("/settings")} variant="accent" active={inSettings} fullWidth>
              {"\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438"}
            </Button>
          )}
        </div>

        <hr style={{ margin: "10px 0", borderColor: "#3333" }} />

        {canEditProjects && (
          <Button
            onClick={() => navigate("/projects/new")}
            variant="primary"
            active={location.pathname.startsWith("/projects/new")}
            fullWidth
          >
            + {"\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u043f\u0440\u043e\u0435\u043a\u0442"}
          </Button>
        )}

        <ClearableInput
          placeholder={"\u041f\u043e\u0438\u0441\u043a \u043f\u0440\u043e\u0435\u043a\u0442\u043e\u0432..."}
          value={search}
          onChange={setSearch}
          containerStyle={{ marginTop: canEditProjects ? 12 : 0 }}
        />
      </div>

      <ScrollableRegion
        style={{
          flex: 1,
          marginTop: 12,
          paddingTop: 2,
          paddingInline: 2,
          paddingBottom: 2,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          overflowX: "visible",
        }}
      >
        {filtered.length === 0 && searchActive && (
          <Card variant="hint" style={{ display: "grid", gap: 8, padding: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Проекты не найдены</div>
            <Button size="sm" variant="ghost" onClick={() => setSearch("")}>Очистить поиск</Button>
          </Card>
        )}
        {filtered.map((match) => {
          const p = match.project;
          const active = location.pathname === `/projects/${p.id}`;
          const statusMeta = getProjectRunBadgeMeta(p.last_run?.status);
          const siteSummary = summarizeProjectSites(p);
          const showMatchHint = shouldShowProjectMatchHint(match, [p.name, siteSummary]);
          return (
            <Card
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`, { state: { projectName: p.name } })}
              interactive
              className="project-row"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(`/projects/${p.id}`, { state: { projectName: p.name } });
                }
              }}
              style={{
                "--project-row-base-bg": statusMeta.rowBaseBg,
                "--project-row-base-border": statusMeta.rowBaseBorder,
                "--project-row-hover-bg": statusMeta.rowHoverBg,
                "--project-row-hover-border": statusMeta.rowHoverBorder,
                padding: "10px 12px",
                border: active ? `1px solid ${statusMeta.rowActiveBorder}` : `1px solid ${statusMeta.rowBaseBorder}`,
                background: active ? statusMeta.rowActiveBg : statusMeta.rowBaseBg,
                boxShadow: active ? `0 0 0 1px ${statusMeta.rowActiveBorder} inset` : undefined,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              } as CSSProperties}
            >
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start", gap: 8 }}>
                <div
                  title={p.name}
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    lineHeight: 1.2,
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  <HighlightedText value={p.name} query={match.highlightQuery} />
                </div>
                <div style={{ flexShrink: 0 }}>
                  <ProjectRunBadge status={p.last_run?.status} compact />
                </div>
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, wordBreak: "break-word" }}>
                <HighlightedText value={siteSummary} query={match.highlightQuery} />
              </div>
              {showMatchHint && match.matchedValue && (
                <div style={{ fontSize: 11, opacity: 0.68, wordBreak: "break-word" }}>
                  Совпадение: <HighlightedText value={match.matchedValue} query={match.highlightQuery} />
                </div>
              )}
            </Card>
          );
        })}
      </ScrollableRegion>

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
