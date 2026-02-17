import { useEffect, useMemo, useState } from "react";
import { API_BASE, getToken } from "../api/client";
import { apiGet } from "../api/client";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";
import FiltersBar from "../components/ui/FiltersBar";
import Timeline from "../components/ui/Timeline";

type UserItem = {
  id: number;
  email: string;
};

type AuditItem = {
  id: number;
  created_at: string;
  action: string;
  actor_email: string;
  target_email: string;
  ip: string | null;
  meta?: Record<string, unknown> | null;
};

type AuditResponse = {
  items: AuditItem[];
  total: number;
  page: number;
  page_size: number;
};

const ACTION_OPTIONS = [
  "approve",
  "remove_approve",
  "block",
  "unblock",
  "revoke_sessions",
  "revoke_trusted_devices",
  "send_code",
  "set_trust_policy",
  "update_admin_emails",
];

const ACTION_LABELS: Record<string, string> = {
  approve: "Подтвердить доступ",
  remove_approve: "Снять approve",
  block: "Заблокировать",
  unblock: "Разблокировать",
  revoke_sessions: "Отозвать сессии",
  revoke_trusted_devices: "Отозвать доверие",
  send_code: "Выслать код",
  set_trust_policy: "Назначить trust-policy",
  update_admin_emails: "Изменить системных администраторов",
};

