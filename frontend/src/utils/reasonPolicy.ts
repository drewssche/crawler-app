export type ReasonMode = "required" | "recommended" | "optional";

type ReasonMetaLike = {
  reason_required?: boolean;
  reason_mode?: ReasonMode;
};

export const ADMIN_EMAILS_REASON_MODE: ReasonMode = "required";
export type AdminEmailsReasonPolicy = {
  add_root_admin: ReasonMode;
  remove_other_root_admin: ReasonMode;
  no_effect: ReasonMode;
};

export type AdminEmailsReasonScenario = keyof AdminEmailsReasonPolicy;

export type AdminEmailsReasonContract = {
  modes: AdminEmailsReasonPolicy;
  presets: Record<AdminEmailsReasonScenario, string[]>;
  hints: Record<ReasonMode, string>;
};

export const DEFAULT_ADMIN_EMAILS_REASON_POLICY: AdminEmailsReasonPolicy = {
  add_root_admin: "required",
  remove_other_root_admin: "required",
  no_effect: "optional",
};

export const DEFAULT_ADMIN_EMAILS_REASON_CONTRACT: AdminEmailsReasonContract = {
  modes: DEFAULT_ADMIN_EMAILS_REASON_POLICY,
  presets: {
    add_root_admin: [
      "Расширение команды администрирования",
      "Резервный root-admin на случай инцидента",
      "Делегирование ответственности",
      "Временное назначение на период проекта",
    ],
    remove_other_root_admin: [
      "Ротация доступа",
      "Учетная запись больше не используется",
      "Снижение привилегий по политике безопасности",
      "Запрос владельца системы",
    ],
    no_effect: [],
  },
  hints: {
    required: "Причина обязательна и попадет в аудит-лог.",
    recommended: "Причина рекомендуется и попадет в аудит-лог при указании.",
    optional: "Причина необязательна; при указании попадет в аудит-лог.",
  },
};

export function getReasonMode(meta?: ReasonMetaLike): ReasonMode {
  if (meta?.reason_mode === "required" || meta?.reason_mode === "recommended" || meta?.reason_mode === "optional") {
    return meta.reason_mode;
  }
  return meta?.reason_required ? "required" : "recommended";
}

export function getReasonPlaceholder(mode: ReasonMode, recommendedText: string): string {
  if (mode === "required") return "Причина действия (обязательно)";
  if (mode === "optional") return "Причина действия (необязательно)";
  return recommendedText;
}

export function getReasonRequiredError(mode: ReasonMode): string {
  if (mode === "required") return "Для этого действия требуется причина.";
  return "";
}

export function resolveAdminEmailsReasonMode(args: {
  currentEmails: string[];
  nextEmails: string[];
  actorEmail: string;
  policy?: Partial<AdminEmailsReasonPolicy> | null;
}): ReasonMode {
  const policy = { ...DEFAULT_ADMIN_EMAILS_REASON_POLICY, ...(args.policy || {}) };
  const actor = (args.actorEmail || "").trim().toLowerCase();
  const current = new Set((args.currentEmails || []).map((x) => (x || "").trim().toLowerCase()).filter(Boolean));
  const next = new Set((args.nextEmails || []).map((x) => (x || "").trim().toLowerCase()).filter(Boolean));

  let removedOther = 0;
  for (const email of current) {
    if (!next.has(email) && email !== actor) removedOther += 1;
  }
  if (removedOther > 0) return policy.remove_other_root_admin;

  let added = 0;
  for (const email of next) {
    if (!current.has(email)) added += 1;
  }
  if (added > 0) return policy.add_root_admin;

  return policy.no_effect;
}

export function resolveAdminEmailsReasonScenario(args: {
  currentEmails: string[];
  nextEmails: string[];
  actorEmail: string;
}): AdminEmailsReasonScenario {
  const actor = (args.actorEmail || "").trim().toLowerCase();
  const current = new Set((args.currentEmails || []).map((x) => (x || "").trim().toLowerCase()).filter(Boolean));
  const next = new Set((args.nextEmails || []).map((x) => (x || "").trim().toLowerCase()).filter(Boolean));

  for (const email of current) {
    if (!next.has(email) && email !== actor) return "remove_other_root_admin";
  }
  for (const email of next) {
    if (!current.has(email)) return "add_root_admin";
  }
  return "no_effect";
}

export function mergeAdminEmailsReasonContract(
  incoming?: Partial<AdminEmailsReasonContract> | null,
): AdminEmailsReasonContract {
  return {
    modes: {
      ...DEFAULT_ADMIN_EMAILS_REASON_CONTRACT.modes,
      ...(incoming?.modes || {}),
    },
    presets: {
      ...DEFAULT_ADMIN_EMAILS_REASON_CONTRACT.presets,
      ...(incoming?.presets || {}),
    },
    hints: {
      ...DEFAULT_ADMIN_EMAILS_REASON_CONTRACT.hints,
      ...(incoming?.hints || {}),
    },
  };
}
