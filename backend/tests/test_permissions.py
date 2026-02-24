import os
import re
from pathlib import Path

import pytest

from app.core.permissions import PERMISSIONS_BY_ROLE, has_permission, normalize_role, permissions_matrix_payload


def _frontend_permissions_path() -> Path:
    env_value = (os.environ.get("FRONTEND_PERMISSIONS_TS") or "").strip()
    if env_value:
        env_path = Path(env_value)
        if env_path.exists() and env_path.is_file():
            return env_path

    candidates = [
        Path(__file__).resolve().parents[2] / "frontend" / "src" / "utils" / "permissions.ts",
        Path(__file__).resolve().parents[1] / ".." / "frontend" / "src" / "utils" / "permissions.ts",
        Path.cwd() / "frontend" / "src" / "utils" / "permissions.ts",
    ]
    for path in candidates:
        if path.exists() and path.is_file():
            return path

    pytest.skip(
        "frontend permissions.ts is not available in this test environment; "
        "run tools/check_rbac_parity.py in monorepo root for full parity check"
    )


def _frontend_permissions_source() -> str:
    path = _frontend_permissions_path()
    return path.read_text(encoding="utf-8")


def _parse_frontend_permission_union(source: str) -> set[str]:
    match = re.search(r"export\s+type\s+Permission\s*=\s*(.*?);", source, re.S)
    assert match, "frontend Permission type union is not found"
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def _parse_frontend_permissions_by_role(source: str) -> dict[str, set[str]]:
    match = re.search(r"const\s+PERMISSIONS_BY_ROLE[^=]*=\s*\{(.*?)\n\};", source, re.S)
    assert match, "frontend PERMISSIONS_BY_ROLE map is not found"
    body = match.group(1)

    result: dict[str, set[str]] = {}
    pattern = re.compile(
        r"^\s*(?:\"([^\"]+)\"|([a-z\-]+))\s*:\s*new\s+Set(?:<Permission>)?\((.*?)\),?\s*$",
        re.M | re.S,
    )
    for role_match in pattern.finditer(body):
        role = role_match.group(1) or role_match.group(2)
        values_raw = role_match.group(3)
        perms = set(re.findall(r'"([^"]+)"', values_raw))
        result[role] = perms

    return result


def test_normalize_role_unknown_defaults_to_viewer():
    assert normalize_role("unknown-role") == "viewer"
    assert normalize_role(None) == "viewer"


def test_has_permission_matrix_basics():
    assert has_permission("admin", "users.manage") is True
    assert has_permission("admin", "root_admins.manage") is False
    assert has_permission("root-admin", "root_admins.manage") is True
    assert has_permission("viewer", "events.view") is False


def test_permissions_matrix_payload_contains_expected_roles():
    payload = permissions_matrix_payload()
    roles = [x["role"] for x in payload["roles"]]
    assert roles == ["viewer", "editor", "admin", "root-admin"]


def test_frontend_permission_union_matches_backend():
    source = _frontend_permissions_source()
    frontend_permissions = _parse_frontend_permission_union(source)
    backend_permissions = {perm for perms in PERMISSIONS_BY_ROLE.values() for perm in perms}
    assert frontend_permissions == backend_permissions


def test_frontend_permissions_matrix_matches_backend():
    source = _frontend_permissions_source()
    frontend = _parse_frontend_permissions_by_role(source)
    backend = {role: set(perms) for role, perms in PERMISSIONS_BY_ROLE.items()}

    assert set(frontend.keys()) == set(backend.keys())
    for role in backend:
        assert frontend[role] == backend[role]




