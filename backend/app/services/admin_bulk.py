from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Literal

from sqlalchemy.orm import Session

from app.db.models.admin_audit_log import AdminAuditLog
from app.db.models.event_feed import EventFeed
from app.db.models.event_user_state import EventUserState
from app.db.models.login_code import LoginCode
from app.db.models.login_history import LoginHistory
from app.db.models.trusted_device import TrustedDevice
from app.db.models.user import User

BulkAction = Literal[
    "approve",
    "remove_approve",
    "block",
    "unblock",
    "revoke_sessions",
    "revoke_trusted_devices",
    "send_code",
    "set_trust_policy",
    "set_role",
    "delete_soft",
    "restore",
    "delete_hard",
]


@dataclass
class BulkActionPayload:
    action: BulkAction
    role: Literal["editor", "viewer", "admin"] | None = None
    trust_policy: Literal["strict", "standard", "extended", "permanent"] | None = None
    reason: str | None = None


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


ACTION_CATALOG: dict[str, dict] = {
    "approve": {
        "label": "Подтвердить доступ",
        "critical": False,
        "requires": {"role": True},
        "details": "Одобряет пользователя и назначает роль.",
        "reason_required": False,
        "reason_presets": [
            "Одобрен после проверки заявки",
            "Одобрен по запросу руководителя",
        ],
        "approve_roles": {
            "viewer": "Базовый доступ: просмотр данных без изменения.",
            "editor": "Расширенный доступ: просмотр, запуск прогонов, редактирование профилей.",
            "admin": "Административный доступ: управление пользователями и настройками.",
        },
    },
    "remove_approve": {
        "label": "Снять approve",
        "critical": True,
        "requires": {},
        "details": "Отзывает доступ до повторного одобрения.",
        "reason_required": False,
        "reason_presets": [
            "Временное ограничение доступа",
            "Требуется повторная валидация пользователя",
        ],
    },
    "block": {
        "label": "Заблокировать",
        "critical": True,
        "requires": {},
        "details": "Блокирует вход и отзывает текущие сессии.",
        "reason_required": False,
        "reason_presets": [
            "Подозрительная активность",
            "Нарушение политики доступа",
        ],
    },
    "unblock": {
        "label": "Разблокировать",
        "critical": False,
        "requires": {},
        "details": "Снимает блокировку входа.",
        "reason_required": False,
        "reason_presets": [
            "Проверка завершена, доступ восстановлен",
            "Запрос на разблокировку подтвержден",
        ],
    },
    "revoke_sessions": {
        "label": "Отозвать сессии",
        "critical": True,
        "requires": {},
        "details": "Инвалидирует все JWT пользователя.",
        "reason_required": False,
        "reason_presets": [
            "Принудительный повторный вход",
            "Сброс сессий после изменения прав",
        ],
    },
    "revoke_trusted_devices": {
        "label": "Отозвать доверенные устройства",
        "critical": True,
        "requires": {},
        "details": "Сбрасывает доверенные устройства.",
        "reason_required": False,
        "reason_presets": [
            "Устройство скомпрометировано",
            "Плановый сброс доверенных устройств",
        ],
    },
    "send_code": {
        "label": "Выслать код",
        "critical": False,
        "requires": {},
        "details": "Отправляет одноразовый код входа пользователю.",
        "reason_required": False,
        "reason_presets": [
            "Пользователь запросил новый код",
            "Помощь со входом",
        ],
    },
    "set_trust_policy": {
        "label": "Назначить trust-policy",
        "critical": False,
        "requires": {"trust_policy": True},
        "details": "Устанавливает политику доверенных устройств.",
        "reason_required": False,
        "reason_presets": [
            "Усиление политики безопасности",
            "Смягчение политики по рабочему запросу",
        ],
    },
    "set_role": {
        "label": "Назначить роль",
        "critical": True,
        "requires": {"role": True},
        "details": "Меняет роль уже подтвержденного пользователя.",
        "reason_required": True,
        "reason_presets": [
            "Изменение зоны ответственности",
            "Корректировка уровня доступа",
        ],
        "approve_roles": {
            "viewer": "Базовый доступ: просмотр данных без изменения.",
            "editor": "Расширенный доступ: просмотр, запуск прогонов, редактирование профилей.",
            "admin": "Административный доступ: управление пользователями и настройками.",
        },
    },
    "delete_soft": {
        "label": "Удалить (soft)",
        "critical": True,
        "requires": {},
        "details": "Скрывает пользователя из активного списка и запрещает вход.",
        "reason_required": False,
        "reason_presets": [
            "Аккаунт деактивирован",
            "Запрос на удаление аккаунта",
        ],
    },
    "restore": {
        "label": "Восстановить",
        "critical": False,
        "requires": {},
        "details": "Возвращает пользователя в список и снимает soft-delete.",
        "reason_required": False,
        "reason_presets": [
            "Восстановление по запросу",
            "Ошибка удаления",
        ],
    },
    "delete_hard": {
        "label": "Удалить окончательно",
        "critical": True,
        "requires": {},
        "details": "Полностью удаляет пользователя из БД с очисткой связанных записей.",
        "reason_required": True,
        "reason_presets": [
            "GDPR/право на удаление",
            "Тестовый аккаунт",
        ],
    },
}


