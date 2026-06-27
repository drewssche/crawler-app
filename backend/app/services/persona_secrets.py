import base64
import hashlib
import json
import os
from typing import Any

from cryptography.fernet import Fernet, InvalidToken


MAX_SESSION_BUNDLE_BYTES = 200_000


def _secret_material() -> str:
    return os.getenv("CRAWL_PERSONA_SECRET_KEY") or os.getenv("SECRET_KEY") or ""


def _fernet() -> Fernet:
    secret = _secret_material()
    if not secret:
        raise RuntimeError("CRAWL_PERSONA_SECRET_KEY or SECRET_KEY is required for persona session encryption")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(key)


def canonical_session_bundle(bundle: dict[str, Any]) -> str:
    raw = json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if len(raw.encode("utf-8")) > MAX_SESSION_BUNDLE_BYTES:
        raise ValueError("Session bundle is too large.")
    return raw


def encrypt_session_bundle(bundle: dict[str, Any]) -> tuple[str, str]:
    raw = canonical_session_bundle(bundle)
    fingerprint = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    encrypted = _fernet().encrypt(raw.encode("utf-8")).decode("utf-8")
    return encrypted, fingerprint


def decrypt_session_bundle(encrypted: str) -> dict[str, Any]:
    try:
        raw = _fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Session bundle cannot be decrypted with the configured key.") from exc
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("Session bundle must decode to an object.")
    return data
