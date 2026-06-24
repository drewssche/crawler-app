import type { BaseRole } from "./roles";

export type Permission =
  | "data.view"
  | "crawler.run"
  | "profiles.edit"
  | "events.view"
  | "audit.view"
  | "users.manage"
  | "root_admins.manage";

const PERMISSIONS_BY_ROLE: Record<BaseRole, Set<Permission>> = {
  viewer: new Set(["data.view"]),
  editor: new Set(["data.view", "crawler.run", "profiles.edit"]),
  admin: new Set(["data.view", "crawler.run", "profiles.edit", "events.view", "audit.view", "users.manage"]),
  "root-admin": new Set([
    "data.view",
    "crawler.run",
    "profiles.edit",
    "events.view",
    "audit.view",
    "users.manage",
    "root_admins.manage",
  ]),
};

export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  const raw = (role || "").toLowerCase();
  const normalized = (raw in PERMISSIONS_BY_ROLE ? raw : "viewer") as BaseRole;
  const rolePermissions = PERMISSIONS_BY_ROLE[normalized] ?? new Set<Permission>();
  return rolePermissions.has(permission);
}
