import os
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.rate_limit import check_rate_limit, record_attempt
from app.core.security import (
    LOGIN_CODE_EXPIRE_MINUTES,
    create_access_token,
    generate_login_code,
    generate_trusted_device_token,
    get_current_user,
    get_user_role,
    hash_login_code,
    hash_password,
    hash_trusted_device_token,
    verify_login_code,
)
from app.core.utils import send_auth_code_email
from app.db.models.login_code import LoginCode
from app.db.models.trusted_device import TrustedDevice
from app.db.models.user import User
from app.db.session import get_db

router = APIRouter(prefix="/auth", tags=["auth"])

AUTH_START_LIMIT = int(os.getenv("AUTH_START_LIMIT", "5"))
AUTH_START_WINDOW_MINUTES = int(os.getenv("AUTH_START_WINDOW_MINUTES", "15"))
REQUEST_ACCESS_LIMIT = int(os.getenv("REQUEST_ACCESS_LIMIT", "3"))
REQUEST_ACCESS_WINDOW_MINUTES = int(os.getenv("REQUEST_ACCESS_WINDOW_MINUTES", "60"))
VERIFY_CODE_LIMIT = int(os.getenv("VERIFY_CODE_LIMIT", "10"))
VERIFY_CODE_WINDOW_MINUTES = int(os.getenv("VERIFY_CODE_WINDOW_MINUTES", "15"))
TRUST_STANDARD_DAYS = int(os.getenv("TRUST_STANDARD_DAYS", "30"))
TRUST_EXTENDED_DAYS = int(os.getenv("TRUST_EXTENDED_DAYS", "90"))
ALLOW_PERMANENT_TRUST = os.getenv("ALLOW_PERMANENT_TRUST", "true").lower() == "true"

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class StartIn(BaseModel):
    email: str
    trusted_device_token: str | None = None


class VerifyCodeIn(BaseModel):
    challenge_id: int
    code: str


class RequestAccessIn(BaseModel):
    email: str


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _validate_email(email: str) -> None:
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Invalid email format")


def _trusted_device_days(policy: str) -> int | None:
    if policy == "strict":
        return None
    if policy == "standard":
        return TRUST_STANDARD_DAYS
    if policy == "extended":
        return TRUST_EXTENDED_DAYS
    if policy == "permanent":
        return None
    return TRUST_STANDARD_DAYS


def _issue_login_code(db: Session, user: User) -> dict:
    code = generate_login_code()
    challenge = LoginCode(
        user_id=user.id,
        code_hash=hash_login_code(code),
        expires_at=_utc_now_naive() + timedelta(minutes=LOGIN_CODE_EXPIRE_MINUTES),
        used_at=None,
        attempts=0,
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)

    sent = send_auth_code_email(user.email, code)
    response = {
        "status": "code_sent" if sent else "code_not_sent",
        "challenge_id": challenge.id,
        "message": "Код отправлен на email." if sent else "SMTP не настроен.",
    }

    if not sent and os.getenv("AUTH_DEV_SHOW_CODE", "false").lower() == "true":
        response["dev_code"] = code
        response["message"] = "SMTP не настроен. Dev-код возвращен в ответе."

    return response


def _check_trusted_device(db: Session, user: User, token: str | None) -> bool:
    if not token:
        return False
    if user.trust_policy == "strict":
        return False

    token_hash = hash_trusted_device_token(token)
    device = (
        db.query(TrustedDevice)
        .filter(
            TrustedDevice.user_id == user.id,
            TrustedDevice.token_hash == token_hash,
            TrustedDevice.revoked_at.is_(None),
        )
        .first()
    )
    if not device:
        return False

    now = _utc_now_naive()
    if device.expires_at and device.expires_at < now:
        return False

    device.last_used_at = now
    db.commit()
    return True


