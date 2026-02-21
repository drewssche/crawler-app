import { resolveDisplayRole } from "../../utils/roles";
import AccentPill from "../ui/AccentPill";
import RoleBadge from "../ui/RoleBadge";
import type { TrustPolicyCatalogItem } from "./UserActionPanel";
import { trustPolicyHint, userBadgeMeta, userBadgeStyle } from "./userBadgeCatalog";

type BaseUserStatus = {
  role?: string | null;
  is_root_admin?: boolean | null;
  is_approved?: boolean | null;
  is_blocked?: boolean | null;
  is_deleted?: boolean | null;
};

type TrustPolicy = "strict" | "standard" | "extended" | "permanent";

type StatusBadge = {
  key: string;
  priority: number;
  label: string;
  style: { color: string; bg: string };
  title?: string;
};

function trustStyle(policy: TrustPolicy, catalog?: Record<TrustPolicy, TrustPolicyCatalogItem>) {
  const item = catalog?.[policy];
  if (item) return { color: item.color, bg: item.bg };
  return userBadgeStyle(`trust.${policy}` as const);
}

export function UserStatusPills({
  user,
  showBlockedWhenFalse = false,
  showBlockedForDeleted = false,
  hideRole = false,
  preferPendingBadge = false,
}: {
  user: BaseUserStatus;
  showBlockedWhenFalse?: boolean;
  showBlockedForDeleted?: boolean;
  hideRole?: boolean;
  preferPendingBadge?: boolean;
}) {
  const role = resolveDisplayRole(user);
  const showRole = !hideRole && role !== "не назначена";
  const isDeleted = Boolean(user.is_deleted);

  const badges: StatusBadge[] = [];
  if (!isDeleted && !user.is_approved && preferPendingBadge) {
    const meta = userBadgeMeta("status.pending");
    badges.push({
      key: "status.pending",
      priority: meta.priority,
      label: meta.label,
      style: { color: meta.color, bg: meta.bg },
      title: "Пользователь ожидает подтверждения доступа.",
    });
  }
  if ((!isDeleted && (user.is_blocked || showBlockedWhenFalse)) || (isDeleted && user.is_blocked && showBlockedForDeleted)) {
    const meta = userBadgeMeta("status.blocked");
    badges.push({
      key: "status.blocked",
      priority: meta.priority,
      label: user.is_blocked ? meta.label : "не заблокирован",
      style: { color: meta.color, bg: meta.bg },
      title: user.is_blocked ? "Пользователь заблокирован." : "Пользователь не заблокирован.",
    });
  }
  if (user.is_deleted) {
    const meta = userBadgeMeta("status.deleted");
    badges.push({
      key: "status.deleted",
      priority: meta.priority,
      label: meta.label,
      style: { color: meta.color, bg: meta.bg },
      title: "Учетная запись помечена как удаленная.",
    });
  }
  badges.sort((a, b) => a.priority - b.priority);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {showRole && <RoleBadge role={role} />}
      {badges.map((badge) => (
        <AccentPill key={badge.key} style={badge.style} title={badge.title}>
          {badge.label}
        </AccentPill>
      ))}
    </div>
  );
}

export function UserTrustPills({
  trustPolicy,
  trustPolicyCatalog,
}: {
  trustPolicy: TrustPolicy;
  trustPolicyCatalog?: Record<TrustPolicy, TrustPolicyCatalogItem>;
}) {
  const base = trustStyle(trustPolicy, trustPolicyCatalog);
  const trustMeta = userBadgeMeta(`trust.${trustPolicy}` as const);
  const trustTitle = trustPolicyCatalog?.[trustPolicy]?.description ?? trustPolicyHint(trustPolicy);

  return (
    <div style={{ opacity: 0.85, fontSize: 13, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <AccentPill style={{ background: base.bg, color: base.color }} title={trustTitle}>
        {trustMeta.label}
      </AccentPill>
    </div>
  );
}