def bulk_action_catalog_payload(*, include_admin_role: bool = False) -> dict:
    role_meta = dict(ACTION_CATALOG["approve"].get("approve_roles", {}))
    if not include_admin_role:
        role_meta.pop("admin", None)
    return {
        "actions": [
            {
                "action": action,
                "label": meta["label"],
                "critical": bool(meta.get("critical", False)),
                "requires": meta.get("requires", {}),
                "details": meta.get("details", ""),
                "reason_required": bool(meta.get("reason_required", False)),
                "reason_presets": meta.get("reason_presets", []),
                "approve_roles": role_meta if action in {"approve", "set_role"} else meta.get("approve_roles", {}),
            }
            for action, meta in ACTION_CATALOG.items()
        ]
    }


def _with_reason(meta: dict | None, reason: str | None) -> dict | None:
    base = dict(meta or {})
    value = (reason or "").strip()
    if value:
        base["reason"] = value
    return base if base else None


def available_actions_for_user(user: User) -> set[BulkAction]:
    actions: set[BulkAction] = set()

    if user.is_deleted:
        actions.add("restore")
        actions.add("delete_hard")
        return actions

    if not user.is_approved:
        actions.add("approve")
    if user.is_approved:
        actions.add("remove_approve")
        actions.add("revoke_sessions")
        actions.add("revoke_trusted_devices")
        actions.add("set_trust_policy")
        actions.add("set_role")
        if not user.is_blocked:
            actions.add("send_code")
    if user.is_blocked:
        actions.add("unblock")
    else:
        actions.add("block")
    actions.add("delete_soft")
    actions.add("delete_hard")
    return actions


def available_actions_for_users(users: list[User]) -> list[BulkAction]:
    if not users:
        return []
    per_user = [available_actions_for_user(u) for u in users]
    if not per_user:
        return []
    union_actions = set().union(*per_user)
    ordered = [a for a in ACTION_CATALOG.keys() if a in union_actions]
    return ordered


def _handle_approve(*, user: User, payload: BulkActionPayload, log_action: Callable[[str, User, dict | None], None], **_) -> dict:
    if payload.role is None:
        return {"ok": False, "detail": "Role is required for approve"}
    old_role = user.role
    user.role = payload.role
    user.is_admin = payload.role == "admin"
    user.is_approved = True
    user.is_blocked = False
    log_action("approve", user, _with_reason({"old_role": old_role, "new_role": user.role}, payload.reason))
    return {"ok": True, "action": "approve", "role": user.role}


def _handle_remove_approve(*, user: User, payload: BulkActionPayload, log_action: Callable[[str, User, dict | None], None], **_) -> dict:
    user.is_approved = False
    log_action("remove_approve", user, _with_reason({}, payload.reason))
    return {"ok": True, "action": "remove_approve"}


def _handle_block(*, user: User, payload: BulkActionPayload, log_action: Callable[[str, User, dict | None], None], **_) -> dict:
    user.is_blocked = True
    user.token_version = int(user.token_version) + 1
    log_action("block", user, _with_reason({}, payload.reason))
    return {"ok": True, "action": "block"}


def _handle_unblock(*, user: User, payload: BulkActionPayload, log_action: Callable[[str, User, dict | None], None], **_) -> dict:
    user.is_blocked = False
    log_action("unblock", user, _with_reason({}, payload.reason))
    return {"ok": True, "action": "unblock"}


def _handle_revoke_sessions(*, user: User, payload: BulkActionPayload, log_action: Callable[[str, User, dict | None], None], **_) -> dict:
    user.token_version = int(user.token_version) + 1
    log_action("revoke_sessions", user, _with_reason({}, payload.reason))
    return {"ok": True, "action": "revoke_sessions"}


def _handle_revoke_trusted_devices(*, db: Session, user: User, payload: BulkActionPayload, log_action: Callable[[str, User, dict | None], None], **_) -> dict:
    now = _utc_now_naive()
    revoked_count = (
        db.query(TrustedDevice)
        .filter(TrustedDevice.user_id == user.id, TrustedDevice.revoked_at.is_(None))
        .update({TrustedDevice.revoked_at: now}, synchronize_session=False)
    )
    log_action("revoke_trusted_devices", user, _with_reason({"revoked_count": int(revoked_count)}, payload.reason))
    return {"ok": True, "action": "revoke_trusted_devices"}


def _handle_send_code(*, db: Session, user: User, payload: BulkActionPayload, log_action: Callable[[str, User, dict | None], None], send_login_code: Callable[[Session, User], dict], **_) -> dict:
    if not user.is_approved or user.is_blocked:
        return {"ok": False, "detail": "User is not allowed to login"}
    send_result = send_login_code(db, user)
    log_action(
        "send_code",
        user,
        _with_reason({"challenge_id": send_result["challenge_id"], "sent": send_result["sent"]}, payload.reason),
    )
    return {"ok": True, "action": "send_code", **send_result}