@router.post("/start")
def start_auth(payload: StartIn, db: Session = Depends(get_db)):
    email = _normalize_email(payload.email)
    _validate_email(email)
    check_rate_limit(db, email, "auth_start", limit=AUTH_START_LIMIT, window_minutes=AUTH_START_WINDOW_MINUTES)

    user = db.query(User).filter(User.email == email).first()
    record_attempt(db, email, "auth_start")

    if not user:
        return {
            "status": "not_found",
            "message": "Пользователь не найден. Нажмите 'Запрос доступа'.",
        }

    if user.is_blocked:
        return {"status": "blocked", "message": "Пользователь заблокирован. Обратитесь к администратору."}

    if not user.is_approved:
        return {
            "status": "pending",
            "message": "Заявка уже отправлена и ожидает подтверждения администратора.",
        }

    if _check_trusted_device(db, user, payload.trusted_device_token):
        role = get_user_role(user)
        token = create_access_token({"sub": user.email, "role": role, "tv": int(user.token_version)})
        return {
            "status": "authenticated",
            "message": "Вход выполнен по доверенному устройству.",
            "access_token": token,
            "token_type": "bearer",
            "role": role,
        }

    return _issue_login_code(db, user)


@router.post("/login")
def login_alias(payload: StartIn, db: Session = Depends(get_db)):
    return start_auth(payload, db)


@router.post("/verify-code")
def verify_code(payload: VerifyCodeIn, db: Session = Depends(get_db)):
    challenge = db.get(LoginCode, payload.challenge_id)
    if not challenge:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid challenge")

    user = db.get(User, challenge.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid challenge")

    email = user.email.lower()
    check_rate_limit(db, email, "verify_code", limit=VERIFY_CODE_LIMIT, window_minutes=VERIFY_CODE_WINDOW_MINUTES)

    now = _utc_now_naive()
    if challenge.used_at is not None or challenge.expires_at < now:
        record_attempt(db, email, "verify_code")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Code expired or already used")

    if challenge.attempts >= 5:
        record_attempt(db, email, "verify_code")
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many invalid attempts")

    if not verify_login_code(payload.code, challenge.code_hash):
        challenge.attempts += 1
        db.commit()
        record_attempt(db, email, "verify_code")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid code")

    challenge.used_at = now
    db.commit()
    record_attempt(db, email, "verify_code")

    if not user.is_approved or user.is_blocked:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is not allowed to login")

    role = get_user_role(user)
    token = create_access_token({"sub": user.email, "role": role, "tv": int(user.token_version)})

    trusted_device_token = None
    trusted_device_expires_at = None
    if user.trust_policy != "strict":
        if user.trust_policy == "permanent" and not ALLOW_PERMANENT_TRUST:
            policy = "extended"
        else:
            policy = user.trust_policy

        days = _trusted_device_days(policy)
        trusted_device_token = generate_trusted_device_token()
        expires_at = None if policy == "permanent" else now + timedelta(days=days or TRUST_STANDARD_DAYS)

        device = TrustedDevice(
            user_id=user.id,
            token_hash=hash_trusted_device_token(trusted_device_token),
            policy=policy,
            created_at=now,
            expires_at=expires_at,
            last_used_at=now,
            revoked_at=None,
        )
        db.add(device)
        db.commit()
        trusted_device_expires_at = expires_at.isoformat() if expires_at else None

    return {
        "access_token": token,
        "token_type": "bearer",
        "trusted_device_token": trusted_device_token,
        "trusted_device_expires_at": trusted_device_expires_at,
        "trust_policy": user.trust_policy,
    }


@router.post("/request-access")
def request_access(payload: RequestAccessIn, db: Session = Depends(get_db)):
    email = _normalize_email(payload.email)
    _validate_email(email)
    check_rate_limit(
        db,
        email,
        "request_access",
        limit=REQUEST_ACCESS_LIMIT,
        window_minutes=REQUEST_ACCESS_WINDOW_MINUTES,
    )

    user = db.query(User).filter(User.email == email).first()
    record_attempt(db, email, "request_access")

    if not user:
        user = User(
            email=email,
            hashed_password=hash_password(f"pending:{email}:{_utc_now_naive().timestamp()}"),
            role="viewer",
            trust_policy="standard",
            is_admin=False,
            is_approved=False,
            is_blocked=False,
            token_version=0,
        )
        db.add(user)
        db.commit()
        return {"ok": True, "status": "request_created", "message": "Заявка отправлена на подтверждение."}

    if user.is_blocked:
        return {"ok": False, "status": "blocked", "message": "Пользователь заблокирован."}

    if user.is_approved:
        return {"ok": False, "status": "approved", "message": "Пользователь уже подтвержден. Перейдите на вход."}

    return {"ok": True, "status": "already_pending", "message": "Заявка уже есть и ожидает подтверждения."}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {"email": current_user.email, "role": get_user_role(current_user)}
