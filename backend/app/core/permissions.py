from typing import Literal

Permission = Literal[
    "events.view",
    "audit.view",
    "users.manage",
    "root_admins.manage",
]

PERMISSIONS_BY_ROLE: dict[str, set[Permission]] = {
    "viewer": set(),
    "editor": set(),
    "admin": {"events.view", "audit.view", "users.manage"},
    "root-admin": {"events.view", "audit.view", "users.manage", "root_admins.manage"},
}


def normalize_role(role: str | None) -> str:
    value = (role or "").strip().lower()
    if value in PERMISSIONS_BY_ROLE:
        return value
    return "viewer"


def has_permission(role: str | None, permission: Permission) -> bool:
    normalized = normalize_role(role)
    return permission in PERMISSIONS_BY_ROLE.get(normalized, set())


PERMISSION_LABELS: dict[Permission, str] = {
    "events.view": "Просмотр центра событий",
    "audit.view": "Просмотр журнала действий",
    "users.manage": "Управление пользователями",
    "root_admins.manage": "Управление root-admin email",
}


CAPABILITY_MATRIX: list[dict] = [
    {"id": "data.view", "label": "Просмотр данных", "roles": ["viewer", "editor", "admin", "root-admin"]},
    {"id": "crawler.run", "label": "Запуск прогонов", "roles": ["editor", "admin", "root-admin"]},
    {"id": "profiles.edit", "label": "Редактирование профилей", "roles": ["editor", "admin", "root-admin"]},
    {"id": "users.manage", "label": "Управление пользователями", "roles": ["admin", "root-admin"]},
    {"id": "root_admins.manage", "label": "Управление системными администраторами", "roles": ["root-admin"]},
]


def permissions_matrix_payload() -> dict:
    role_order = ["viewer", "editor", "admin", "root-admin"]
    return {
        "roles": [
            {"role": role, "permissions": sorted(PERMISSIONS_BY_ROLE.get(role, set()))}
            for role in role_order
        ],
        "permission_labels": PERMISSION_LABELS,
        "capabilities": CAPABILITY_MATRIX,
    }
