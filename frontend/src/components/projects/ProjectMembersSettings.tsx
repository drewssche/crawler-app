import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addProjectMember,
  deleteProjectMember,
  listProjectMembers,
  updateProjectMemberRole,
  type ProjectMember,
  type ProjectMemberRole,
} from "../../api/projectMembers";
import { ApiError, apiGet, isAbortError } from "../../api/client";
import AccentPill from "../ui/AccentPill";
import Card from "../ui/Card";
import CardActionButton from "../ui/CardActionButton";
import CardFooterActions from "../ui/CardFooterActions";
import ConfirmDialog from "../ui/ConfirmDialog";
import HighlightedText from "../ui/HighlightedText";
import RelevanceBadge from "../ui/RelevanceBadge";
import SectionHeaderRow from "../ui/SectionHeaderRow";
import { MetaText, StatusText } from "../ui/StatusText";
import UiSelect from "../ui/UiSelect";
import { roleBadgeMeta } from "../users/userBadgeCatalog";
import type { DisplayRole } from "../../utils/roles";

const ROLE_OPTIONS: Array<{ value: ProjectMemberRole; label: string; hint: string; tone: "info" | "success" | "neutral" }> = [
  {
    value: "owner",
    label: "Владелец",
    hint: "Может управлять участниками, сайтами, запусками и настройками проекта.",
    tone: "success",
  },
  {
    value: "editor",
    label: "Редактор",
    hint: "Может менять сайты и запускать crawler, но не управляет доступами.",
    tone: "info",
  },
  {
    value: "viewer",
    label: "Наблюдатель",
    hint: "Видит проект, результаты и историю без права менять настройки.",
    tone: "neutral",
  },
];

const roleMeta = Object.fromEntries(ROLE_OPTIONS.map((item) => [item.value, item])) as Record<
  ProjectMemberRole,
  (typeof ROLE_OPTIONS)[number]
>;

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: 10,
  borderRadius: 10,
};

type UserLookupRow = {
  id: number;
  email: string;
  role: string;
  is_approved: boolean;
  is_blocked?: boolean;
  is_deleted?: boolean;
};

function memberErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "user_not_found") return "Пользователь с таким email не найден. Сначала он должен быть зарегистрирован в системе.";
    if (err.code === "last_project_owner") return "В проекте должен оставаться хотя бы один владелец.";
    if (err.code === "project_owner_required") return "Управлять участниками может только владелец проекта.";
    return err.message;
  }
  return err instanceof Error ? err.message : "Не удалось выполнить действие.";
}

function RolePill({ role }: { role: ProjectMemberRole }) {
  const meta = roleMeta[role];
  return (
    <AccentPill tone={meta.tone} title={meta.hint}>
      {meta.label}
    </AccentPill>
  );
}

function systemRoleLabel(role: string | null | undefined): string {
  return roleBadgeMeta((role || "не назначена") as DisplayRole).label;
}

function lookupStatusMeta(user: UserLookupRow, memberEmails: Set<string>): { label: string; tone: "success" | "warning" | "danger" | "neutral"; blocked: boolean } {
  if (memberEmails.has(user.email.toLowerCase())) {
    return { label: "Уже участник", tone: "success", blocked: true };
  }
  if (user.is_deleted) {
    return { label: "Удалён", tone: "danger", blocked: true };
  }
  if (user.is_blocked) {
    return { label: "Заблокирован", tone: "danger", blocked: true };
  }
  if (!user.is_approved) {
    return { label: "Ожидает подтверждения", tone: "warning", blocked: false };
  }
  return { label: "Можно добавить", tone: "neutral", blocked: false };
}

