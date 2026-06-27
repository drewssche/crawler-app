from typing import Literal

Permission = Literal[
    "data.view",
    "crawler.run",
    "projects.edit",
    "events.view",
    "audit.view",
    "users.manage",
    "root_admins.manage",
]

PERMISSIONS_BY_ROLE: dict[str, set[Permission]] = {
    "viewer": {"data.view"},
    "editor": {"data.view", "crawler.run", "projects.edit"},
    "admin": {"data.view", "crawler.run", "projects.edit", "events.view", "audit.view", "users.manage"},
    "root-admin": {
        "data.view",
        "crawler.run",
        "projects.edit",
        "events.view",
        "audit.view",
        "users.manage",
        "root_admins.manage",
    },
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
    "data.view": "Просмотр проектов и данных",
    "crawler.run": "Запуск прогонов",
    "projects.edit": "Редактирование проектов",
    "events.view": "Просмотр центра событий",
    "audit.view": "Просмотр журнала действий",
    "users.manage": "Управление пользователями",
    "root_admins.manage": "Управление root-admin email",
}


CAPABILITY_MATRIX: list[dict] = [
    {"id": "data.view", "label": "Просмотр данных", "roles": ["viewer", "editor", "admin", "root-admin"]},
    {"id": "crawler.run", "label": "Запуск прогонов", "roles": ["editor", "admin", "root-admin"]},
    {"id": "projects.edit", "label": "Редактирование проектов", "roles": ["editor", "admin", "root-admin"]},
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
