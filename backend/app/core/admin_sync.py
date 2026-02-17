import os
import re
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.models.user import User

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(value: str) -> str:
    return value.strip().lower()


def parse_admin_emails(raw: str) -> list[str]:
    emails = [normalize_email(x) for x in raw.split(",") if x.strip()]
    return sorted(set(emails))


def get_runtime_admin_emails() -> list[str]:
    return parse_admin_emails(os.getenv("ADMIN_EMAILS", ""))


def is_root_admin_email(email: str) -> bool:
    target = normalize_email(email)
    return target in set(get_runtime_admin_emails())


def validate_admin_emails(emails: list[str]) -> None:
    invalid = [email for email in emails if not EMAIL_RE.match(email)]
    if invalid:
        raise ValueError(f"Invalid emails: {', '.join(invalid)}")


@dataclass
class AdminSyncResult:
    created: int = 0
    promoted: int = 0
    demoted: int = 0
    skipped_create_without_password: int = 0


def sync_admin_users(db: Session, admin_emails: list[str], admin_password: str | None) -> AdminSyncResult:
    result = AdminSyncResult()
    target = set(admin_emails)

    all_users = db.query(User).all()
    by_email = {u.email.lower(): u for u in all_users}

    for user in all_users:
        if user.is_admin and user.email.lower() not in target:
            user.is_admin = False
            user.is_blocked = False
            if user.role == "admin":
                user.role = "viewer"
            if user.trust_policy == "permanent":
                user.trust_policy = "standard"
            result.demoted += 1

    for email in admin_emails:
        existing = by_email.get(email)
        if existing:
            changed = False
            if existing.role != "admin":
                existing.role = "admin"
                changed = True
            if existing.trust_policy != "permanent":
                existing.trust_policy = "permanent"
                changed = True
            if not existing.is_admin:
                existing.is_admin = True
                changed = True
            if not existing.is_approved:
                existing.is_approved = True
                changed = True
            if existing.is_blocked:
                existing.is_blocked = False
                changed = True
            if existing.token_version is None:
                existing.token_version = 0
                changed = True
            if changed:
                result.promoted += 1
            continue

        if not admin_password:
            result.skipped_create_without_password += 1
            continue

        db.add(
            User(
                email=email,
                hashed_password=hash_password(admin_password),
                role="admin",
                trust_policy="permanent",
                is_admin=True,
                is_approved=True,
                is_blocked=False,
                token_version=0,
            )
        )
        result.created += 1

    db.commit()
    return result


def get_env_file_path() -> str:
    return os.getenv("ENV_FILE_PATH", "/app/.env.root")


def write_admin_emails_to_env_file(admin_emails: list[str]) -> None:
    path = get_env_file_path()
    value = ",".join(admin_emails)

    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except FileNotFoundError as exc:
        raise RuntimeError(f"Env file not found: {path}") from exc

    replaced = False
    updated_lines: list[str] = []
    for line in lines:
        if line.strip().startswith("ADMIN_EMAILS="):
            updated_lines.append(f"ADMIN_EMAILS={value}\n")
            replaced = True
        else:
            updated_lines.append(line)

    if not replaced:
        if updated_lines and not updated_lines[-1].endswith("\n"):
            updated_lines[-1] = f"{updated_lines[-1]}\n"
        updated_lines.append(f"ADMIN_EMAILS={value}\n")

    with open(path, "w", encoding="utf-8") as f:
        f.writelines(updated_lines)

    # Keep runtime env in sync to enforce root-admin checks immediately.
    os.environ["ADMIN_EMAILS"] = ",".join(admin_emails)