export default function ProjectMembersSettings({ projectId }: { projectId: number }) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectMemberRole>("viewer");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<number | "new" | null>(null);
  const [deleteMember, setDeleteMember] = useState<ProjectMember | null>(null);
  const [userLookupRows, setUserLookupRows] = useState<UserLookupRow[]>([]);
  const [userLookupLoading, setUserLookupLoading] = useState(false);
  const [userLookupTouched, setUserLookupTouched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setMembers(await listProjectMembers(projectId));
    } catch (err) {
      setError(memberErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ownerCount = useMemo(() => members.filter((member) => member.role === "owner").length, [members]);
  const memberEmails = useMemo(() => new Set(members.map((member) => member.email.toLowerCase())), [members]);
  const normalizedEmailInput = email.trim().toLowerCase();
  const selectedLookupUser = useMemo(
    () => userLookupRows.find((row) => row.email.toLowerCase() === normalizedEmailInput) || null,
    [normalizedEmailInput, userLookupRows],
  );
  const selectedLookupStatus = selectedLookupUser ? lookupStatusMeta(selectedLookupUser, memberEmails) : null;
  const userLookupNoMatch = userLookupTouched && normalizedEmailInput.length >= 2 && !userLookupLoading && userLookupRows.length === 0;
  const addBlockedReason = useMemo(() => {
    if (!normalizedEmailInput) return "Укажите email пользователя.";
    if (selectedLookupStatus?.blocked) return selectedLookupStatus.label;
    if (userLookupNoMatch) return "Пользователь не найден.";
    return "";
  }, [normalizedEmailInput, selectedLookupStatus, userLookupNoMatch]);

  useEffect(() => {
    const query = normalizedEmailInput;
    if (query.length < 2) {
      setUserLookupRows([]);
      setUserLookupLoading(false);
      return;
    }

    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setUserLookupLoading(true);
      apiGet<UserLookupRow[]>(`/admin/users?status=all&q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((rows) => {
          if (!active) return;
          setUserLookupRows((rows || []).slice(0, 8));
        })
        .catch((err) => {
          if (isAbortError(err) || !active) return;
          setUserLookupRows([]);
        })
        .finally(() => {
          if (!active) return;
          setUserLookupLoading(false);
        });
    }, 220);

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [normalizedEmailInput]);

  async function handleAdd() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Укажите email пользователя.");
      return;
    }
    if (selectedLookupStatus?.blocked) {
      setError(
        selectedLookupStatus.label === "Уже участник"
          ? "Этот пользователь уже есть в участниках проекта."
          : "Этого пользователя нельзя добавить в проект в текущем состоянии.",
      );
      return;
    }
    setPending("new");
    setError("");
    setMessage("");
    try {
      const saved = await addProjectMember(projectId, { email: normalizedEmail, role });
      setMembers((current) => {
        const exists = current.some((member) => member.id === saved.id);
        return exists ? current.map((member) => member.id === saved.id ? saved : member) : [...current, saved];
      });
      setEmail("");
      setUserLookupRows([]);
      setUserLookupTouched(false);
      setRole("viewer");
      setMessage("Участник добавлен. Доступ применится сразу.");
    } catch (err) {
      setError(memberErrorMessage(err));
    } finally {
      setPending(null);
    }
  }

  async function handleRoleChange(member: ProjectMember, nextRole: ProjectMemberRole) {
    if (member.role === nextRole) return;
    setPending(member.id);
    setError("");
    setMessage("");
    try {
      const saved = await updateProjectMemberRole(projectId, member.id, nextRole);
      setMembers((current) => current.map((item) => item.id === member.id ? saved : item));
      setMessage("Роль участника обновлена.");
    } catch (err) {
      setError(memberErrorMessage(err));
    } finally {
      setPending(null);
    }
  }

  async function handleDelete() {
    if (!deleteMember) return;
    setPending(deleteMember.id);
    setError("");
    setMessage("");
    try {
      await deleteProjectMember(projectId, deleteMember.id);
      setMembers((current) => current.filter((member) => member.id !== deleteMember.id));
      setDeleteMember(null);
      setMessage("Участник удалён из проекта.");
    } catch (err) {
      setError(memberErrorMessage(err));
      setDeleteMember(null);
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <div style={{ display: "grid", gap: 12 }}>
        <SectionHeaderRow
          title={
            <div>
              <div style={{ fontWeight: 700 }}>Участники проекта</div>
              <MetaText opacity={0.68}>Доступ задаётся внутри проекта. Минимум один владелец должен оставаться всегда.</MetaText>
            </div>
          }
          actions={<AccentPill tone="info">{members.length} участник(а)</AccentPill>}
        />

        <Card variant="hint" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ROLE_OPTIONS.map((item) => (
              <AccentPill key={item.value} tone={item.tone} title={item.hint}>
                {item.label}
              </AccentPill>
            ))}
          </div>
          <MetaText opacity={0.72}>
            Владелец управляет доступами. Редактор работает с настройками и запусками. Наблюдатель только смотрит результаты.
          </MetaText>
        </Card>

        {loading && <MetaText>Загрузка участников...</MetaText>}
        {error && <StatusText tone="danger">{error}</StatusText>}
        {message && <StatusText tone="success">{message}</StatusText>}

        <Card variant="hint" style={{ display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 700 }}>Добавить участника</div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(150px, 220px) auto", gap: 8, alignItems: "start" }}>
            <div style={{ position: "relative", display: "grid", gap: 6 }}>
              <input
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setUserLookupTouched(true);
                }}
                onFocus={() => setUserLookupTouched(true)}
                placeholder="Начните вводить email пользователя"
                disabled={pending === "new"}
                role="combobox"
                aria-expanded={userLookupTouched && normalizedEmailInput.length >= 2}
                aria-controls="project-member-user-combobox"
                aria-autocomplete="list"
                style={inputStyle}
              />
              {selectedLookupStatus && (
                <div>
                  <AccentPill tone={selectedLookupStatus.tone} title={selectedLookupStatus.blocked ? "Добавление недоступно для этого состояния." : undefined}>
                    {selectedLookupStatus.label}
                  </AccentPill>
                </div>
              )}
              {userLookupTouched && normalizedEmailInput.length >= 2 && (
                <Card
                  id="project-member-user-combobox"
                  role="listbox"
                  style={{
                    position: "absolute",
                    zIndex: 20,
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    display: "grid",
                    gap: 6,
                    maxHeight: 260,
                    overflowY: "auto",
                    boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
                  }}
                >
                  {userLookupLoading && <MetaText>Ищем пользователя...</MetaText>}
                  {!userLookupLoading && userLookupRows.length === 0 && (
                    <MetaText>Пользователь не найден. Проверьте email или сначала зарегистрируйте пользователя.</MetaText>
                  )}
                  {!userLookupLoading && userLookupRows.map((user) => {
                    const status = lookupStatusMeta(user, memberEmails);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        role="option"
                        onClick={() => {
                          setEmail(user.email);
                          setUserLookupTouched(false);
                        }}
                        style={{
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 10,
                          padding: 10,
                          background: "rgba(255,255,255,0.03)",
                          color: "inherit",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700 }}>
                            <HighlightedText value={user.email} query={email} />
                          </span>
                          <AccentPill tone={status.tone}>{status.label}</AccentPill>
                        </div>
                        <MetaText opacity={0.68}>Системная роль: {systemRoleLabel(user.role)}</MetaText>
                      </button>
                    );
                  })}
                </Card>
              )}
              {selectedLookupUser && !selectedLookupUser.is_approved && !selectedLookupUser.is_blocked && !selectedLookupUser.is_deleted && (
                <StatusText tone="warning" style={{ fontSize: 12 }}>
                  Пользователь ещё ожидает подтверждения. Добавить можно, но полноценно работать с проектом он сможет после подтверждения доступа.
                </StatusText>
              )}
            </div>
            <UiSelect
              value={role}
              disabled={pending === "new"}
              onChange={(event) => setRole(event.target.value as ProjectMemberRole)}
            >
              {ROLE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </UiSelect>
            <CardActionButton
              variant="primary"
              disabled={pending === "new" || Boolean(addBlockedReason)}
              title={addBlockedReason || undefined}
              onClick={() => void handleAdd()}
            >
              {pending === "new" ? "Добавление..." : "Добавить"}
            </CardActionButton>
          </div>
          {userLookupNoMatch && (
            <MetaText opacity={0.72}>
              Не нашли пользователя в системе. Сначала он должен зарегистрироваться или быть создан администратором.
            </MetaText>
          )}
        </Card>

        {!loading && members.map((member) => {
          const isLastOwner = member.role === "owner" && ownerCount <= 1;
          return (
            <Card key={member.id} style={{ display: "grid", gap: 8 }}>
              <SectionHeaderRow
                title={
                  <div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontWeight: 700, wordBreak: "break-word" }}>
                      <span>{member.email}</span>
                      {member.is_current_user && <RelevanceBadge relevance="self" />}
                    </div>
                    <MetaText opacity={0.68}>
                      Системная роль: {systemRoleLabel(member.user_role)}
                      {!member.is_approved ? " · не подтверждён" : ""}
                      {member.is_blocked ? " · заблокирован" : ""}
                    </MetaText>
                  </div>
                }
                actions={<RolePill role={member.role} />}
              />
              <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 220px) auto", gap: 8, alignItems: "center" }}>
                <UiSelect
                  value={member.role}
                  disabled={pending === member.id}
                  title={isLastOwner ? "Последнего владельца нельзя понизить." : undefined}
                  onChange={(event) => void handleRoleChange(member, event.target.value as ProjectMemberRole)}
                >
                  {ROLE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </UiSelect>
                <CardFooterActions>
                  <CardActionButton
                    variant="danger"
                    disabled={pending === member.id || isLastOwner}
                    title={isLastOwner ? "Последнего владельца нельзя удалить." : "Удалить доступ пользователя к проекту."}
                    onClick={() => setDeleteMember(member)}
                  >
                    Удалить доступ
                  </CardActionButton>
                </CardFooterActions>
              </div>
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={Boolean(deleteMember)}
        title="Удалить участника?"
        description={deleteMember ? `${deleteMember.email} потеряет доступ к этому проекту.` : ""}
        confirmText="Удалить доступ"
        confirmVariant="danger"
        loading={deleteMember ? pending === deleteMember.id : false}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (deleteMember && pending === deleteMember.id) return;
          setDeleteMember(null);
        }}
      />
    </Card>
  );
}
