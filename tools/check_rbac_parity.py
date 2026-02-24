#!/usr/bin/env python3
"""Fail-fast parity check between backend and frontend RBAC permission matrices."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.permissions import PERMISSIONS_BY_ROLE  # noqa: E402


def _load_frontend_source() -> str:
    path = ROOT / "frontend" / "src" / "utils" / "permissions.ts"
    if not path.exists():
        raise FileNotFoundError(f"frontend permissions file not found: {path}")
    return path.read_text(encoding="utf-8")


def _parse_frontend_permission_union(source: str) -> set[str]:
    match = re.search(r"export\s+type\s+Permission\s*=\s*(.*?);", source, re.S)
    if not match:
        raise ValueError("frontend Permission type union is not found")
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def _parse_frontend_permissions_by_role(source: str) -> dict[str, set[str]]:
    match = re.search(r"const\s+PERMISSIONS_BY_ROLE[^=]*=\s*\{(.*?)\n\};", source, re.S)
    if not match:
        raise ValueError("frontend PERMISSIONS_BY_ROLE map is not found")
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


def _diff_sets(title: str, left: set[str], right: set[str]) -> list[str]:
    missing = sorted(right - left)
    extra = sorted(left - right)
    lines: list[str] = []
    if missing:
        lines.append(f"{title}: missing in frontend: {missing}")
    if extra:
        lines.append(f"{title}: extra in frontend: {extra}")
    return lines


def main() -> int:
    source = _load_frontend_source()
    frontend_union = _parse_frontend_permission_union(source)
    frontend_by_role = _parse_frontend_permissions_by_role(source)

    backend_by_role = {role: set(perms) for role, perms in PERMISSIONS_BY_ROLE.items()}
    backend_union = {perm for perms in backend_by_role.values() for perm in perms}

    errors: list[str] = []
    errors.extend(_diff_sets("Permission union", frontend_union, backend_union))
    errors.extend(_diff_sets("Role keys", set(frontend_by_role.keys()), set(backend_by_role.keys())))

    for role, backend_perms in sorted(backend_by_role.items()):
        frontend_perms = frontend_by_role.get(role, set())
        role_errors = _diff_sets(f"Role `{role}`", frontend_perms, backend_perms)
        errors.extend(role_errors)

    if errors:
        print("RBAC parity check failed:")
        for line in errors:
            print(f"- {line}")
        return 1

    print("RBAC parity check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
