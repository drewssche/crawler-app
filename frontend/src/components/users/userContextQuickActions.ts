import type { QuickActionItem } from "../ui/ContextQuickActions";

export function buildAuthSecurityQuickActions({
  keyPrefix = "auth",
  ip,
  onRevokeSessions,
  onRevokeTrustedDevices,
  onOpenIpLogins,
  sessionVariant = "secondary",
  trustedVariant = "ghost",
  ipVariant = "ghost",
}: {
  keyPrefix?: string;
  ip?: string | null;
  onRevokeSessions: () => void;
  onRevokeTrustedDevices: () => void;
  onOpenIpLogins: (ip: string) => void;
  sessionVariant?: QuickActionItem["variant"];
  trustedVariant?: QuickActionItem["variant"];
  ipVariant?: QuickActionItem["variant"];
}): QuickActionItem[] {
  const normalizedIp = (ip || "").trim();
  return [
    {
      key: `${keyPrefix}-revoke-sessions`,
      label: "Отозвать сессии",
      variant: sessionVariant,
      onClick: onRevokeSessions,
    },
    {
      key: `${keyPrefix}-revoke-trusted`,
      label: "Отозвать доверенные устройства",
      variant: trustedVariant,
      onClick: onRevokeTrustedDevices,
    },
    {
      key: `${keyPrefix}-open-ip`,
      label: "Открыть входы по IP",
      variant: ipVariant,
      hidden: !normalizedIp,
      onClick: () => onOpenIpLogins(normalizedIp),
    },
  ];
}
