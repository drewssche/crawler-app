import type { BaseRole } from "./roles";

export type Permission =
  | "events.view"
  | "audit.view"
  | "users.manage"
  | "root_admins.manage";

const PERMISSIONS_BY_ROLE: Record<BaseRole, Set<Permission>> = {
  viewer: new Set(),
  editor: new Set(),
  admin: new Set(["events.view", "audit.view", "users.manage"]),
  "root-admin": new Set(["events.view", "audit.view", "users.manage", "root_admins.manage"]),
};

export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  const normalized = (role || "").toLowerCase() as BaseRole;
  const rolePermissions = PERMISSIONS_BY_ROLE[normalized] ?? new Set<Permission>();
  return rolePermissions.has(permission);
}

