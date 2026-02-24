from typing import Literal

ReasonMode = Literal["required", "recommended", "optional"]
ReasonScenario = Literal["add_root_admin", "remove_other_root_admin", "no_effect"]

DEFAULT_ADMIN_EMAILS_REASON_POLICY: dict[ReasonScenario, ReasonMode] = {
    "add_root_admin": "required",
    "remove_other_root_admin": "required",
    "no_effect": "optional",
}

DEFAULT_ADMIN_EMAILS_REASON_PRESETS: dict[ReasonScenario, list[str]] = {
    "add_root_admin": [
        "Расширение команды администрирования",
        "Резервный root-admin на случай инцидента",
        "Делегирование ответственности",
        "Временное назначение на период проекта",
    ],
    "remove_other_root_admin": [
        "Ротация доступа",
        "Учетная запись больше не используется",
        "Снижение привилегий по политике безопасности",
        "Запрос владельца системы",
    ],
    "no_effect": [],
}

DEFAULT_REASON_HINTS: dict[ReasonMode, str] = {
    "required": "Причина обязательна и попадет в аудит-лог.",
    "recommended": "Причина рекомендуется и попадет в аудит-лог при указании.",
    "optional": "Причина необязательна; при указании попадет в аудит-лог.",
}


def normalize_reason_text(reason: str | None) -> str | None:
    value = (reason or "").strip()
    return value or None


def admin_emails_reason_policy_payload() -> dict:
    return {
        "modes": dict(DEFAULT_ADMIN_EMAILS_REASON_POLICY),
        "presets": {k: list(v) for k, v in DEFAULT_ADMIN_EMAILS_REASON_PRESETS.items()},
        "hints": dict(DEFAULT_REASON_HINTS),
    }


def resolve_admin_emails_reason_mode(
    *,
    current_runtime_emails: list[str],
    next_runtime_emails: list[str],
    actor_email: str,
    policy: dict[ReasonScenario, ReasonMode] | None = None,
) -> ReasonMode:
    cfg = policy or DEFAULT_ADMIN_EMAILS_REASON_POLICY
    actor = (actor_email or "").strip().lower()
    current_set = {(x or "").strip().lower() for x in current_runtime_emails if (x or "").strip()}
    next_set = {(x or "").strip().lower() for x in next_runtime_emails if (x or "").strip()}

    removed = {email for email in (current_set - next_set) if email != actor}
    if removed:
        return cfg.get("remove_other_root_admin", "required")

    added = next_set - current_set
    if added:
        return cfg.get("add_root_admin", "required")

    return cfg.get("no_effect", "optional")