def _handle_set_trust_policy(*, user: User, payload: BulkActionPayload, log_action: Callable[[str, User, dict | None], None], **_) -> dict:
    if payload.trust_policy is None:
        return {"ok": False, "detail": "trust_policy is required"}
    old_policy = user.trust_policy
    user.trust_policy = payload.trust_policy
    log_action(
        "set_trust_policy",
        user,
        _with_reason({"old_policy": old_policy, "new_policy": user.trust_policy}, payload.reason),
    )
    return {"ok": True, "action": "set_trust_policy", "trust_policy": user.trust_policy}


def _handle_set_role(*, user: User, payload: BulkActionPayload, log_action: Callable[[str, User, dict | None], None], **_) -> dict:
    if payload.role is None:
        return {"ok": False, "detail": "Role is required"}
    if not user.is_approved or user.is_deleted:
        return {"ok": False, "detail": "Role can be changed only for active approved users"}
    if not (payload.reason or "").strip():
        return {"ok": False, "detail": "Reason is required"}

    old_role = user.role
    user.role = payload.role
    user.is_admin = payload.role == "admin"
    user.token_version = int(user.token_version) + 1
    log_action("set_role", user, _with_reason({"old_role": old_role, "new_role": user.role}, payload.reason))
    return {"ok": True, "action": "set_role", "role": user.role}


def _handle_delete_soft(*, user: User, payload: BulkActionPayload, log_action: Callable[[str, User, dict | None], None], **_) -> dict:
    if user.is_deleted:
        return {"ok": False, "detail": "User already deleted"}
    user.is_deleted = True
    user.is_approved = False
    user.is_blocked = True
    user.token_version = int(user.token_version) + 1
    log_action("delete_soft", user, _with_reason({}, payload.reason))
    return {"ok": True, "action": "delete_soft"}


def _handle_restore(*, user: User, payload: BulkActionPayload, log_action: Callable[[str, User, dict | None], None], **_) -> dict:
    if not user.is_deleted:
        return {"ok": False, "detail": "User is not deleted"}
    user.is_deleted = False
    user.is_blocked = False
    user.is_approved = False
    user.role = "viewer"
    log_action("restore", user, _with_reason({}, payload.reason))
    return {"ok": True, "action": "restore"}


def _handle_delete_hard(*, db: Session, user: User, payload: BulkActionPayload, log_action: Callable[[str, User, dict | None], None], **_) -> dict:
    if not (payload.reason or "").strip():
        return {"ok": False, "detail": "Reason is required"}

    db.query(EventUserState).filter(EventUserState.user_id == user.id).delete(synchronize_session=False)
    db.query(LoginCode).filter(LoginCode.user_id == user.id).delete(synchronize_session=False)
    db.query(TrustedDevice).filter(TrustedDevice.user_id == user.id).delete(synchronize_session=False)
    db.query(AdminAuditLog).filter(AdminAuditLog.actor_user_id == user.id).update(
        {AdminAuditLog.actor_user_id: None}, synchronize_session=False
    )
    db.query(AdminAuditLog).filter(AdminAuditLog.target_user_id == user.id).update(
        {AdminAuditLog.target_user_id: None}, synchronize_session=False
    )
    db.query(EventFeed).filter(EventFeed.actor_user_id == user.id).update(
        {EventFeed.actor_user_id: None}, synchronize_session=False
    )
    db.query(EventFeed).filter(EventFeed.target_user_id == user.id).update(
        {EventFeed.target_user_id: None}, synchronize_session=False
    )
    db.query(LoginHistory).filter(LoginHistory.user_id == user.id).update(
        {LoginHistory.user_id: None}, synchronize_session=False
    )
    log_action("delete_hard", user, _with_reason({}, payload.reason))
    db.delete(user)
    return {"ok": True, "action": "delete_hard"}


ACTION_HANDLERS: dict[str, Callable[..., dict]] = {
    "approve": _handle_approve,
    "remove_approve": _handle_remove_approve,
    "block": _handle_block,
    "unblock": _handle_unblock,
    "revoke_sessions": _handle_revoke_sessions,
    "revoke_trusted_devices": _handle_revoke_trusted_devices,
    "send_code": _handle_send_code,
    "set_trust_policy": _handle_set_trust_policy,
    "set_role": _handle_set_role,
    "delete_soft": _handle_delete_soft,
    "restore": _handle_restore,
    "delete_hard": _handle_delete_hard,
}


def execute_bulk_action_for_user(
    *,
    db: Session,
    user: User,
    payload: BulkActionPayload,
    log_action: Callable[[str, User, dict | None], None],
    send_login_code: Callable[[Session, User], dict],
) -> dict:
    handler = ACTION_HANDLERS.get(payload.action)
    if not handler:
        return {"ok": False, "detail": "Unknown action"}

    return handler(
        db=db,
        user=user,
        payload=payload,
        log_action=log_action,
        send_login_code=send_login_code,
    )
