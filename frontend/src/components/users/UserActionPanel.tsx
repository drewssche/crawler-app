import { useEffect, useMemo, useState } from "react";
import Button from "../ui/Button";
import Card from "../ui/Card";
import ConfirmDialog from "../ui/ConfirmDialog";
import RoleBadge from "../ui/RoleBadge";
import UiSelect from "../ui/UiSelect";
import TrustPolicyDetailChips from "./TrustPolicyDetailChips";

export type TrustPolicy = "strict" | "standard" | "extended" | "permanent";
export type UserRole = "viewer" | "editor" | "admin";
export type BulkAction =
  | "approve"
  | "remove_approve"
  | "block"
  | "unblock"
  | "revoke_sessions"
  | "revoke_trusted_devices"
  | "send_code"
  | "set_trust_policy"
  | "set_role"
  | "delete_soft"
  | "restore"
  | "delete_hard";

export type ActionCatalogItem = {
  action: BulkAction;
  label: string;
  critical: boolean;
  details?: string;
  reason_required?: boolean;
  reason_presets?: string[];
  approve_roles?: Record<string, string>;
};

export type TrustPolicyCatalogItem = {
  label: TrustPolicy;
  description: string;
  code_required: string;
  duration: string;
  risk: string;
  color: string;
  bg: string;
};

const ACTION_ICON_FALLBACK: Record<BulkAction, string> = {
  approve: "i",
  remove_approve: "!",
  block: "!",
  unblock: "i",
  revoke_sessions: "!",
  revoke_trusted_devices: "!",
  send_code: "i",
  set_trust_policy: "i",
  set_role: "!",
  delete_soft: "!",
  restore: "i",
  delete_hard: "!",
};

const ROLE_APPROVE_HINT_FALLBACK: Record<UserRole, string> = {
  viewer: "Базовый доступ: просмотр данных без изменений.",
  editor: "Расширенный доступ: просмотр, запуск прогонов, редактирование профилей.",
  admin: "Административный доступ: управление пользователями и настройками.",
};

const ACTION_LABELS: Record<BulkAction, string> = {
  approve: "Подтвердить доступ",
  remove_approve: "Снять подтверждение",
  block: "Заблокировать",
  unblock: "Разблокировать",
  revoke_sessions: "Отозвать сессии",
  revoke_trusted_devices: "Отозвать доверенные устройства",
  send_code: "Выслать код",
  set_trust_policy: "Назначить политику доверия",
  set_role: "Назначить роль",
  delete_soft: "Удалить",
  restore: "Восстановить",
  delete_hard: "Удалить окончательно",
};

const TRUST_POLICY_LABELS: Record<TrustPolicy, string> = {
  strict: "strict (строгое)",
  standard: "standard (стандартное)",
  extended: "extended (расширенное)",
  permanent: "permanent (бессрочное)",
};

function normalizeAvailableActions(actions: BulkAction[]): BulkAction[] {
  const unique = Array.from(new Set(actions));
  const hasRestore = unique.includes("restore");
  return unique.filter((action) => {
    if (action === "delete_soft" && hasRestore) return false;
    if (action === "delete_hard" && !hasRestore) return false;
    return true;
  });
}

function actionLabel(action: BulkAction, fallback?: string) {
  return ACTION_LABELS[action] || fallback || action;
}

