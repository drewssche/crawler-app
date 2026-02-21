import type { DisplayRole } from "../../utils/roles";
import type { RelevanceKind } from "../../utils/relevance";

export type UserBadgeKey =
  | "role.viewer"
  | "role.editor"
  | "role.admin"
  | "role.root-admin"
  | "relevance.self"
  | "relevance.selected"
  | "status.blocked"
  | "status.deleted"
  | "status.pending"
  | "trust.standard"
  | "trust.strict"
  | "trust.extended"
  | "trust.permanent";

export type UserBadgeStyle = {
  color: string;
  bg: string;
};

export type UserBadgeMeta = UserBadgeStyle & {
  label: string;
  priority: number;
};

export type TrustPolicyKey = "strict" | "standard" | "extended" | "permanent";

const USER_BADGE_CATALOG: Record<UserBadgeKey, UserBadgeMeta> = {
  // identity-group: роли/идентичность в одном "холодном" спектре, но с явной градацией по уровню.
  "role.viewer": { label: "Наблюдатель", priority: 1, color: "#59c2ff", bg: "rgba(89,194,255,0.16)" },
  "role.editor": { label: "Редактор", priority: 1, color: "#56bfd8", bg: "rgba(86,191,216,0.16)" },
  "role.admin": { label: "Администратор", priority: 1, color: "#7d7dff", bg: "rgba(125,125,255,0.16)" },
  "role.root-admin": { label: "Root-admin", priority: 1, color: "#f08a7a", bg: "rgba(240,138,122,0.16)" },
  "relevance.self": { label: "Вы", priority: 2, color: "#78a6ff", bg: "rgba(120,166,255,0.14)" },
  "relevance.selected": { label: "Выбранный пользователь", priority: 2, color: "#9ea7b3", bg: "rgba(158,167,179,0.14)" },
  // status-group: доступ/блок/удаление.
  "status.blocked": { label: "заблокирован", priority: 10, color: "#e67f7f", bg: "rgba(230,127,127,0.14)" },
  "status.deleted": { label: "удалён", priority: 5, color: "#f0a85e", bg: "rgba(240,168,94,0.14)" },
  "status.pending": { label: "ожидает подтверждения", priority: 30, color: "#d8b05d", bg: "rgba(216,176,93,0.18)" },
  // trust-group: политика доверия/устройство в фиолетовом диапазоне.
  "trust.standard": { label: "доверие: стандарт", priority: 40, color: "#9f8bff", bg: "rgba(159,139,255,0.16)" },
  "trust.strict": { label: "доверие: строгое", priority: 40, color: "#ac8fff", bg: "rgba(172,143,255,0.16)" },
  "trust.extended": { label: "доверие: расширенное", priority: 40, color: "#b68ef0", bg: "rgba(182,142,240,0.15)" },
  "trust.permanent": { label: "доверие: бессрочное", priority: 40, color: "#a983f4", bg: "rgba(169,131,244,0.16)" },
};

const TRUST_POLICY_HINTS: Record<TrustPolicyKey, string> = {
  strict: "Код подтверждения запрашивается на каждый вход.",
  standard: "Стандартный баланс: доверие к устройству примерно на 30 дней.",
  extended: "Расширенное доверие к устройству, код запрашивается реже.",
  permanent: "Бессрочное доверие к устройству без автоматического истечения.",
};

const ROLE_HINTS: Record<DisplayRole, string> = {
  viewer: "Может только просматривать данные.",
  editor: "Может просматривать и вносить изменения в рабочие сущности.",
  admin: "Административный доступ к управлению пользователями и настройками.",
  "root-admin": "Полный системный доступ, включая управление списком системных администраторов.",
  "не назначена": "Роль не назначена, права ограничены.",
};

export function userBadgeStyle(key: UserBadgeKey): UserBadgeStyle {
  return USER_BADGE_CATALOG[key];
}

export function userBadgeMeta(key: UserBadgeKey): UserBadgeMeta {
  return USER_BADGE_CATALOG[key];
}

export function roleBadgeMeta(role: DisplayRole): UserBadgeMeta {
  if (role === "viewer") return USER_BADGE_CATALOG["role.viewer"];
  if (role === "editor") return USER_BADGE_CATALOG["role.editor"];
  if (role === "admin") return USER_BADGE_CATALOG["role.admin"];
  if (role === "root-admin") return USER_BADGE_CATALOG["role.root-admin"];
  const normalized = String(role ?? "").trim();
  const fallbackLabel = normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : "Роль не определена";
  return { label: fallbackLabel, priority: 1, color: "#9ea7b3", bg: "rgba(158,167,179,0.14)" };
}

export function relevanceBadgeMeta(relevance: RelevanceKind): UserBadgeMeta | null {
  if (relevance === "self") return USER_BADGE_CATALOG["relevance.self"];
  if (relevance === "selected") return USER_BADGE_CATALOG["relevance.selected"];
  return null;
}

export function roleBadgeHint(role: DisplayRole): string {
  return ROLE_HINTS[role] ?? "Роль пользователя в системе.";
}

export function trustPolicyHint(policy: TrustPolicyKey): string {
  return TRUST_POLICY_HINTS[policy] ?? "Политика доверия устройства.";
}
