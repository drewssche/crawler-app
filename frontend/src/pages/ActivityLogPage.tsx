import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useLocation, useNavigate } from "react-router-dom";

import { apiGet, apiPost, isAbortError } from "../api/client";

import { useAuth } from "../hooks/auth";

import { formatApiDateTime } from "../utils/datetime";
import { downloadBlobFile } from "../utils/download";
import { normalizeError } from "../utils/errors";

import { getAuditRelevance } from "../utils/relevance";

import AccentPill from "../components/ui/AccentPill";

import Card from "../components/ui/Card";

import Button from "../components/ui/Button";

import EmptyState from "../components/ui/EmptyState";

import FiltersBar from "../components/ui/FiltersBar";

import RelevanceBadge from "../components/ui/RelevanceBadge";

import SegmentedControl from "../components/ui/SegmentedControl";

import SlidePanel from "../components/ui/SlidePanel";

import Timeline from "../components/ui/Timeline";

import UiSelect from "../components/ui/UiSelect";

import ClearableInput from "../components/ui/ClearableInput";

import ContextQuickActions from "../components/ui/ContextQuickActions";

import UserActionPanel, {

  type ActionCatalogItem,

  type BulkAction,

  type TrustPolicy,

  type TrustPolicyCatalogItem,

} from "../components/users/UserActionPanel";

import { shortUserAgent } from "../utils/userAgent";
import { UI_BULLET } from "../utils/uiText";
import { getAuditActionCatalogCached, getUserAndTrustCatalogsCached } from "../utils/catalogCache";
import { loadUserContextByEmail, loadUserContextById } from "../utils/userContext";
import {
  useActivityFeed,
  type ActivityAuditItem,
  type ActivityLoginItem,
  type ActivityMode,
} from "../hooks/useActivityFeed";
import { useGuardedAsyncState } from "../hooks/useGuardedAsyncState";
import { useWorkspaceInfiniteScroll } from "../hooks/useWorkspaceInfiniteScroll";
import type {
  AuditActionCatalogItem,
} from "../types/catalog";
import type { IdEmail } from "../types/common";

import type { UserDetailsResponse } from "../components/users/UserDetailsDrawer";

import { UserStatusPills } from "../components/users/UserStatusPills";



type Mode = ActivityMode;

const PAGE_SIZE = 20;

type UserItem = IdEmail;



type AuditItem = ActivityAuditItem;
type LoginItem = ActivityLoginItem;



type FocusContext =

  | { kind: "audit"; row: AuditItem }

  | { kind: "login"; row: LoginItem };



function formatDate(value: string) {

  return formatApiDateTime(value);

}



function actorLabel(email: string, currentUserEmail?: string | null): string {
  const normalized = (email || "").trim().toLowerCase();
  const current = (currentUserEmail || "").trim().toLowerCase();
  if (!normalized) return "неизвестно";
  if (normalized && current && normalized === current) return "Вы (" + email + ")";
  return email;
}



function targetLabel(email: string): string {
  const normalized = (email || "").trim();
  if (!normalized) return "не указано";
  return normalized;
}



function ipHint(ip: string | null | undefined): string {
  const value = (ip || "").trim();
  if (!value) return "-";
  if (value.startsWith("172.") || value.startsWith("10.") || value.startsWith("192.168.")) {
    return `${value} (локальный IP)`;
  }
  return value;
}



function RelatedRecordCard({ title, children }: { title: string; children: ReactNode }) {

  return (

    <Card style={{ borderColor: "rgba(106,160,255,0.55)", background: "rgba(106,160,255,0.08)" }}>

      <div style={{ display: "grid", gap: 6 }}>

        <div style={{ fontWeight: 700 }}>{title}</div>

        {children}

      </div>

    </Card>

  );

}



