import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import (
    LOGIN_CODE_EXPIRE_MINUTES,
    create_access_token,
    generate_login_code,
    get_current_user,
    get_user_role,
    hash_login_code,
    hash_password,
    verify_login_code,
    verify_password,
)
from app.core.utils import send_auth_code_email
from app.db.models.login_code import LoginCode
from app.db.models.user import User
from app.db.session import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class RequestAccessIn(BaseModel):
    email: str
    password: str


class VerifyCodeIn(BaseModel):
    challenge_id: int
    code: str


@router.post("/login")
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not user.is_approved or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    code = generate_login_code()
    challenge = LoginCode(
        user_id=user.id,
        code_hash=hash_login_code(code),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=LOGIN_CODE_EXPIRE_MINUTES),
        used_at=None,
        attempts=0,
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)

    sent = send_auth_code_email(user.email, code)
    response = {
        "mfa_required": True,
        "challenge_id": challenge.id,
        "message": "Код подтверждения отправлен на email.",
    }
    if not sent:
        if os.getenv("AUTH_DEV_SHOW_CODE", "false").lower() == "true":
            response["message"] = "SMTP не настроен, dev-код возвращен в ответе."
            response["dev_code"] = code
        else:
            response["message"] = "SMTP не настроен. Обратитесь к администратору."
    return response


@router.post("/verify-code")
def verify_code(payload: VerifyCodeIn, db: Session = Depends(get_db)):
    challenge = db.get(LoginCode, payload.challenge_id)
    if not challenge:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid challenge")

    now = datetime.now(timezone.utc)
    expires_at = challenge.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if challenge.used_at is not None or expires_at < now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Code expired or already used")

    if challenge.attempts >= 5:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many invalid attempts")

    if not verify_login_code(payload.code, challenge.code_hash):
        challenge.attempts += 1
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid code")

    challenge.used_at = now
    db.commit()

    user = db.get(User, challenge.user_id)
    if not user or not user.is_approved:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not approved")

    role = get_user_role(user)
    token = create_access_token({"sub": user.email, "role": role})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    role = get_user_role(current_user)
    return {"email": current_user.email, "role": role}


@router.post("/request-access")
def request_access(payload: RequestAccessIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()

    if not user:
        user = User(
            email=payload.email,
            hashed_password=hash_password(payload.password),
            role="viewer",
            is_admin=False,
            is_approved=False,
        )
        db.add(user)
        db.commit()
        return {"ok": True, "status": "requested"}

    if user.is_approved:
        return {"ok": False, "status": "approved", "message": "User is already approved. Please use login."}

    return {"ok": True, "status": "already_requested", "message": "Request already exists and is pending approval."}
