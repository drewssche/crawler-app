export type BaseRole = "root-admin" | "admin" | "editor" | "viewer";
export type DisplayRole = BaseRole | "не назначена" | string;

export type RoleSource = {
  role?: string | null;
  is_root_admin?: boolean | null;
  is_approved?: boolean | null;
};

export function resolveDisplayRole(source: RoleSource): DisplayRole {
  if (source.is_root_admin) return "root-admin";
  if (source.is_approved === false) return "не назначена";
  const role = (source.role || "").trim().toLowerCase();
  if (!role) return "не назначена";
  return role;
}
