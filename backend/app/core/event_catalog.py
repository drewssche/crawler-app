from app.core.events import EVENT_CHANNEL_ACTION, EVENT_CHANNEL_NOTIFICATION, EVENT_SEVERITY_INFO, EVENT_SEVERITY_WARNING

ADMIN_ACTION_TITLE: dict[str, str] = {
    "approve": "Подтверждение доступа",
    "remove_approve": "Снятие подтверждения",
    "block": "Блокировка пользователя",
    "unblock": "Разблокировка пользователя",
    "revoke_sessions": "Отзыв JWT-сессий",
    "revoke_trusted_devices": "Отзыв доверенных устройств",
    "revoke_trusted_device": "Отзыв доверенного устройства",
    "revoke_trusted_devices_except_one": "Отзыв доверенных устройств (кроме одного)",
    "send_code": "Отправка кода входа",
    "set_trust_policy": "Смена политики доверия",
    "set_role": "Смена роли",
    "delete_soft": "Мягкое удаление пользователя",
    "restore": "Восстановление пользователя",
    "delete_hard": "Окончательное удаление пользователя",
    "grant_admin": "Назначение admin",
    "revoke_admin": "Снятие admin",
    "update_admin_emails": "Обновление root-admin email",
}

SECURITY_ADMIN_ACTIONS = {
    "block",
    "unblock",
    "revoke_sessions",
    "revoke_trusted_devices",
    "revoke_trusted_device",
    "revoke_trusted_devices_except_one",
    "send_code",
    "delete_soft",
    "delete_hard",
    "set_role",
    "grant_admin",
    "revoke_admin",
}


def admin_action_event_meta(action: str) -> dict:
    return {
        "event_type": f"admin.{action}",
        "channel": EVENT_CHANNEL_ACTION,
        "severity": EVENT_SEVERITY_WARNING if action in SECURITY_ADMIN_ACTIONS else EVENT_SEVERITY_INFO,
        "title": ADMIN_ACTION_TITLE.get(action, f"Admin action: {action}"),
    }


def request_access_event_meta() -> dict:
    return {
        "event_type": "auth.request_access",
        "channel": EVENT_CHANNEL_NOTIFICATION,
        "severity": EVENT_SEVERITY_INFO,
        "title": "Новый запрос доступа",
    }


def audit_action_catalog_payload() -> dict:
    return {
        "actions": [
            {
                "action": action,
                "label": label,
                "security": action in SECURITY_ADMIN_ACTIONS,
            }
            for action, label in ADMIN_ACTION_TITLE.items()
        ]
    }