export default function ActivityLogPage() {

  const navigate = useNavigate();

  const location = useLocation();

  const { user } = useAuth();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const highlightLogId = useMemo(() => {

    const raw = params.get("highlight_log_id");

    if (!raw) return null;

    const n = Number(raw);

    return Number.isFinite(n) ? n : null;

  }, [params]);

  const highlightLoginId = useMemo(() => {

    const raw = params.get("highlight_login_id");

    if (!raw) return null;

    const n = Number(raw);

    return Number.isFinite(n) ? n : null;

  }, [params]);

  const [mode, setMode] = useState<Mode>(() => {

    if (highlightLoginId !== null) return "login";

    if (highlightLogId !== null) return "audit";

    return params.get("mode") === "login" ? "login" : "audit";

  });



  const [users, setUsers] = useState<UserItem[]>([]);

  const [actionCatalog, setActionCatalog] = useState<AuditActionCatalogItem[]>([]);

  const [error, setError] = useState("");



  const [action, setAction] = useState("");

  const [actorEmail, setActorEmail] = useState("");

  const [targetEmail, setTargetEmail] = useState(params.get("email") || "");

  const [securityOnly, setSecurityOnly] = useState(false);

  const [dateFrom, setDateFrom] = useState("");

  const [dateTo, setDateTo] = useState("");

  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const [ipFilter, setIpFilter] = useState("");

  const [resultFilter, setResultFilter] = useState("");

  const [sourceFilter, setSourceFilter] = useState("");
  const [emailSuggestQuery, setEmailSuggestQuery] = useState("");
  const [isEmailSuggestLoading, setIsEmailSuggestLoading] = useState(false);



  const emailSuggestRequestSeqRef = useRef(0);
  const reloadRafRef = useRef<number | null>(null);

  const lastScrolledTargetRef = useRef<string>("");



  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");

  const [showFilters, setShowFilters] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);

  const [drawerData, setDrawerData] = useState<UserDetailsResponse | null>(null);

  const [drawerAvailableActions, setDrawerAvailableActions] = useState<BulkAction[]>([]);

  const [userActionCatalog, setUserActionCatalog] = useState<Record<BulkAction, ActionCatalogItem>>({} as Record<BulkAction, ActionCatalogItem>);

  const [trustPolicyCatalog, setTrustPolicyCatalog] = useState<Record<TrustPolicy, TrustPolicyCatalogItem>>({} as Record<TrustPolicy, TrustPolicyCatalogItem>);

  const [focusContext, setFocusContext] = useState<FocusContext | null>(null);

  const [handledAudit, setHandledAudit] = useState<Record<number, true>>({});

  const [handledLogin, setHandledLogin] = useState<Record<number, true>>({});
  const {
    isLoading: drawerLoading,
    error: drawerError,
    run: runDrawerContextTask,
  } = useGuardedAsyncState();



  const { auditRows, loginRows, total, isLoading: isFeedLoading, hasMore, resetAndLoad, requestNextPage } = useActivityFeed({
    mode,
    pageSize: PAGE_SIZE,
    dateFrom,
    dateTo,
    sortDir,
    action,
    actorEmail,
    targetEmail,
    securityOnly,
    ipFilter,
    resultFilter,
    sourceFilter,
    onReset: () => setError(""),
    onError: (e) => setError(normalizeError(e)),
  });

  const loadedCount = mode === "audit" ? auditRows.length : loginRows.length;



  useEffect(() => {
    getAuditActionCatalogCached().then(setActionCatalog).catch(() => setActionCatalog([]));

    getUserAndTrustCatalogsCached()

      .then(({ actionCatalog: actions, trustPolicyCatalog: trust }) => {

        setUserActionCatalog(actions);

        setTrustPolicyCatalog(trust);

      })

      .catch(() => {

        setUserActionCatalog({} as Record<BulkAction, ActionCatalogItem>);

        setTrustPolicyCatalog({} as Record<TrustPolicy, TrustPolicyCatalogItem>);

      });

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, []);

  useEffect(() => {
    const query = emailSuggestQuery.trim().toLowerCase();
    if (query.length < 2) {
      setUsers([]);
      setIsEmailSuggestLoading(false);
      return;
    }

    let active = true;
    const controller = new AbortController();
    const requestSeq = ++emailSuggestRequestSeqRef.current;
    const timer = window.setTimeout(() => {
      setIsEmailSuggestLoading(true);
      apiGet<UserItem[]>(`/admin/users?status=all&q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((rows) => {
          if (!active) return;
          if (requestSeq !== emailSuggestRequestSeqRef.current) return;
          setUsers((rows || []).slice(0, 20));
        })
        .catch((e) => {
          if (isAbortError(e)) return;
          if (!active) return;
          if (requestSeq !== emailSuggestRequestSeqRef.current) return;
          setUsers([]);
        })
        .finally(() => {
          if (!active) return;
          if (requestSeq !== emailSuggestRequestSeqRef.current) return;
          setIsEmailSuggestLoading(false);
        });
    }, 220);

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [emailSuggestQuery]);



  useEffect(() => {

    if (highlightLoginId !== null) {

      setMode("login");

      return;

    }

    if (highlightLogId !== null) {

      setMode("audit");

      return;

    }

    setMode(params.get("mode") === "login" ? "login" : "audit");

  }, [highlightLogId, highlightLoginId, params]);



  useEffect(() => {

    resetAndLoad();

  }, [mode, resetAndLoad]);

  const scheduleResetAndLoad = useCallback(() => {
    if (reloadRafRef.current !== null) {
      window.cancelAnimationFrame(reloadRafRef.current);
    }
    reloadRafRef.current = window.requestAnimationFrame(() => {
      reloadRafRef.current = null;
      resetAndLoad();
    });
  }, [resetAndLoad]);

  useEffect(() => {
    return () => {
      if (reloadRafRef.current !== null) {
        window.cancelAnimationFrame(reloadRafRef.current);
        reloadRafRef.current = null;
      }
    };
  }, []);



  async function exportLogs(ext: "csv" | "xlsx") {

    const p = new URLSearchParams({

      date_from: dateFrom,

      date_to: dateTo,

      sort_dir: sortDir,

    });

    let url = "";

    let filename = "";

    if (mode === "audit") {

      p.set("action", action.trim());

      p.set("actor_email", actorEmail.trim());

      p.set("target_email", targetEmail.trim());

      p.set("security_only", String(securityOnly));

      url = `/admin/audit/export.${ext}?${p.toString()}`;

      filename = `admin_audit_logs.${ext}`;

    } else {

      p.set("email", targetEmail.trim());

      p.set("ip", ipFilter.trim());

      p.set("result", resultFilter.trim());

      p.set("source", sourceFilter.trim());

      url = `/admin/login-history/export.${ext}?${p.toString()}`;

      filename = `login_history.${ext}`;

    }

    try {

      await downloadBlobFile(url, filename);

    } catch (e) {

      setError(normalizeError(e));

    }

  }



  useWorkspaceInfiniteScroll({
    canLoadMore: hasMore,
    isLoading: isFeedLoading,
    onLoadMore: requestNextPage,
    contentKey: `${mode}:${auditRows.length}:${loginRows.length}`,
  });



  useEffect(() => {

    if (mode === "audit" && highlightLogId !== null) {

      const exists = auditRows.some((row) => row.id === highlightLogId);

      if (!exists) requestNextPage();

    }

    if (mode === "login" && highlightLoginId !== null) {

      const exists = loginRows.some((row) => row.id === highlightLoginId);

      if (!exists) requestNextPage();

    }

  }, [auditRows, highlightLogId, highlightLoginId, loginRows, mode, requestNextPage]);



  useEffect(() => {

    const targetId = mode === "audit" ? highlightLogId : highlightLoginId;

    if (targetId === null) return;

    const rowId = mode === "audit" ? `audit-log-row-${targetId}` : `login-row-${targetId}`;

    const el = document.getElementById(rowId);

    if (!el) return;

    if (lastScrolledTargetRef.current === rowId) return;

    lastScrolledTargetRef.current = rowId;

    el.scrollIntoView({ behavior: "smooth", block: "center" });

  }, [auditRows, highlightLogId, highlightLoginId, loginRows, mode]);



  function openUserByEmail(email: string | null | undefined) {

    const value = (email || "").trim().toLowerCase();

    if (!value) return;

    navigate(`/users?highlight_email=${encodeURIComponent(value)}`);

  }

  function handleActorEmailChange(value: string) {
    setActorEmail(value);
    setEmailSuggestQuery(value);
  }

  function handleTargetEmailChange(value: string) {
    setTargetEmail(value);
    setEmailSuggestQuery(value);
  }



  async function openContextByEmail(email: string, context: FocusContext) {
    const normalized = email.trim().toLowerCase();

    if (!normalized) return;

    setDrawerOpen(true);

    setDrawerData(null);

    setDrawerAvailableActions([]);

    setFocusContext(context);
    await runDrawerContextTask(async ({ isCurrent, setError }) => {
      const contextUser = await loadUserContextByEmail(normalized);
      if (!isCurrent()) return;

      if (!contextUser) {

        setError("Пользователь не найден в БД.");

        return;

      }

      setDrawerData(contextUser.details);

      setDrawerAvailableActions(contextUser.availableActions);
    });

  }



  function openAuditContext(row: AuditItem) {

    openContextByEmail(row.target_email || row.actor_email, { kind: "audit", row });

  }



  function openLoginContext(row: LoginItem) {

    openContextByEmail(row.email, { kind: "login", row });

  }



  function applyAuditActionFilter(actionValue: string) {

    setMode("audit");

    setAction(actionValue);

    scheduleResetAndLoad();

    setDrawerOpen(false);

  }



  function applyAuditTargetFilter(email: string) {

    setMode("audit");

    setTargetEmail(email);

    scheduleResetAndLoad();

    setDrawerOpen(false);

  }



  function applyLoginIpFilter(ip: string | null) {

    setMode("login");

    setIpFilter(ip || "");

    scheduleResetAndLoad();

    setDrawerOpen(false);

  }



  async function runDrawerUserAction(payload: { action: BulkAction; role?: "viewer" | "editor" | "admin"; trust_policy?: TrustPolicy; reason?: string }) {

    if (!drawerData?.user?.id) return;

    await apiPost("/admin/users/bulk", {

      user_ids: [drawerData.user.id],

      action: payload.action,

      role: payload.role,

      trust_policy: payload.trust_policy,

      reason: payload.reason,

    });

    const refreshed = await loadUserContextById(drawerData.user.id);

    setDrawerData(refreshed.details);

    setDrawerAvailableActions(refreshed.availableActions);

  }



  function markContextHandled() {

    if (!focusContext) return;

    if (focusContext.kind === "audit") {

      setHandledAudit((prev) => ({ ...prev, [focusContext.row.id]: true }));

      return;

    }

    setHandledLogin((prev) => ({ ...prev, [focusContext.row.id]: true }));

  }



  return (

    <div>

      <h2 style={{ marginTop: 0 }}>Журнал действий</h2>



      <FiltersBar>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>

            <SegmentedControl

              value={mode}

              onChange={setMode}

              options={[

                { value: "audit", label: "Аудит" },

                { value: "login", label: "Входы" },

              ]}

            />

          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", borderLeft: "1px solid #3333", paddingLeft: 12 }}>

            <Button variant="ghost" active={showFilters} onClick={() => setShowFilters((v) => !v)}>

              {showFilters ? "Скрыть фильтры" : "Фильтры"}

            </Button>

            <UiSelect value={exportFormat} onChange={(e) => setExportFormat(e.target.value as "csv" | "xlsx")}>

              <option value="csv">CSV</option>

              <option value="xlsx">XLSX</option>

            </UiSelect>

            <Button variant="secondary" onClick={() => exportLogs(exportFormat)}>
              Экспорт {mode === "audit" ? "аудита" : "входов"}
            </Button>

          </div>

        </div>



        {showFilters && (

          <div style={{ display: "grid", gap: 8 }}>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>

              {mode === "audit" ? (

                <>

                  <UiSelect value={action} onChange={(e) => setAction(e.target.value)}>

                    <option value="">Все действия</option>

                    {actionCatalog.map((x) => <option key={x.action} value={x.action}>{x.label}</option>)}

                  </UiSelect>

                  <ClearableInput value={actorEmail} onChange={handleActorEmailChange} placeholder="Администратор (email)" list="emails-list" />

                  <ClearableInput value={targetEmail} onChange={handleTargetEmailChange} placeholder="Пользователь (email)" list="emails-list" />

                </>

              ) : (

                <>

                  <ClearableInput value={targetEmail} onChange={handleTargetEmailChange} placeholder="Email пользователя" list="emails-list" />

                  <ClearableInput value={ipFilter} onChange={setIpFilter} placeholder="IP" />

                  <UiSelect value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>

                    <option value="">Все результаты</option>

                    <option value="success">success</option>

                    <option value="invalid_code">invalid_code</option>

                    <option value="too_many_attempts">too_many_attempts</option>

                    <option value="not_allowed">not_allowed</option>

                    <option value="blocked">blocked</option>

                    <option value="pending">pending</option>

                    <option value="not_found">not_found</option>

                    <option value="code_sent">code_sent</option>

                  </UiSelect>

                </>

              )}

            </div>



            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 160px auto", gap: 8, alignItems: "center" }}>

              <input type="datetime-local" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ padding: 10, borderRadius: 10 }} />

              <input type="datetime-local" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ padding: 10, borderRadius: 10 }} />

              <SegmentedControl

                value={sortDir}

                onChange={setSortDir}

                options={[

                  { value: "desc", label: "Новые" },

                  { value: "asc", label: "Старые" },

                ]}

              />

              {mode === "audit" ? (

                <label style={{ fontSize: 13, opacity: 0.9 }}>
                  <input type="checkbox" checked={securityOnly} onChange={(e) => setSecurityOnly(e.target.checked)} /> Только security
                </label>

              ) : (

                <UiSelect value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>

                  <option value="">Все источники</option>

                  <option value="start">start</option>

                  <option value="verify_code">verify_code</option>

                  <option value="trusted_device">trusted_device</option>

                </UiSelect>

              )}

            </div>



            <div style={{ display: "flex", gap: 8 }}>

              <Button variant="primary" onClick={resetAndLoad}>Применить</Button>

              <Button
                variant="ghost"
                onClick={() => {
                  setAction("");
                  setActorEmail("");
                  setTargetEmail("");
                  setIpFilter("");
                  setResultFilter("");
                  setSourceFilter("");
                  setSecurityOnly(false);
                  setDateFrom("");
                  setDateTo("");
                  setSortDir("desc");
                  resetAndLoad();
                }}
              >
                Сбросить
              </Button>

            </div>

          </div>

        )}

      </FiltersBar>



      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>Загружено: {loadedCount} из {total}</div>
      {showFilters && isEmailSuggestLoading && (
        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.72 }}>Подсказки email: загрузка...</div>
      )}



      <datalist id="emails-list">

        {users.map((u) => <option key={u.id} value={u.email} />)}

      </datalist>



      {error && <div style={{ color: "#d55", marginTop: 10 }}>{error}</div>}



      <Card style={{ marginTop: 12, minHeight: 360 }}>

        <div style={{ paddingRight: 4 }}>

        {mode === "audit" ? (

          auditRows.length > 0 ? (

            <Timeline

              items={auditRows.map((a) => ({

                key: a.id,

                content: (() => {

                  const isHighlighted = highlightLogId === a.id;

                  const relevance = getAuditRelevance({

                    actorEmail: a.actor_email,

                    targetEmail: a.target_email,

                    currentUserEmail: user?.email ?? "",

                    selectedUserEmail: targetEmail.trim() || null,

                  });

                  const toneStyle =

                    relevance === "self"

                      ? { borderColor: "rgba(106,160,255,0.45)", background: "rgba(106,160,255,0.07)" }

                      : relevance === "selected"

                        ? { borderColor: "rgba(80,210,200,0.4)", background: "rgba(80,210,200,0.07)" }

                        : {};

                  const highlightStyle = isHighlighted

                    ? {

                        borderColor: "rgba(255,184,92,0.88)",

                        boxShadow: "0 0 0 2px rgba(255,184,92,0.28)",

                        background: "rgba(255,184,92,0.12)",

                      }

                    : {};

                  return (

                    <Card

                      id={`audit-log-row-${a.id}`}

                      className="interactive-row"

                      style={{ ...toneStyle, ...highlightStyle, cursor: "pointer" }}

                      onClick={() => openAuditContext(a)}

                    >

                      <div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>

                          <button

                            type="button"

                            onClick={(e) => {

                              e.stopPropagation();

                              setAction(a.action);

                              scheduleResetAndLoad();

                            }}

                            style={{ all: "unset", fontWeight: 700, cursor: "pointer" }}

                            title="Фильтр по этому действию"

                          >

                            {(actionCatalog.find((x) => x.action === a.action)?.label) || a.action}

                          </button>

                          <RelevanceBadge relevance={relevance} />

                        </div>

                        <div style={{ fontSize: 13, opacity: 0.8 }}>{formatDate(a.created_at)}</div>

                        <div style={{ fontSize: 13, opacity: 0.9 }}>

                          <button

                            type="button"

                            onClick={(e) => {

                              e.stopPropagation();

                              setActorEmail(a.actor_email);

                              scheduleResetAndLoad();

                            }}

                            style={{ all: "unset", cursor: "pointer" }}

                            title="Фильтр по администратору"

                          >

                            {actorLabel(a.actor_email, user?.email)}

                          </button>

                          {" > "}

                          <button

                            type="button"

                            onClick={(e) => {

                              e.stopPropagation();

                              setTargetEmail(a.target_email);

                              scheduleResetAndLoad();

                            }}

                            style={{ all: "unset", cursor: "pointer" }}

                            title="Фильтр по получателю"

                          >

                            {targetLabel(a.target_email)}

                          </button>

                        </div>

                        <div style={{ fontSize: 12, opacity: 0.75 }}>

                          IP инициатора действия:{" "}

                          <button

                            type="button"

                            onClick={(e) => {

                              e.stopPropagation();

                              setMode("login");

                              setIpFilter(a.ip || "");

                              scheduleResetAndLoad();

                            }}

                            style={{ all: "unset", cursor: "pointer" }}

                            title="Фильтр по этому IP"

                          >

                            {ipHint(a.ip)}

                          </button>

                        </div>

                        {a.meta && typeof a.meta.reason === "string" && a.meta.reason.trim() && (

                          <div style={{ fontSize: 12, opacity: 0.85 }}>Причина: {a.meta.reason}</div>

                        )}

                      </div>

                    </Card>

                  );

                })(),

              }))}

            />

          ) : (!error && !isFeedLoading && <div style={{ height: "100%", display: "grid", placeItems: "center" }}><EmptyState text="Записей не найдено." /></div>)

        ) : (

          loginRows.length > 0 ? (

            <Timeline

              items={loginRows.map((r) => ({

                key: r.id,

                content: (() => {

                  const isHighlighted = highlightLoginId === r.id;

                  const relevance = getAuditRelevance({

                    targetEmail: r.email,

                    currentUserEmail: user?.email ?? "",

                    selectedUserEmail: targetEmail.trim() || null,

                  });

                  const toneStyle =

                    relevance === "self"

                      ? { borderColor: "rgba(106,160,255,0.45)", background: "rgba(106,160,255,0.07)" }

                      : relevance === "selected"

                        ? { borderColor: "rgba(80,210,200,0.4)", background: "rgba(80,210,200,0.07)" }

                        : {};

                  const highlightStyle = isHighlighted

                    ? {

                        borderColor: "rgba(255,184,92,0.88)",

                        boxShadow: "0 0 0 2px rgba(255,184,92,0.28)",

                        background: "rgba(255,184,92,0.12)",

                      }

                    : {};

                  return (

                    <Card

                      id={`login-row-${r.id}`}

                      className="interactive-row"

                      style={{ ...toneStyle, ...highlightStyle, cursor: "pointer" }}

                      onClick={() => openLoginContext(r)}

                    >

                      <div>

                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>

                          <button

                            type="button"

                            onClick={(e) => {

                              e.stopPropagation();

                              setTargetEmail(r.email);

                              scheduleResetAndLoad();

                            }}

                            style={{ all: "unset", fontWeight: 700, cursor: "pointer" }}

                            title="Фильтр по этому email"

                          >

                            {r.email}

                          </button>

                          <RelevanceBadge relevance={relevance} />

                        </div>

                        <div style={{ fontSize: 13, opacity: 0.9 }}>

                          <button

                            type="button"

                            onClick={(e) => {

                              e.stopPropagation();

                              setResultFilter(r.result);

                              setSourceFilter(r.source);

                              scheduleResetAndLoad();

                            }}

                            style={{ all: "unset", cursor: "pointer" }}

                            title="Фильтр по этому результату"

                          >

                            {r.result}{UI_BULLET}{r.source}

                          </button>

                        </div>

                        <div style={{ fontSize: 13, opacity: 0.8 }}>{formatDate(r.created_at)}</div>

                        <div style={{ fontSize: 12, opacity: 0.75 }}>

                          IP клиента входа:{" "}

                          <button

                            type="button"

                            onClick={(e) => {

                              e.stopPropagation();

                              setIpFilter(r.ip || "");

                              scheduleResetAndLoad();

                            }}

                            style={{ all: "unset", cursor: "pointer" }}

                            title="Фильтр по этому IP"

                          >

                            {ipHint(r.ip)}

                          </button>

                        </div>

                        <div

                          style={{ fontSize: 12, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}

                          title={r.user_agent || "-"}

                        >

                          UA (идентификатор браузера/устройства): {shortUserAgent(r.user_agent)}

                        </div>

                      </div>

                    </Card>

                  );

                })(),

              }))}

            />

          ) : (!error && !isFeedLoading && <div style={{ height: "100%", display: "grid", placeItems: "center" }}><EmptyState text="Записей не найдено." /></div>)

        )}

        {isFeedLoading && <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>Загружено: {loadedCount} из {total}</div>}

        </div>

      </Card>



      <SlidePanel open={drawerOpen} onClose={() => setDrawerOpen(false)}>

        <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>

          <div>

            <div style={{ fontSize: 18, fontWeight: 800 }}>Контекст записи</div>

            <div style={{ fontSize: 12, opacity: 0.72 }}>

              {focusContext?.kind === "audit" ? "Аудит-действие" : focusContext?.kind === "login" ? "История входа" : ""}

            </div>

          </div>

          <Button onClick={() => setDrawerOpen(false)} variant="ghost" size="sm">Закрыть</Button>

        </div>



        <div style={{ padding: 16, display: "grid", gap: 12, alignContent: "start", overflowY: "auto" }}>

          {drawerLoading && <div>Загрузка...</div>}

          {drawerError && <div style={{ color: "#d55" }}>{drawerError}</div>}



          {!drawerLoading && !drawerError && drawerData && (

            <>

              <Card>

                <div style={{ display: "grid", gap: 8 }}>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700 }}>{drawerData.user.email}</div>
                    {user?.email && drawerData.user.email.toLowerCase() === user.email.toLowerCase() && (
                      <RelevanceBadge relevance="self" />
                    )}
                  </div>

                  <UserStatusPills

                    user={drawerData.user.is_approved ? drawerData.user : { ...drawerData.user, role: null }}

                    showBlockedWhenFalse={false}

                  />

                </div>

              </Card>



                                                        {focusContext?.kind === "audit" && (
                <RelatedRecordCard title="Связанное действие (аудит)">
                  <div style={{ fontSize: 13 }}>
                    {(actionCatalog.find((x) => x.action === focusContext.row.action)?.label) || focusContext.row.action}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.82 }}>{formatDate(focusContext.row.created_at)}</div>
                  <div style={{ fontSize: 12, opacity: 0.86 }}>
                    Кто: {actorLabel(focusContext.row.actor_email, user?.email)} → Кому: {targetLabel(focusContext.row.target_email)}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>IP инициатора действия: {ipHint(focusContext.row.ip)}</div>
                  {focusContext.row.meta && typeof focusContext.row.meta.reason === "string" && focusContext.row.meta.reason.trim() && (
                    <div style={{ fontSize: 12, opacity: 0.85 }}>Причина: {focusContext.row.meta.reason}</div>
                  )}
                  {handledAudit[focusContext.row.id] && (
                    <AccentPill tone="success">Помечено как обработанное</AccentPill>
                  )}
                </RelatedRecordCard>
              )}

              {focusContext?.kind === "login" && (
                <RelatedRecordCard title="Связанный вход">
                  <div style={{ fontSize: 13 }}>{focusContext.row.result}{UI_BULLET}{focusContext.row.source}</div>
                  <div style={{ fontSize: 12, opacity: 0.86 }}>
                    Пользователь: {actorLabel(focusContext.row.email, user?.email)}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.82 }}>{formatDate(focusContext.row.created_at)}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>IP клиента входа: {ipHint(focusContext.row.ip)}</div>
                  <div
                    style={{ fontSize: 12, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={focusContext.row.user_agent || "-"}
                  >
                    UA (идентификатор браузера/устройства): {shortUserAgent(focusContext.row.user_agent)}
                  </div>
                  {handledLogin[focusContext.row.id] && (
                    <AccentPill tone="success">Помечено как обработанное</AccentPill>
                  )}
                </RelatedRecordCard>
              )}

              <ContextQuickActions
                items={[
                  ...(focusContext?.kind === "audit"
                    ? [
                        {
                          key: "audit-open-user",
                          label: "Открыть пользователя",
                          variant: "primary" as const,
                          onClick: () => openUserByEmail(focusContext.row.target_email),
                        },
                        {
                          key: "audit-action",
                          label: "Показать похожие действия",
                          variant: "secondary" as const,
                          onClick: () => applyAuditActionFilter(focusContext.row.action),
                        },
                        {
                          key: "audit-ip",
                          label: "Фильтр по этому IP",
                          variant: "ghost" as const,
                          onClick: () => applyLoginIpFilter(focusContext.row.ip),
                        },
                        {
                          key: "audit-handled",
                          label: "Отметить как обработанное",
                          variant: "ghost" as const,
                          onClick: markContextHandled,
                        },
                      ]
                    : []),
                  ...(focusContext?.kind === "login"
                    ? [
                        {
                          key: "login-user-audit",
                          label: "Открыть пользователя",
                          variant: "primary" as const,
                          onClick: () => applyAuditTargetFilter(focusContext.row.email),
                        },
                        {
                          key: "login-ip",
                          label: "Фильтр по этому IP",
                          variant: "secondary" as const,
                          onClick: () => applyLoginIpFilter(focusContext.row.ip),
                        },
                        {
                          key: "login-ip-open",
                          label: "Открыть входы по IP",
                          variant: "ghost" as const,
                          onClick: () => navigate(`/logs?mode=login&ip=${encodeURIComponent(focusContext.row.ip || "")}`),
                          hidden: !focusContext.row.ip,
                        },
                        {
                          key: "login-handled",
                          label: "Отметить как обработанное",
                          variant: "ghost" as const,
                          onClick: markContextHandled,
                        },
                      ]
                    : []),
                ]}
              />






              {!!drawerData?.user?.id && (

                <UserActionPanel
                  availableActions={drawerAvailableActions}

                  actionCatalog={userActionCatalog}

                  trustPolicyCatalog={trustPolicyCatalog}

                  onRunAction={runDrawerUserAction}

                />

              )}



              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>

                <Button variant="secondary" size="sm" onClick={() => openUserByEmail(drawerData.user.email)}>
                  Открыть в Пользователях
                </Button>

              </div>

            </>

          )}

        </div>

      </SlidePanel>

    </div>

  );

}













