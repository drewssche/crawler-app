import os
import time
from typing import Any

import httpx

from app.core.monitoring_cache import (
    get_cached,
    get_monitoring_history_ttl_seconds,
    set_cached,
)
from app.core.monitoring_settings import get_monitoring_settings, update_monitoring_settings


def get_monitoring_settings_payload() -> dict:
    return get_monitoring_settings()


def update_monitoring_settings_payload(
    *,
    warn_error_delta: float,
    warn_error_rate: float,
    crit_error_delta: float,
    crit_error_rate: float,
) -> dict:
    return update_monitoring_settings(
        warn_error_delta=warn_error_delta,
        warn_error_rate=warn_error_rate,
        crit_error_delta=crit_error_delta,
        crit_error_rate=crit_error_rate,
    )


def _prometheus_base_url() -> str:
    return os.getenv("PROMETHEUS_URL", "http://prometheus:9090").rstrip("/")


def _query_prometheus_range(
    *,
    query: str,
    start_ts: int,
    end_ts: int,
    step_seconds: int,
) -> list[dict[str, float]]:
    url = f"{_prometheus_base_url()}/api/v1/query_range"
    with httpx.Client(timeout=8.0) as client:
        response = client.get(
            url,
            params={
                "query": query,
                "start": str(start_ts),
                "end": str(end_ts),
                "step": str(step_seconds),
            },
        )
        response.raise_for_status()
        payload = response.json()

    data = payload.get("data", {})
    results = data.get("result", [])
    if not results:
        return []

    values: list[list[Any]] = results[0].get("values", [])
    points: list[dict[str, float]] = []
    for item in values:
        if not isinstance(item, list) or len(item) != 2:
            continue
        try:
            ts = float(item[0])
            val = float(item[1])
        except (TypeError, ValueError):
            continue
        points.append({"ts": ts, "value": val})
    return points


def _prometheus_escape_label_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def get_monitoring_history_payload(
    *,
    range_minutes: int,
    step_seconds: int,
    force_refresh: bool,
) -> dict:
    safe_range = max(5, min(range_minutes, 24 * 60))
    safe_step = max(10, min(step_seconds, 600))
    end_ts = int(time.time())
    start_ts = end_ts - safe_range * 60

    queries = {
        "http_requests": "(sum(http_requests_total) or vector(0))",
        "http_errors": "(sum(http_errors_total) or vector(0))",
        "auth_starts": "(sum(auth_start_total) or vector(0))",
        "admin_actions": "(sum(admin_action_total) or vector(0))",
        "events_center": "(sum(events_center_total) or vector(0))",
        "invalid_code": '(sum(auth_verify_result_total{result="invalid_code"}) or vector(0))',
    }

    cache_key = f"monitoring:history:v1:range={safe_range}:step={safe_step}"
    if not force_refresh:
        cached = get_cached(cache_key)
        if cached is not None:
            return cached

    try:
        series = {
            key: _query_prometheus_range(
                query=query,
                start_ts=start_ts,
                end_ts=end_ts,
                step_seconds=safe_step,
            )
            for key, query in queries.items()
        }
        payload = {
            "enabled": True,
            "source": "prometheus",
            "range_minutes": safe_range,
            "step_seconds": safe_step,
            "series": series,
        }
        set_cached(cache_key, payload, get_monitoring_history_ttl_seconds())
        return payload
    except Exception as exc:
        payload = {
            "enabled": False,
            "source": "prometheus",
            "range_minutes": safe_range,
            "step_seconds": safe_step,
            "series": {k: [] for k in queries.keys()},
            "error": str(exc),
        }
        set_cached(cache_key, payload, max(1, get_monitoring_history_ttl_seconds() // 2))
        return payload


def get_monitoring_focus_history_payload(
    *,
    metric_name: str,
    metric_path: str | None,
    range_minutes: int,
    step_seconds: int,
    force_refresh: bool,
) -> dict:
    safe_range = max(5, min(range_minutes, 24 * 60))
    safe_step = max(10, min(step_seconds, 600))
    end_ts = int(time.time())
    start_ts = end_ts - safe_range * 60

    safe_metric_name = metric_name.strip()
    if not safe_metric_name:
        raise ValueError("metric_name is required")

    label_filter = ""
    if metric_path and metric_path.strip():
        esc_path = _prometheus_escape_label_value(metric_path.strip())
        label_filter = f'{{path="{esc_path}"}}'

    promql = f"sum({safe_metric_name}{label_filter})"
    path_key = (metric_path or "").strip()
    cache_key = f"monitoring:focus:v1:metric={safe_metric_name}:path={path_key}:range={safe_range}:step={safe_step}"
    if not force_refresh:
        cached = get_cached(cache_key)
        if cached is not None:
            return cached

    try:
        points = _query_prometheus_range(
            query=promql,
            start_ts=start_ts,
            end_ts=end_ts,
            step_seconds=safe_step,
        )
        payload = {
            "enabled": True,
            "source": "prometheus",
            "range_minutes": safe_range,
            "step_seconds": safe_step,
            "query": promql,
            "series": points,
        }
        set_cached(cache_key, payload, get_monitoring_history_ttl_seconds())
        return payload
    except Exception as exc:
        payload = {
            "enabled": False,
            "source": "prometheus",
            "range_minutes": safe_range,
            "step_seconds": safe_step,
            "query": promql,
            "series": [],
            "error": str(exc),
        }
        set_cached(cache_key, payload, max(1, get_monitoring_history_ttl_seconds() // 2))
        return payload