export default function ActivityLogPage() {
  const [rows, setRows] = useState<AuditItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [error, setError] = useState("");

  const [action, setAction] = useState("");
  const [actorEmail, setActorEmail] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [securityOnly, setSecurityOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");
  const [showFilters, setShowFilters] = useState(false);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (action.trim()) count += 1;
    if (actorEmail.trim()) count += 1;
    if (targetEmail.trim()) count += 1;
    if (securityOnly) count += 1;
    if (dateFrom) count += 1;
    if (dateTo) count += 1;
    if (sortDir !== "desc") count += 1;
    return count;
  }, [action, actorEmail, targetEmail, securityOnly, dateFrom, dateTo, sortDir]);

  async function loadLogs(nextPage = page, nextPageSize = pageSize) {
    setError("");
    try {
      const params = new URLSearchParams({
        action: action.trim(),
        actor_email: actorEmail.trim(),
        target_email: targetEmail.trim(),
        security_only: String(securityOnly),
        date_from: dateFrom,
        date_to: dateTo,
        sort_dir: sortDir,
        page: String(nextPage),
        page_size: String(nextPageSize),
      });
      const data = await apiGet<AuditResponse>(`/admin/audit?${params.toString()}`);
      setRows(data.items);
      setTotal(data.total);
      setPage(data.page);
      setPageSize(data.page_size);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    loadLogs(1, pageSize);
    apiGet<UserItem[]>("/admin/users?status=all")
      .then(setUsers)
      .catch(() => setUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function formatDate(value: string) {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleString();
  }

  function onApplyFilters() {
    setPage(1);
    loadLogs(1, pageSize);
  }

  function onResetFilters() {
    setAction("");
    setActorEmail("");
    setTargetEmail("");
    setSecurityOnly(false);
    setDateFrom("");
    setDateTo("");
    setSortDir("desc");
    setPage(1);
    setTimeout(() => {
      loadLogs(1, pageSize);
    }, 0);
  }

  function exportFile(ext: "csv" | "xlsx") {
    const token = getToken();
    const params = new URLSearchParams({
      action: action.trim(),
      actor_email: actorEmail.trim(),
      target_email: targetEmail.trim(),
      security_only: String(securityOnly),
      date_from: dateFrom,
      date_to: dateTo,
      sort_dir: sortDir,
    });
    const url = `${API_BASE}/admin/audit/export.${ext}?${params.toString()}`;

    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.blob();
      })
      .then((blob) => {
        const objUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = `admin_audit_logs.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(objUrl);
      })
      .catch((e) => setError(String(e)));
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Журнал действий</h2>
      <p style={{ opacity: 0.8 }}>Фильтруйте события по действию, администратору или целевому пользователю.</p>

      <FiltersBar>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setShowFilters((v) => !v)} style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer" }}>
            {showFilters ? "Скрыть фильтры" : `Фильтры${activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ""}`}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as "csv" | "xlsx")} style={{ padding: "8px 8px", borderRadius: 10 }}>
              <option value="csv">CSV</option>
              <option value="xlsx">XLSX</option>
            </select>
            <button onClick={() => exportFile(exportFormat)} style={{ padding: "8px 12px", borderRadius: 10, cursor: "pointer" }}>Экспорт</button>
          </div>
        </div>

        {showFilters && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <select value={action} onChange={(e) => setAction(e.target.value)} title="Выберите тип действия" style={{ padding: 10, borderRadius: 10 }}>
                <option value="">Все действия</option>
                {ACTION_OPTIONS.map((x) => (
                  <option key={x} value={x}>
                    {ACTION_LABELS[x] ?? x}
                  </option>
                ))}
              </select>

              <input value={actorEmail} onChange={(e) => setActorEmail(e.target.value)} placeholder="Администратор (email)" list="emails-list" style={{ padding: 10, borderRadius: 10 }} />
              <input value={targetEmail} onChange={(e) => setTargetEmail(e.target.value)} placeholder="Пользователь (email)" list="emails-list" style={{ padding: 10, borderRadius: 10 }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 160px auto", gap: 8, alignItems: "center" }}>
              <div style={{ display: "grid", gap: 4 }}>
                <label style={{ fontSize: 12, opacity: 0.8 }}>Дата от (включительно)</label>
                <input type="datetime-local" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ padding: 10, borderRadius: 10 }} title="Дата от (включительно)" />
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                <label style={{ fontSize: 12, opacity: 0.8 }}>Дата до (включительно)</label>
                <input type="datetime-local" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ padding: 10, borderRadius: 10 }} title="Дата до (включительно)" />
              </div>

              <select value={sortDir} onChange={(e) => setSortDir(e.target.value as "desc" | "asc")} style={{ padding: 10, borderRadius: 10 }}>
                <option value="desc">Сначала новые</option>
                <option value="asc">Сначала старые</option>
              </select>

              <label style={{ fontSize: 13, opacity: 0.9 }}>
                <input type="checkbox" checked={securityOnly} onChange={(e) => setSecurityOnly(e.target.checked)} style={{ marginRight: 6 }} />
                Только события безопасности
              </label>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onApplyFilters} style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer" }}>Применить</button>
              <button onClick={onResetFilters} style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer" }}>Сбросить</button>
            </div>
          </div>
        )}
      </FiltersBar>

      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
        Страница {page} из {totalPages} • всего записей: {total}
      </div>

      <datalist id="emails-list">
        {users.map((u) => (
          <option key={u.id} value={u.email} />
        ))}
      </datalist>

      {error && <div style={{ color: "#d55", marginTop: 10 }}>{error}</div>}

      <Card style={{ marginTop: 12, minHeight: 360 }}>
        {rows.length > 0 ? (
          <Timeline
            items={rows.map((a) => ({
              key: a.id,
              content: (
                <Card>
                  <div style={{ fontWeight: 700 }}>{ACTION_LABELS[a.action] ?? a.action}</div>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>{formatDate(a.created_at)}</div>
                  <div style={{ fontSize: 13, opacity: 0.9 }}>{a.actor_email} {" -> "} {a.target_email}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>ip: {a.ip ?? "-"}</div>
                  {a.meta && typeof a.meta.reason === "string" && a.meta.reason.trim() && (
                    <div style={{ fontSize: 12, opacity: 0.85 }}>Причина: {a.meta.reason}</div>
                  )}
                </Card>
              ),
            }))}
          />
        ) : (
          !error && (
            <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
              <EmptyState text="Пока нет событий. Здесь появится лента действий после первых операций." />
            </div>
          )
        )}
      </Card>

      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center", alignItems: "center" }}>
        <button onClick={() => loadLogs(Math.max(1, page - 1), pageSize)} disabled={page <= 1} style={{ padding: "8px 12px", borderRadius: 10, cursor: page <= 1 ? "not-allowed" : "pointer" }}>
          Назад
        </button>
        <select value={pageSize} onChange={(e) => { const next = Number(e.target.value); setPageSize(next); loadLogs(1, next); }} style={{ padding: "8px 10px", borderRadius: 10 }}>
          <option value={20}>20 / стр</option>
          <option value={50}>50 / стр</option>
          <option value={100}>100 / стр</option>
        </select>
        <button onClick={() => loadLogs(Math.min(totalPages, page + 1), pageSize)} disabled={page >= totalPages} style={{ padding: "8px 12px", borderRadius: 10, cursor: page >= totalPages ? "not-allowed" : "pointer" }}>
          Вперед
        </button>
      </div>
    </div>
  );
}
