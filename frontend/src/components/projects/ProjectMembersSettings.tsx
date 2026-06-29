import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addProjectMember,
  deleteProjectMember,
  listProjectMembers,
  updateProjectMemberRole,
  type ProjectMember,
  type ProjectMemberRole,
} from "../../api/projectMembers";
import { ApiError } from "../../api/client";
import AccentPill from "../ui/AccentPill";
import Card from "../ui/Card";
import CardActionButton from "../ui/CardActionButton";
import CardFooterActions from "../ui/CardFooterActions";
import ConfirmDialog from "../ui/ConfirmDialog";
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

export default function ProjectMembersSettings({ projectId }: { projectId: number }) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectMemberRole>("viewer");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<number | "new" | null>(null);
  const [deleteMember, setDeleteMember] = useState<ProjectMember | null>(null);

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

  async function handleAdd() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Укажите email пользователя.");
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
          <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(150px, 220px) auto", gap: 8, alignItems: "center" }}>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="email пользователя"
              disabled={pending === "new"}
              style={inputStyle}
            />
            <UiSelect
              value={role}
              disabled={pending === "new"}
              onChange={(event) => setRole(event.target.value as ProjectMemberRole)}
            >
              {ROLE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </UiSelect>
            <CardActionButton variant="primary" disabled={pending === "new"} onClick={() => void handleAdd()}>
              {pending === "new" ? "Добавление..." : "Добавить"}
            </CardActionButton>
          </div>
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
