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

function trustStatusLabel(value: number | null) {
  if (value === null) return null;
  if (value < 0) return "бессрочно";
  if (value <= 3) return "истекает скоро";
  return "активно";
}

function trustStatusStyle(value: number | null) {
  if (value === null) return { color: "#9ea7b3", bg: "rgba(158,167,179,0.14)" };
  if (value < 0) return userBadgeStyle("time.device.permanent");
  if (value <= 0) return userBadgeStyle("time.device.expired");
  if (value <= 3) return userBadgeStyle("time.device.soon");
  return userBadgeStyle("time.device.ok");
}

export function UserStatusPills({
  user,
  showApproveWhenTrue = true,
  showApproveWhenFalse = false,
  showBlockedWhenFalse = false,
  showBlockedForDeleted = false,
  hideRole = false,
  preferPendingBadge = false,
}: {
  user: BaseUserStatus;
  showApproveWhenTrue?: boolean;
  showApproveWhenFalse?: boolean;
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
  } else if (!isDeleted && ((user.is_approved && showApproveWhenTrue) || (!user.is_approved && showApproveWhenFalse))) {
    const meta = userBadgeMeta("status.approve");
    badges.push({
      key: "status.approve",
      priority: meta.priority,
      label: `${meta.label}: ${user.is_approved ? "да" : "нет"}`,
      style: { color: meta.color, bg: meta.bg },
      title: user.is_approved ? "Доступ пользователя подтвержден." : "Доступ пользователя еще не подтвержден.",
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
  trustedDaysLeft,
  trustPolicyCatalog,
  hideNotConfigured = true,
  showExpires = true,
  showDeviceStatus = true,
}: {
  trustPolicy: TrustPolicy;
  trustedDaysLeft: number | null;
  trustPolicyCatalog?: Record<TrustPolicy, TrustPolicyCatalogItem>;
  hideNotConfigured?: boolean;
  showExpires?: boolean;
  showDeviceStatus?: boolean;
}) {
  const base = trustStyle(trustPolicy, trustPolicyCatalog);
  const status = trustStatusLabel(trustedDaysLeft);
  const statusStyle = trustStatusStyle(trustedDaysLeft);

  const trustMeta = userBadgeMeta(`trust.${trustPolicy}` as const);
  const expiresMeta = userBadgeMeta("time.expires");
  const hasFiniteExpiry = trustedDaysLeft !== null && trustedDaysLeft >= 0;
  const deviceMeta = userBadgeMeta(
    trustedDaysLeft === null
      ? "time.device.ok"
      : trustedDaysLeft < 0
        ? "time.device.permanent"
        : trustedDaysLeft <= 0
          ? "time.device.expired"
          : trustedDaysLeft <= 3
            ? "time.device.soon"
            : "time.device.ok",
  );
  const trustTitle = trustPolicyCatalog?.[trustPolicy]?.description ?? trustPolicyHint(trustPolicy);
  const showExpiresBadge = showExpires && ((!hideNotConfigured && trustedDaysLeft === null) || hasFiniteExpiry);

  return (
    <div style={{ opacity: 0.85, fontSize: 13, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <AccentPill style={{ background: base.bg, color: base.color }} title={trustTitle}>
        {trustMeta.label}
      </AccentPill>
      {showExpiresBadge && (
        <AccentPill
          style={{ background: expiresMeta.bg, color: expiresMeta.color }}
          title={trustedDaysLeft === null ? "Срок доверия для устройства не настроен." : `Осталось: ${trustedDaysLeft} дн.`}
        >
          {expiresMeta.label}: {trustedDaysLeft === null ? "не настроено" : `${trustedDaysLeft} дн.`}
        </AccentPill>
      )}
      {showDeviceStatus && status && (
        <AccentPill style={{ background: statusStyle.bg, color: statusStyle.color }} title="Состояние доверенного устройства по сроку действия.">
          {deviceMeta.label}: {status}
        </AccentPill>
      )}
    </div>
  );
}
