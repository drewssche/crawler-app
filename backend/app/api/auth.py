import os
import re
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.event_catalog import request_access_event_meta
from app.core.events import emit_event
from app.core.api_response import success_response_payload
from app.core.metrics import increment_counter
from app.core.observability import log_business_event
from app.core.permissions import permissions_matrix_payload
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
from app.db.models.login_history import LoginHistory
from app.db.models.trusted_device import TrustedDevice
from app.db.models.user import User
from app.db.session import get_db

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

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


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    if request.client and request.client.host:
        return request.client.host[:64]
    return None


def _write_login_history(
    db: Session,
    request: Request,
    *,
    email: str,
    result: str,
    source: str,
    user: User | None = None,
) -> None:
    db.add(
        LoginHistory(
            user_id=user.id if user else None,
            email=email,
            ip=_client_ip(request),
            user_agent=request.headers.get("user-agent", "")[:255] or None,
            result=result,
            source=source,
            created_at=_utc_now_naive(),
        )
    )
    db.commit()


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
def start_auth(payload: StartIn, request: Request, db: Session = Depends(get_db)):
    increment_counter("auth_start_total")
    email = _normalize_email(payload.email)
    _validate_email(email)
    check_rate_limit(db, email, "auth_start", limit=AUTH_START_LIMIT, window_minutes=AUTH_START_WINDOW_MINUTES)

    user = db.query(User).filter(User.email == email).first()
    record_attempt(db, email, "auth_start")

    if not user:
        increment_counter("auth_start_result_total", result="not_found")
        _write_login_history(db, request, email=email, result="not_found", source="start", user=None)
        log_business_event(logger, request, event="auth.start", result="not_found", email=email)
        return success_response_payload(request, data={
            "status": "not_found",
            "message": "Пользователь не найден. Нажмите 'Запрос доступа'.",
        })

    if user.is_deleted:
        increment_counter("auth_start_result_total", result="deleted")
        _write_login_history(db, request, email=email, result="deleted", source="start", user=user)
        log_business_event(logger, request, event="auth.start", result="deleted", email=email)
        return success_response_payload(
            request,
            data={"status": "not_found", "message": "Пользователь не найден. Нажмите 'Запрос доступа'."},
        )
    if user.is_blocked:
        increment_counter("auth_start_result_total", result="blocked")
        _write_login_history(db, request, email=email, result="blocked", source="start", user=user)
        log_business_event(logger, request, event="auth.start", result="blocked", email=email)
        return success_response_payload(
            request,
            data={"status": "blocked", "message": "Пользователь заблокирован. Обратитесь к администратору."},
        )

    if not user.is_approved:
        increment_counter("auth_start_result_total", result="pending")
        _write_login_history(db, request, email=email, result="pending", source="start", user=user)
        log_business_event(logger, request, event="auth.start", result="pending", email=email)
        return success_response_payload(request, data={
            "status": "pending",
            "message": "Заявка уже отправлена и ожидает подтверждения администратора.",
        })

    if _check_trusted_device(db, user, payload.trusted_device_token):
        role = get_user_role(user)
        token = create_access_token({"sub": user.email, "role": role, "tv": int(user.token_version)})
        increment_counter("auth_start_result_total", result="trusted_device")
        _write_login_history(db, request, email=email, result="success", source="trusted_device", user=user)
        log_business_event(logger, request, event="auth.start", result="trusted_device", email=email, role=role)
        return success_response_payload(request, data={
            "status": "authenticated",
            "message": "Вход выполнен по доверенному устройству.",
            "access_token": token,
            "token_type": "bearer",
            "role": role,
        })

    increment_counter("auth_start_result_total", result="code_sent")
    _write_login_history(db, request, email=email, result="code_sent", source="start", user=user)
    log_business_event(logger, request, event="auth.start", result="code_sent", email=email)
    return success_response_payload(request, data=_issue_login_code(db, user))


@router.post("/login")
def login_alias(payload: StartIn, request: Request, db: Session = Depends(get_db)):
    return start_auth(payload, request, db)


