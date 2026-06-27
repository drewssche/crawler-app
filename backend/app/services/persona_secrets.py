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


def _count_collection(value: Any) -> int:
    if isinstance(value, dict):
        return len(value)
    if isinstance(value, list):
        return len([item for item in value if item])
    return 0


def summarize_session_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    cookies_count = _count_collection(bundle.get("cookies"))
    headers = bundle.get("headers") or bundle.get("httpHeaders")
    headers_count = _count_collection(headers)
    local_storage_count = _count_collection(bundle.get("localStorage") or bundle.get("local_storage"))
    session_storage_count = _count_collection(bundle.get("sessionStorage") or bundle.get("session_storage"))

    origins = bundle.get("origins")
    if isinstance(origins, list):
        for origin in origins:
            if not isinstance(origin, dict):
                continue
            local_storage_count += _count_collection(origin.get("localStorage"))
            session_storage_count += _count_collection(origin.get("sessionStorage"))

    http_parts = []
    if cookies_count:
        http_parts.append("cookies")
    if headers_count:
        http_parts.append("headers")
    browser_parts = []
    if local_storage_count:
        browser_parts.append("localStorage")
    if session_storage_count:
        browser_parts.append("sessionStorage")

    return {
        "status": "connected",
        "http_applicable": bool(http_parts),
        "browser_state_stored": bool(browser_parts),
        "cookies_count": cookies_count,
        "headers_count": headers_count,
        "local_storage_count": local_storage_count,
        "session_storage_count": session_storage_count,
        "applied_now": http_parts,
        "stored_for_browser": browser_parts,
        "values_exposed": False,
    }
