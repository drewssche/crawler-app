import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import AccentPill from "../components/ui/AccentPill";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";
import RoleBadge from "../components/ui/RoleBadge";
import { resolveDisplayRole } from "../utils/roles";

type TrustPolicy = "strict" | "standard" | "extended" | "permanent";

type UserItem = {
  id: number;
  email: string;
  role: "admin" | "editor" | "viewer" | string;
  is_root_admin?: boolean;
  pending_requested_at?: string | null;
  is_approved: boolean;
  is_admin: boolean;
  is_blocked: boolean;
  trust_policy: TrustPolicy;
  trusted_days_left: number | null;
};

type Tab = "all" | "pending" | "approved";

type BulkAction =
  | "approve"
  | "remove_approve"
  | "block"
  | "unblock"
  | "revoke_sessions"
  | "revoke_trusted_devices"
  | "send_code"
  | "set_trust_policy";

const TRUST_HINTS: Record<TrustPolicy, string> = {
  strict: "Код при каждом входе.",
  standard: "Доверие 30 дней.",
  extended: "Доверие 90 дней.",
  permanent: "Бессрочное доверие.",
};

const TRUST_POLICY_META: Record<TrustPolicy, { label: string; color: string; bg: string; codeRequired: string; duration: string; risk: string }> = {
  strict: {
    label: "strict",
    color: "#f0a85e",
    bg: "rgba(240,168,94,0.14)",
    codeRequired: "Да, на каждый вход",
    duration: "0 дней",
    risk: "Минимальный риск",
  },
  standard: {
    label: "standard",
    color: "#64a8c9",
    bg: "rgba(100,168,201,0.16)",
    codeRequired: "Только при новом устройстве",
    duration: "30 дней",
    risk: "Сбалансированно",
  },
  extended: {
    label: "extended",
    color: "#56bfd1",
    bg: "rgba(86,191,209,0.14)",
    codeRequired: "Только при новом устройстве",
    duration: "90 дней",
    risk: "Выше standard",
  },
  permanent: {
    label: "permanent",
    color: "#e67f7f",
    bg: "rgba(230,127,127,0.14)",
    codeRequired: "Только при первом входе",
    duration: "Бессрочно",
    risk: "Повышенный риск",
  },
};

const ACTION_LABELS: Record<BulkAction, string> = {
  approve: "Подтвердить доступ",
  remove_approve: "Снять approve",
  block: "Заблокировать",
  unblock: "Разблокировать",
  revoke_sessions: "Отозвать сессии",
  revoke_trusted_devices: "Отозвать доверие",
  send_code: "Выслать код",
  set_trust_policy: "Назначить trust-policy",
};

const CRITICAL_ACTIONS = new Set<BulkAction>(["block", "remove_approve", "revoke_sessions", "revoke_trusted_devices"]);

const ACTION_HINTS: Record<BulkAction, { icon: string; title: string; details: string; impact: string }> = {
  approve: {
    icon: "i",
    title: "Подтверждение доступа",
    details: "Пользователь получит доступ к системе с указанной ролью.",
    impact: "Используйте для новых запросов доступа.",
  },
  remove_approve: {
    icon: "!",
    title: "Снятие approve",
    details: "Пользователь больше не сможет входить, пока не будет одобрен снова.",
    impact: "Критичное действие для временного отключения доступа.",
  },
  block: {
    icon: "!",
    title: "Блокировка",
    details: "Вход блокируется, активные сессии будут отозваны.",
    impact: "Критичное действие. Применяйте при подозрительной активности.",
  },
  unblock: {
    icon: "i",
    title: "Разблокировка",
    details: "Снимает блок входа.",
    impact: "Используйте после проверки и подтверждения пользователя.",
  },
  revoke_sessions: {
    icon: "!",
    title: "Отзыв сессий",
    details: "Все текущие JWT-сессии (токены входа) будут завершены и станут недействительными.",
    impact: "Критичное действие. Пользователь войдет заново.",
  },
  revoke_trusted_devices: {
    icon: "!",
    title: "Отзыв доверия",
    details: "Удаляются доверенные устройства, потребуется код при следующем входе.",
    impact: "Критичное действие для сброса доверенного входа.",
  },
  send_code: {
    icon: "i",
    title: "Отправка кода",
    details: "Одноразовый код входа отправляется на email пользователя.",
    impact: "Используйте для оперативной помощи пользователю с входом.",
  },
  set_trust_policy: {
    icon: "i",
    title: "Настройка trust-policy",
    details: "Меняет политику доверенных устройств для выбранных пользователей.",
    impact: "Влияет на частоту ввода кода и срок доверия устройства.",
  },
};