@router.post("/verify-code")
def verify_code(payload: VerifyCodeIn, request: Request, db: Session = Depends(get_db)):
    increment_counter("auth_verify_total")
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
        increment_counter("auth_verify_result_total", result="expired_or_used")
        _write_login_history(db, request, email=email, result="expired_or_used", source="verify_code", user=user)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Code expired or already used")

    if challenge.attempts >= 5:
        record_attempt(db, email, "verify_code")
        increment_counter("auth_verify_result_total", result="too_many_attempts")
        _write_login_history(db, request, email=email, result="too_many_attempts", source="verify_code", user=user)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many invalid attempts")

    if not verify_login_code(payload.code, challenge.code_hash):
        challenge.attempts += 1
        db.commit()
        record_attempt(db, email, "verify_code")
        increment_counter("auth_verify_result_total", result="invalid_code")
        _write_login_history(db, request, email=email, result="invalid_code", source="verify_code", user=user)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid code")

    challenge.used_at = now
    db.commit()
    record_attempt(db, email, "verify_code")

    if not user.is_approved or user.is_blocked or user.is_deleted:
        increment_counter("auth_verify_result_total", result="not_allowed")
        _write_login_history(db, request, email=email, result="not_allowed", source="verify_code", user=user)
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

    increment_counter("auth_verify_result_total", result="success")
    _write_login_history(db, request, email=email, result="success", source="verify_code", user=user)
    log_business_event(logger, request, event="auth.verify_code", result="success", email=user.email)
    return success_response_payload(request, data={
        "access_token": token,
        "token_type": "bearer",
        "trusted_device_token": trusted_device_token,
        "trusted_device_expires_at": trusted_device_expires_at,
        "trust_policy": user.trust_policy,
    })


@router.post("/request-access")
def request_access(payload: RequestAccessIn, request: Request, db: Session = Depends(get_db)):
    increment_counter("auth_request_access_total")
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
            is_deleted=False,
            token_version=0,
        )
        db.add(user)
        db.flush()
        event_meta = request_access_event_meta()
        emit_event(
            db,
            event_type=event_meta["event_type"],
            channel=event_meta["channel"],
            severity=event_meta["severity"],
            title=event_meta["title"],
            body=f"Пользователь {email} запросил доступ.",
            target_ref=f"user_email:{email}",
            target_user_id=user.id,
            meta_json={"email": email, "status": "pending"},
        )
        db.commit()
        increment_counter("auth_request_access_result_total", result="request_created")
        log_business_event(logger, request, event="auth.request_access", result="request_created", email=email)
        return success_response_payload(
            request,
            data={"status": "request_created", "message": "Заявка отправлена на подтверждение."},
        )
    if user.is_deleted:
        user.is_deleted = False
        user.is_approved = False
        user.is_blocked = False
        user.role = "viewer"
        event_meta = request_access_event_meta()
        emit_event(
            db,
            event_type=event_meta["event_type"],
            channel=event_meta["channel"],
            severity=event_meta["severity"],
            title=event_meta["title"],
            body=f"Пользователь {email} повторно запросил доступ.",
            target_ref=f"user_email:{email}",
            target_user_id=user.id,
            meta_json={"email": email, "status": "pending"},
        )
        db.commit()
        increment_counter("auth_request_access_result_total", result="request_reopened")
        return success_response_payload(
            request,
            data={"status": "request_created", "message": "Заявка отправлена на подтверждение."},
        )

    if user.is_blocked:
        increment_counter("auth_request_access_result_total", result="blocked")
        return success_response_payload(
            request,
            data={"status": "blocked", "message": "Пользователь заблокирован."},
        )

    if user.is_approved:
        increment_counter("auth_request_access_result_total", result="approved")
        return success_response_payload(
            request,
            data={"status": "approved", "message": "Пользователь уже подтвержден. Перейдите на вход."},
        )

    increment_counter("auth_request_access_result_total", result="already_pending")
    return success_response_payload(
        request,
        data={"status": "already_pending", "message": "Заявка уже есть и ожидает подтверждения."},
    )


@router.get("/me")
def me(request: Request, current_user: User = Depends(get_current_user)):
    return success_response_payload(
        request,
        data={"email": current_user.email, "role": get_user_role(current_user)},
    )


@router.get("/permissions-matrix")
def permissions_matrix(request: Request, _: User = Depends(get_current_user)):
    return success_response_payload(request, data=permissions_matrix_payload())





