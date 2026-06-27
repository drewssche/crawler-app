from typing import Any
from urllib.parse import urlparse


SESSION_HEADER_BLOCKLIST = {
    "connection",
    "content-length",
    "cookie",
    "host",
    "transfer-encoding",
    "upgrade",
}


def _string_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _origin_from_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}"


def _host_from_url(url: str) -> str:
    return (urlparse(url).hostname or "").strip().lower()


def _storage_entries(raw: Any) -> list[dict[str, str]]:
    if isinstance(raw, dict):
        return [
            {"name": str(name), "value": _string_value(value)}
            for name, value in raw.items()
            if str(name).strip()
        ]
    if isinstance(raw, list):
        entries = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("key") or "").strip()
            if not name:
                continue
            entries.append({"name": name, "value": _string_value(item.get("value"))})
        return entries
    return []


def _cookie_entries(raw: Any, *, document_url: str) -> list[dict[str, Any]]:
    default_host = _host_from_url(document_url)
    if isinstance(raw, dict):
        iterable = [{"name": name, "value": value} for name, value in raw.items()]
    elif isinstance(raw, list):
        iterable = [item for item in raw if isinstance(item, dict)]
    else:
        iterable = []

    cookies = []
    for item in iterable:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        domain = str(item.get("domain") or default_host).strip().lstrip(".")
        path = str(item.get("path") or "/").strip() or "/"
        cookie: dict[str, Any] = {
            "name": name,
            "value": _string_value(item.get("value")),
            "domain": domain,
            "path": path,
            "expires": float(item.get("expires", -1) or -1),
            "httpOnly": bool(item.get("httpOnly") or item.get("http_only") or False),
            "secure": bool(item.get("secure") or False),
            "sameSite": item.get("sameSite") or item.get("same_site") or "Lax",
        }
        cookies.append(cookie)
    return cookies


def _headers(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    headers = {}
    for key, value in raw.items():
        name = str(key).strip()
        if not name or name.lower() in SESSION_HEADER_BLOCKLIST:
            continue
        header_value = _string_value(value).strip()
        if header_value:
            headers[name] = header_value
    return headers


def build_browser_persona_state(bundle: dict[str, Any], *, document_url: str) -> dict[str, Any]:
    origin = _origin_from_url(document_url)
    cookies = _cookie_entries(bundle.get("cookies"), document_url=document_url)
    extra_http_headers = _headers(bundle.get("headers") or bundle.get("httpHeaders"))
    origins_by_url: dict[str, dict[str, Any]] = {}
    session_storage: dict[str, list[dict[str, str]]] = {}

    def ensure_origin(target_origin: str) -> dict[str, Any]:
        if target_origin not in origins_by_url:
            origins_by_url[target_origin] = {"origin": target_origin, "localStorage": []}
        return origins_by_url[target_origin]

    if origin:
        top_level_local_storage = _storage_entries(bundle.get("localStorage") or bundle.get("local_storage"))
        if top_level_local_storage:
            ensure_origin(origin)["localStorage"].extend(top_level_local_storage)
        top_level_session_storage = _storage_entries(bundle.get("sessionStorage") or bundle.get("session_storage"))
        if top_level_session_storage:
            session_storage.setdefault(origin, []).extend(top_level_session_storage)

    raw_origins = bundle.get("origins")
    if isinstance(raw_origins, list):
        for item in raw_origins:
            if not isinstance(item, dict):
                continue
            item_origin = str(item.get("origin") or "").strip()
            if not item_origin:
                continue
            local_storage = _storage_entries(item.get("localStorage") or item.get("local_storage"))
            if local_storage:
                ensure_origin(item_origin)["localStorage"].extend(local_storage)
            stored_session = _storage_entries(item.get("sessionStorage") or item.get("session_storage"))
            if stored_session:
                session_storage.setdefault(item_origin, []).extend(stored_session)

    return {
        "storage_state": {
            "cookies": cookies,
            "origins": list(origins_by_url.values()),
        },
        "extra_http_headers": extra_http_headers,
        "session_storage": session_storage,
        "summary": {
            "cookies_count": len(cookies),
            "headers_count": len(extra_http_headers),
            "local_storage_count": sum(len(row["localStorage"]) for row in origins_by_url.values()),
            "session_storage_count": sum(len(rows) for rows in session_storage.values()),
            "values_exposed": False,
        },
    }
