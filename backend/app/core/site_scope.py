from dataclasses import dataclass
from typing import Literal
from urllib.parse import unquote, urlparse, urlunparse


ScopeMode = Literal["whole_site", "path_prefix"]


@dataclass(frozen=True)
class CanonicalSiteScope:
    start_url: str
    canonical_origin: str
    scope_mode: ScopeMode
    path_prefix: str
    hostname: str


def _normalize_path(raw: str | None) -> str:
    parts: list[str] = []
    for part in unquote(raw or "/").split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/" if not parts else f"/{'/'.join(parts)}/"


def canonicalize_site_scope(
    start_url: str,
    *,
    scope_mode: ScopeMode,
    path_prefix: str | None = None,
) -> CanonicalSiteScope:
    if scope_mode not in {"whole_site", "path_prefix"}:
        raise ValueError("Scope mode must be whole_site or path_prefix")

    parsed = urlparse(str(start_url).strip())
    scheme = parsed.scheme.lower()
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if scheme not in {"http", "https"} or not hostname:
        raise ValueError("Start URL must use http/https and contain a hostname")

    port = parsed.port
    default_port = (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    netloc = hostname if port is None or default_port else f"{hostname}:{port}"
    origin = f"{scheme}://{netloc}"
    normalized_start_path = _normalize_path(parsed.path)
    effective_prefix = "/" if scope_mode == "whole_site" else _normalize_path(path_prefix or parsed.path)
    if scope_mode == "path_prefix" and normalized_start_path == "/":
        normalized_start_path = effective_prefix
    if scope_mode == "path_prefix" and not normalized_start_path.startswith(effective_prefix):
        raise ValueError("Start URL must be inside the selected path prefix")
    start_path = "/" if normalized_start_path == "/" else normalized_start_path.rstrip("/")
    normalized_start = urlunparse((scheme, netloc, start_path, "", "", ""))

    return CanonicalSiteScope(
        start_url=normalized_start,
        canonical_origin=origin,
        scope_mode=scope_mode,
        path_prefix=effective_prefix,
        hostname=hostname,
    )


def is_url_in_site_scope(url: str, scope: CanonicalSiteScope) -> bool:
    parsed = urlparse(str(url).strip())
    scheme = parsed.scheme.lower()
    hostname = (parsed.hostname or "").lower().rstrip(".")
    port = parsed.port
    default_port = (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    netloc = hostname if port is None or default_port else f"{hostname}:{port}"
    if f"{scheme}://{netloc}" != scope.canonical_origin:
        return False
    if scope.scope_mode == "whole_site":
        return True
    candidate = _normalize_path(parsed.path)
    return candidate.startswith(scope.path_prefix)