export default function UserActionPanel({
  availableActions,
  actionCatalog,
  trustPolicyCatalog,
  onRunAction,
  title = "Действия по пользователю",
  selectedCount = 1,
  applicableCountByAction,
  reasonOptionalPlaceholder = "Причина действия (необязательно, но рекомендуется)",
}: {
  availableActions: BulkAction[];
  actionCatalog: Record<BulkAction, ActionCatalogItem>;
  trustPolicyCatalog: Record<TrustPolicy, TrustPolicyCatalogItem>;
  onRunAction: (payload: { action: BulkAction; role?: UserRole; trust_policy?: TrustPolicy; reason?: string }) => Promise<void>;
  title?: string;
  selectedCount?: number;
  applicableCountByAction?: Partial<Record<BulkAction, number>>;
  reasonOptionalPlaceholder?: string;
}) {
  const [action, setAction] = useState<BulkAction | "">("");
  const [roleForApprove, setRoleForApprove] = useState<UserRole>("viewer");
  const [trustPolicy, setTrustPolicy] = useState<TrustPolicy>("standard");
  const [reason, setReason] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<{
    action: BulkAction;
    role?: UserRole;
    trust_policy?: TrustPolicy;
    reason?: string;
  } | null>(null);

  const filteredAvailableActions = useMemo(() => normalizeAvailableActions(availableActions), [availableActions]);

  const effectiveAction = useMemo(() => {
    if (action && filteredAvailableActions.includes(action)) return action;
    return filteredAvailableActions[0] || "";
  }, [action, filteredAvailableActions]);

  const meta = effectiveAction ? actionCatalog[effectiveAction] : undefined;
  const trustMeta = trustPolicyCatalog[trustPolicy];
  const applicableCount =
    effectiveAction && applicableCountByAction ? (applicableCountByAction[effectiveAction] ?? selectedCount) : selectedCount;
  const hasNoApplicableTargets = selectedCount > 0 && applicableCount === 0;
  const hasPartialApplicability = applicableCount > 0 && applicableCount < selectedCount;

  const roleOptions = useMemo<UserRole[]>(() => {
    const raw = Object.keys(meta?.approve_roles || {});
    const valid = raw.filter((x): x is UserRole => x === "viewer" || x === "editor" || x === "admin");
    if (valid.length > 0) return valid;
    return ["viewer", "editor"];
  }, [meta?.approve_roles]);

  const roleHint = meta?.approve_roles?.[roleForApprove] ?? ROLE_APPROVE_HINT_FALLBACK[roleForApprove];

  useEffect(() => {
    if (!roleOptions.includes(roleForApprove)) {
      setRoleForApprove(roleOptions[0] || "viewer");
    }
  }, [roleForApprove, roleOptions]);

  async function runAction(payload: { action: BulkAction; role?: UserRole; trust_policy?: TrustPolicy; reason?: string }) {
    setError("");
    setRunning(true);
    try {
      await onRunAction(payload);
      setReason("");
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
      setPendingPayload(null);
      setConfirmOpen(false);
    }
  }

  async function submit() {
    if (!effectiveAction) return;
    if (hasNoApplicableTargets) {
      setError("Для выбранного действия нет подходящих пользователей.");
      return;
    }
    if (meta?.reason_required && !reason.trim()) {
      setError("Для этого действия требуется причина.");
      return;
    }
    const payload = {
      action: effectiveAction,
      role: effectiveAction === "approve" || effectiveAction === "set_role" ? roleForApprove : undefined,
      trust_policy: effectiveAction === "set_trust_policy" ? trustPolicy : undefined,
      reason: reason.trim() || undefined,
    };
    if (meta?.critical) {
      setPendingPayload(payload);
      setConfirmOpen(true);
      return;
    }
    await runAction(payload);
  }

  const confirmDescription = effectiveAction ? actionLabel(effectiveAction, meta?.label) : "";

  return (
    <>
      <Card style={{ display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        {filteredAvailableActions.length === 0 ? (
          <div style={{ fontSize: 13, opacity: 0.75 }}>Для пользователя нет доступных действий.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <UiSelect value={effectiveAction} onChange={(e) => setAction(e.target.value as BulkAction)}>
                {filteredAvailableActions.map((a) => (
                  <option key={a} value={a}>{actionLabel(a, actionCatalog[a]?.label)}</option>
                ))}
              </UiSelect>

              {(effectiveAction === "approve" || effectiveAction === "set_role") && (
                <UiSelect value={roleForApprove} onChange={(e) => setRoleForApprove(e.target.value as UserRole)}>
                  {roleOptions.includes("viewer") && <option value="viewer">Роль: наблюдатель</option>}
                  {roleOptions.includes("editor") && <option value="editor">Роль: редактор</option>}
                  {roleOptions.includes("admin") && <option value="admin">Роль: администратор</option>}
                </UiSelect>
              )}

              {effectiveAction === "set_trust_policy" && (
                <UiSelect value={trustPolicy} onChange={(e) => setTrustPolicy(e.target.value as TrustPolicy)}>
                  <option value="strict">{TRUST_POLICY_LABELS.strict}</option>
                  <option value="standard">{TRUST_POLICY_LABELS.standard}</option>
                  <option value="extended">{TRUST_POLICY_LABELS.extended}</option>
                  <option value="permanent">{TRUST_POLICY_LABELS.permanent}</option>
                </UiSelect>
              )}

              <Button variant="primary" onClick={submit} disabled={running || hasNoApplicableTargets}>
                {running ? "Применение..." : "Применить"}
              </Button>
            </div>

            {meta && (
              <Card
                style={{
                  borderColor: meta.critical ? "rgba(243,198,119,0.45)" : "#3333",
                  background: meta.critical ? "rgba(243,198,119,0.08)" : "rgba(255,255,255,0.03)",
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
                    {ACTION_ICON_FALLBACK[effectiveAction] ?? "i"}
                  </div>
                  <div style={{ display: "grid", gap: 4 }}>
                    {effectiveAction === "delete_soft" && (
                      <div style={{ fontSize: 12, opacity: 0.82 }}>Мягкое удаление: пользователя можно восстановить позже.</div>
                    )}
                    {effectiveAction === "delete_hard" && (
                      <div style={{ fontSize: 12, opacity: 0.82 }}>Жесткое удаление: восстановление будет недоступно.</div>
                    )}
                    <div style={{ fontSize: 13, opacity: 0.9 }}>{meta.details || "Описание действия будет добавлено в каталоге."}</div>
                    <div style={{ fontSize: 12, opacity: 0.82 }}>
                      Применится к пользователям: {applicableCount} из {selectedCount}
                    </div>
                    {hasPartialApplicability && (
                      <div style={{ fontSize: 12, opacity: 0.82 }}>
                        Часть выбранных записей будет пропущена: действие применимо только к подходящим.
                      </div>
                    )}
                    {hasNoApplicableTargets && (
                      <div style={{ fontSize: 12, opacity: 0.82, color: "#e7a15a" }}>
                        Действие недоступно для текущей выборки.
                      </div>
                    )}

                    {(effectiveAction === "approve" || effectiveAction === "set_role") && (
                      <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                          <span style={{ opacity: 0.82 }}>
                            {effectiveAction === "approve" ? "Роль при подтверждении:" : "Назначаемая роль:"}
                          </span>
                          <RoleBadge role={roleForApprove} />
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.85 }}>{roleHint}</div>
                      </div>
                    )}

                    {effectiveAction === "set_trust_policy" && trustMeta && (
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
                          <TrustPolicyDetailChips policy={trustMeta} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )}

            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={meta?.reason_required ? "Причина действия (обязательно)" : reasonOptionalPlaceholder}
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8 }}
            />

            {!!meta?.reason_presets?.length && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(meta.reason_presets || []).map((preset) => (
                  <Button key={preset} size="sm" variant="ghost" onClick={() => setReason(preset)} style={{ borderRadius: 999 }}>
                    {preset}
                  </Button>
                ))}
              </div>
            )}

            {error && <div style={{ color: "#e67f7f", fontSize: 12 }}>{error}</div>}
          </>
        )}
      </Card>
      <ConfirmDialog
        open={confirmOpen}
        title="Подтвердите действие"
        description={confirmDescription}
        confirmText="Да"
        cancelText="Нет"
        loading={running}
        onCancel={() => {
          if (running) return;
          setConfirmOpen(false);
          setPendingPayload(null);
        }}
        onConfirm={() => {
          if (!pendingPayload) return;
          void runAction(pendingPayload);
        }}
      />
    </>
  );
}