function ActionHintCard({
  action,
  critical,
  selectedCount,
  trustPolicy,
}: {
  action: BulkAction;
  critical: boolean;
  selectedCount: number;
  trustPolicy: TrustPolicy;
}) {
  const hint = ACTION_HINTS[action];
  const trustMeta = TRUST_POLICY_META[trustPolicy];
  return (
    <Card
      style={{
        borderColor: critical ? "rgba(243,198,119,0.45)" : "#3333",
        background: critical ? "rgba(243,198,119,0.08)" : "rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: 10, alignItems: "start" }}>
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
            border: "1px solid #3333",
            fontSize: 12,
          }}
        >
          {hint.icon}
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <div>
            <AccentPill tone={critical ? "warning" : "info"}>Действие: {hint.title}</AccentPill>
          </div>
          <div style={{ fontWeight: 700 }}>{hint.title}</div>
          <div style={{ fontSize: 13, opacity: 0.9 }}>{hint.details}</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{hint.impact}</div>
          <div style={{ fontSize: 12, opacity: 0.82 }}>Применится к выбранным пользователям: {selectedCount}</div>
          {action === "set_trust_policy" && (
            <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: trustMeta.bg,
                  color: trustMeta.color,
                  border: `1px solid ${trustMeta.color}55`,
                  borderRadius: 999,
                  padding: "4px 10px",
                  width: "fit-content",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                Текущая политика: {trustMeta.label}
              </div>
              <div style={{ fontSize: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                <AccentPill style={{ background: trustMeta.bg, color: trustMeta.color, padding: "3px 8px", borderRadius: 8 }}>
                  Код: {trustMeta.codeRequired}
                </AccentPill>
                <AccentPill style={{ background: trustMeta.bg, color: trustMeta.color, padding: "3px 8px", borderRadius: 8 }}>
                  Срок доверия: {trustMeta.duration}
                </AccentPill>
                <AccentPill style={{ background: trustMeta.bg, color: trustMeta.color, padding: "3px 8px", borderRadius: 8 }}>
                  Риск: {trustMeta.risk}
                </AccentPill>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function YesMark() {
  return <span style={{ color: "#6ec7b5", fontWeight: 700, fontSize: 16, lineHeight: 1 }}>✓</span>;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [action, setAction] = useState<BulkAction>("approve");
  const [roleForApprove, setRoleForApprove] = useState<"viewer" | "editor">("viewer");
  const [trustPolicy, setTrustPolicy] = useState<TrustPolicy>("standard");
  const [reason, setReason] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);

  async function loadUsers(nextTab = tab, nextQuery = query) {
    setError("");
    try {
      const q = encodeURIComponent(nextQuery.trim());
      const data = await apiGet<UserItem[]>(`/admin/users?status=${nextTab}&q=${q}`);
      setUsers(data);
      setSelected([]);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const selectedUsers = useMemo(() => users.filter((u) => selected.includes(u.id)), [users, selected]);
  const selectedNonAdmin = useMemo(() => selectedUsers.filter((u) => !u.is_admin), [selectedUsers]);

  const availableActions = useMemo(() => {
    const actions: BulkAction[] = [];
    if (selectedNonAdmin.some((u) => !u.is_approved)) actions.push("approve");
    if (selectedNonAdmin.some((u) => u.is_approved)) actions.push("remove_approve");
    if (selectedNonAdmin.some((u) => !u.is_blocked)) actions.push("block");
    if (selectedNonAdmin.some((u) => u.is_blocked)) actions.push("unblock");
    if (selectedNonAdmin.length > 0) actions.push("revoke_sessions");
    if (selectedNonAdmin.length > 0) actions.push("revoke_trusted_devices");
    if (selectedNonAdmin.some((u) => u.is_approved && !u.is_blocked)) actions.push("send_code");
    if (selectedNonAdmin.length > 0) actions.push("set_trust_policy");
    return actions;
  }, [selectedNonAdmin]);

  useEffect(() => {
    if (availableActions.length === 0) return;
    if (!availableActions.includes(action)) {
      setAction(availableActions[0]);
    }
  }, [availableActions, action]);

  const visibleIds = useMemo(() => users.map((u) => u.id), [users]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));

  function toggleOne(userId: number) {
    setSelected((prev) => (prev.includes(userId) ? prev.filter((x) => x !== userId) : [...prev, userId]));
  }

  function toggleAll() {
    setSelected(allSelected ? [] : visibleIds);
  }

  async function executeBulkAction() {
    setError("");
    setMessage("");

    if (selected.length === 0) {
      setError("Сначала выберите пользователей в списке.");
      return;
    }

    try {
      await apiPost("/admin/users/bulk", {
        user_ids: selected,
        action,
        role: action === "approve" ? roleForApprove : undefined,
        trust_policy: action === "set_trust_policy" ? trustPolicy : undefined,
        reason: reason.trim() || undefined,
      });

      setMessage(`Выполнено: ${ACTION_LABELS[action]}.`);
      setReason("");
      await loadUsers();
    } catch (e) {
      setError(String(e));
    }
  }

  function onApplyAction() {
    if (CRITICAL_ACTIONS.has(action)) {
      setConfirmOpen(true);
      return;
    }
    executeBulkAction();
  }

  async function quickApprove(userId: number, role: "viewer" | "editor") {
    setError("");
    setMessage("");
    try {
      await apiPost("/admin/users/bulk", {
        user_ids: [userId],
        action: "approve",
        role,
      });
      setMessage(`Пользователь одобрен как ${role}.`);
      await loadUsers();
    } catch (e) {
      setError(String(e));
    }
  }

  function formatDaysLeft(value: number | null) {
    if (value === null) return "не настроено";
    if (value < 0) return "бессрочно";
    return `${value} дн.`;
  }

  function trustStatusColor(value: number | null, policy: TrustPolicy) {
    if (value === null) return { color: "#9ea7b3", bg: "rgba(158,167,179,0.14)" };
    if (value < 0) return TRUST_POLICY_META.permanent;
    if (value <= 3) return { color: "#e67f7f", bg: "rgba(230,127,127,0.14)" };
    return { color: TRUST_POLICY_META[policy].color, bg: TRUST_POLICY_META[policy].bg };
  }

  function trustDeviceStatus(value: number | null) {
    if (value === null) return "не настроено";
    if (value < 0) return "бессрочно";
    if (value <= 3) return "истекает скоро";
    return "активно";
  }

  function tabStyle(active: boolean) {
    return {
      padding: "8px 10px",
      borderRadius: 10,
      cursor: "pointer",
      border: active ? "1px solid #6aa0ff" : "1px solid #3333",
      background: active ? "rgba(106,160,255,0.12)" : "transparent",
      fontWeight: active ? 700 : 500,
    };
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Пользователи</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setTab("all")} style={tabStyle(tab === "all")}>Все</button>
        <button onClick={() => setTab("pending")} style={tabStyle(tab === "pending")}>Запросившие</button>
        <button onClick={() => setTab("approved")} style={tabStyle(tab === "approved")}>Активные</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по email"
          style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
        />
        <button onClick={() => loadUsers(tab, query)} style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer" }}>
          Найти
        </button>
      </div>

      {error && <div style={{ color: "#d55", marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ color: "#8fd18f", marginBottom: 10 }}>{message}</div>}

      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", opacity: 0.8 }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              title="Выбрать всех пользователей в текущем списке"
            />
            <div style={{ fontSize: 13 }}>Список пользователей</div>
            <div style={{ fontSize: 13 }}>Выбрано: {selected.length}</div>
          </div>

          {users.map((u) => {
            const showQuickApprove = tab === "pending" && !u.is_approved && !u.is_admin && hoveredId === u.id;
            return (
              <Card
                key={u.id}
                style={{ padding: 12 }}
              >
                <div
                  onMouseEnter={() => setHoveredId(u.id)}
                  onMouseLeave={() => setHoveredId((prev) => (prev === u.id ? null : prev))}
                  style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center" }}
                >
                  <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggleOne(u.id)} />
                  <div>
                    <div style={{ fontWeight: 700 }}>{u.email}</div>
                    <div style={{ opacity: 0.9, fontSize: 13, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4 }}>
                      <RoleBadge role={resolveDisplayRole(u)} />
                      <AccentPill style={u.is_approved ? { background: "rgba(82,201,122,0.2)", color: "#69db93" } : undefined} tone={u.is_approved ? "success" : "neutral"}>
                        approve: {u.is_approved ? "да" : "нет"}
                      </AccentPill>
                      <AccentPill tone={u.is_blocked ? "danger" : "neutral"}>blocked: {u.is_blocked ? "да" : "нет"}</AccentPill>
                    </div>
                    <div style={{ opacity: 0.85, fontSize: 13, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 6 }} title={TRUST_HINTS[u.trust_policy] ?? "Политика доверия"}>
                      <AccentPill style={{ background: TRUST_POLICY_META[u.trust_policy].bg, color: TRUST_POLICY_META[u.trust_policy].color }}>
                        trust: {u.trust_policy}
                      </AccentPill>
                      <AccentPill style={{ background: trustStatusColor(u.trusted_days_left, u.trust_policy).bg, color: trustStatusColor(u.trusted_days_left, u.trust_policy).color }}>
                        до истечения: {formatDaysLeft(u.trusted_days_left)}
                      </AccentPill>
                      <AccentPill style={{ background: trustStatusColor(u.trusted_days_left, u.trust_policy).bg, color: trustStatusColor(u.trusted_days_left, u.trust_policy).color }}>
                        статус устройства: {trustDeviceStatus(u.trusted_days_left)}
                      </AccentPill>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {showQuickApprove && (
                      <>
                        <button onClick={() => quickApprove(u.id, "viewer")} style={{ padding: "6px 8px", borderRadius: 8, cursor: "pointer" }}>
                          Одобрить как viewer
                        </button>
                        <button onClick={() => quickApprove(u.id, "editor")} style={{ padding: "6px 8px", borderRadius: 8, cursor: "pointer" }}>
                          Одобрить как editor
                        </button>
                      </>
                    )}
                    {u.is_root_admin && <RoleBadge role="root-admin" />}
                  </div>
                </div>
              </Card>
            );
          })}

          {users.length === 0 && <EmptyState text="Пользователи не найдены." />}
        </div>
      </Card>

      {selected.length > 0 && (
        <Card style={{ marginBottom: 18, maxHeight: "42vh", overflowY: "auto", overflowX: "hidden" }}>
          <div style={{ display: "grid", gap: 10, minHeight: 0 }}>
            <div style={{ fontWeight: 700 }}>Действия для выбранных пользователей</div>

            {availableActions.length > 0 ? (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select value={action} onChange={(e) => setAction(e.target.value as BulkAction)} style={{ padding: "8px 10px", borderRadius: 10 }}>
                    {availableActions.map((key) => (
                      <option key={key} value={key}>
                        {ACTION_LABELS[key]}
                      </option>
                    ))}
                  </select>

                  {action === "approve" && (
                    <select value={roleForApprove} onChange={(e) => setRoleForApprove(e.target.value as "viewer" | "editor")} style={{ padding: "8px 10px", borderRadius: 10 }}>
                      <option value="viewer">Роль: viewer</option>
                      <option value="editor">Роль: editor</option>
                    </select>
                  )}

                  {action === "set_trust_policy" && (
                    <select value={trustPolicy} onChange={(e) => setTrustPolicy(e.target.value as TrustPolicy)} style={{ padding: "8px 10px", borderRadius: 10 }}>
                      <option value="strict">strict</option>
                      <option value="standard">standard</option>
                      <option value="extended">extended</option>
                      <option value="permanent">permanent</option>
                    </select>
                  )}

                  <button onClick={onApplyAction} style={{ padding: "8px 12px", borderRadius: 10, cursor: "pointer" }}>
                    Применить
                  </button>
                </div>

                <ActionHintCard
                  action={action}
                  critical={CRITICAL_ACTIONS.has(action)}
                  selectedCount={selectedNonAdmin.length}
                  trustPolicy={trustPolicy}
                />

                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Причина действия (необязательно, но рекомендуется)"
                  style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
                />

                {selectedUsers.some((u) => u.is_admin) && (
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    В выборке есть admin. Неприменимые операции для admin будут пропущены на backend.
                  </div>
                )}
              </>
            ) : (
              <EmptyState text="Для текущего набора выбранных пользователей нет доступных действий." />
            )}
          </div>
        </Card>
      )}

      <Card style={{ borderColor: "rgba(120,166,255,0.5)", background: "rgba(120,166,255,0.06)" }}>
        <button
          onClick={() => setRolesOpen((v) => !v)}
          style={{
            display: "flex",
            justifyContent: "flex-start",
            alignItems: "center",
            gap: 8,
            border: "none",
            background: "transparent",
            color: "inherit",
            padding: 0,
            cursor: "pointer",
          }}
          title="Нажмите, чтобы свернуть или развернуть раздел ролей"
        >
          <h3 style={{ margin: 0 }}>Роли и права</h3>
          <AccentPill tone="info">Справка</AccentPill>
          <span style={{ fontSize: 12, opacity: 0.8 }}>{rolesOpen ? "Свернуть" : "Развернуть"}</span>
        </button>
        {!rolesOpen && <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>Раздел свернут. Нажмите заголовок, чтобы открыть.</div>}
        {rolesOpen && (
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #3333" }}>Возможность</th>
                  <th style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}><RoleBadge role="viewer" /></th>
                  <th style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}><RoleBadge role="editor" /></th>
                  <th style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}><RoleBadge role="admin" /></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #3333" }}>Просмотр данных</td>
                  <td style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}><YesMark /></td>
                  <td style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}><YesMark /></td>
                  <td style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}><YesMark /></td>
                </tr>
                <tr>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #3333" }}>Запуск прогонов</td>
                  <td style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}>—</td>
                  <td style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}><YesMark /></td>
                  <td style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}><YesMark /></td>
                </tr>
                <tr>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #3333" }}>Редактирование профилей</td>
                  <td style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}>—</td>
                  <td style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}><YesMark /></td>
                  <td style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}><YesMark /></td>
                </tr>
                <tr>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #3333" }}>Управление пользователями</td>
                  <td style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}>—</td>
                  <td style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}>—</td>
                  <td style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}><YesMark /></td>
                </tr>
                <tr>
                  <td style={{ padding: "8px 6px" }}>Управление системными администраторами</td>
                  <td style={{ textAlign: "center", padding: "8px 6px" }}>—</td>
                  <td style={{ textAlign: "center", padding: "8px 6px" }}>—</td>
                  <td style={{ textAlign: "center", padding: "8px 6px" }}><RoleBadge role="root-admin" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {confirmOpen && (
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
          <Card style={{ width: 480, maxWidth: "92vw", padding: 14, background: "#1a1a1a", borderColor: "rgba(243,198,119,0.45)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <AccentPill tone="warning">Критичное действие</AccentPill>
              <h3 style={{ margin: 0 }}>Подтвердите действие</h3>
            </div>
            <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
              <div>
                Действие: <b>{ACTION_LABELS[action]}</b>
              </div>
              <div>Выбрано пользователей: {selectedUsers.length}</div>
              <div>Будет обработано (без admin): {selectedNonAdmin.length}</div>
              <div>Будет пропущено admin: {Math.max(0, selectedUsers.length - selectedNonAdmin.length)}</div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.78, marginTop: 10 }}>
              После подтверждения изменение будет записано в журнал действий.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={() => setConfirmOpen(false)} style={{ padding: "8px 12px", borderRadius: 10, cursor: "pointer" }}>
                Отмена
              </button>
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  executeBulkAction();
                }}
                style={{ padding: "8px 12px", borderRadius: 10, cursor: "pointer", borderColor: "rgba(243,198,119,0.55)" }}
              >
                Подтвердить действие
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}



