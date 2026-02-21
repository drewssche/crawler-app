import os
import hashlib
import hmac
import random
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.permissions import Permission, has_permission
from app.db.models.user import User
from app.db.session import get_db

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
LOGIN_CODE_EXPIRE_MINUTES = int(os.getenv("LOGIN_CODE_EXPIRE_MINUTES", "10"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/start")


def _runtime_root_admin_emails() -> set[str]:
    raw = os.getenv("ADMIN_EMAILS", "")
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


def _get_secret_key() -> str:
    secret = os.getenv("SECRET_KEY")
    if not secret:
        raise RuntimeError("SECRET_KEY is not set")
    return secret


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)


def create_access_token(payload: dict) -> str:
    to_encode = payload.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, _get_secret_key(), algorithm=ALGORITHM)


def generate_login_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def hash_login_code(code: str) -> str:
    secret = _get_secret_key()
    return hashlib.sha256(f"{code}:{secret}".encode("utf-8")).hexdigest()


def verify_login_code(code: str, code_hash: str) -> bool:
    return hmac.compare_digest(hash_login_code(code), code_hash)


def generate_trusted_device_token() -> str:
    return secrets.token_urlsafe(48)


def hash_trusted_device_token(token: str) -> str:
    secret = _get_secret_key()
    return hashlib.sha256(f"{token}:{secret}".encode("utf-8")).hexdigest()


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, _get_secret_key(), algorithms=[ALGORITHM])
        email = payload.get("sub")
        token_version = payload.get("tv")
        if not email:
            raise credentials_exception
    except JWTError as exc:
        raise credentials_exception from exc

    user = db.query(User).filter(User.email == email).first()
    if not user or not user.is_approved or user.is_blocked or user.is_deleted:
        raise credentials_exception
    if token_version is None or int(token_version) != int(user.token_version):
        raise credentials_exception
    return user


def get_user_role(user: User) -> str:
    if (getattr(user, "email", "") or "").lower() in _runtime_root_admin_emails():
        return "root-admin"
    if getattr(user, "role", None):
        return user.role
    if user.is_admin:
        return "admin"
    return "viewer"


def require_admin_user(current_user: User = Depends(get_current_user)) -> User:
    if get_user_role(current_user) not in {"admin", "root-admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


def require_permission(permission: Permission):
    def _dependency(current_user: User = Depends(get_current_user)) -> User:
        role = get_user_role(current_user)
        if not has_permission(role, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission required: {permission}",
            )
        return current_user

    return _dependency
