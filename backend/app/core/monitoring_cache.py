import os
import threading
import time
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")

_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, object]] = {}


def _now() -> float:
    return time.monotonic()


def _ttl_from_env(name: str, default_seconds: int) -> int:
    try:
        raw = int(os.getenv(name, str(default_seconds)).strip())
        return max(0, raw)
    except Exception:
        return default_seconds


def get_monitoring_history_ttl_seconds() -> int:
    return _ttl_from_env("MONITORING_HISTORY_CACHE_TTL_SECONDS", 10)


def get_metrics_snapshot_ttl_seconds() -> int:
    return _ttl_from_env("METRICS_SNAPSHOT_CACHE_TTL_SECONDS", 3)


def get_cached(key: str) -> T | None:
    now = _now()
    with _cache_lock:
        hit = _cache.get(key)
        if not hit:
            return None
        expires_at, value = hit
        if expires_at <= now:
            _cache.pop(key, None)
            return None
        return value  # type: ignore[return-value]


def set_cached(key: str, value: T, ttl_seconds: int) -> T:
    expires_at = _now() + max(0, ttl_seconds)
    with _cache_lock:
        _cache[key] = (expires_at, value)
    return value


def get_or_set_cached(key: str, ttl_seconds: int, factory: Callable[[], T]) -> T:
    cached = get_cached(key)
    if cached is not None:
        return cached
    value = factory()
    return set_cached(key, value, ttl_seconds)


def invalidate_cache_prefix(prefix: str) -> None:
    with _cache_lock:
        keys = [key for key in _cache.keys() if key.startswith(prefix)]
        for key in keys:
            _cache.pop(key, None)
