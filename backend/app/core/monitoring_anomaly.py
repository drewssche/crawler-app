import asyncio
import logging
import os
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from app.core.events import (
    EVENT_CHANNEL_NOTIFICATION,
    EVENT_SEVERITY_DANGER,
    EVENT_SEVERITY_WARNING,
    emit_event,
)
from app.core.metrics import increment_counter
from app.core.monitoring_settings import get_monitoring_settings
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Snapshot:
    http_requests_total: float
    http_errors_total: float
    invalid_code_total: float


class MonitoringAnomalyDetector:
    def __init__(self) -> None:
        self._last_snapshot: Snapshot | None = None
        self._last_emit_at: dict[str, float] = {}
        self._cooldown_seconds = int(os.getenv("MONITORING_ANOMALY_COOLDOWN_SECONDS", "600"))
        self._prometheus_url = os.getenv("PROMETHEUS_URL", "http://prometheus:9090").rstrip("/")
        self._invalid_warn = float(os.getenv("MONITOR_INVALID_CODE_WARN", "5"))
        self._invalid_crit = float(os.getenv("MONITOR_INVALID_CODE_CRIT", "15"))

    async def _query_instant(self, query: str) -> float:
        url = f"{self._prometheus_url}/api/v1/query"
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(url, params={"query": query})
            res.raise_for_status()
            payload = res.json()

        data = payload.get("data", {})
        result = data.get("result", [])
        if not result:
            return 0.0
        value = result[0].get("value", [])
        if not isinstance(value, list) or len(value) != 2:
            return 0.0
        try:
            return float(value[1])
        except (TypeError, ValueError):
            return 0.0

    async def _fetch_snapshot(self) -> Snapshot:
        http_requests_total, http_errors_total, invalid_code_total = await asyncio.gather(
            self._query_instant("sum(http_requests_total)"),
            self._query_instant("sum(http_errors_total)"),
            self._query_instant('sum(auth_verify_result_total{result="invalid_code"})'),
        )
        return Snapshot(
            http_requests_total=http_requests_total,
            http_errors_total=http_errors_total,
            invalid_code_total=invalid_code_total,
        )

    @staticmethod
    def _counter_delta(current: float, previous: float) -> float:
        if current >= previous:
            return current - previous
        return current

    def _can_emit(self, key: str) -> bool:
        now = time.time()
        last = self._last_emit_at.get(key, 0)
        if now - last < self._cooldown_seconds:
            return False
        self._last_emit_at[key] = now
        return True

    def _build_target_path(self, highlight_key: str, *, focus_metric: str | None = None) -> str:
        params = {"highlight_key": highlight_key}
        if focus_metric:
            params["focus_metric"] = focus_metric
        return f"/monitoring?{urlencode(params)}"

    def _emit_anomaly(
        self,
        *,
        key: str,
        severity: str,
        title: str,
        body: str,
        highlight_key: str,
        focus_metric: str | None,
        meta_json: dict,
    ) -> None:
        if not self._can_emit(key):
            return
        db = SessionLocal()
        try:
            emit_event(
                db,
                event_type="monitoring.anomaly",
                channel=EVENT_CHANNEL_NOTIFICATION,
                severity=severity,
                title=title,
                body=body,
                target_path=self._build_target_path(highlight_key, focus_metric=focus_metric),
                target_ref=key,
                meta_json={
                    "anomaly_key": key,
                    "highlight_key": highlight_key,
                    "focus_metric": focus_metric,
                    **meta_json,
                },
            )
            db.commit()
            increment_counter("monitoring_anomaly_total", key=key, severity=severity)
        finally:
            db.close()

    async def tick(self) -> None:
        try:
            snapshot = await self._fetch_snapshot()
        except Exception as exc:
            logger.warning("Monitoring anomaly detector failed to query Prometheus: %s", exc)
            self._emit_anomaly(
                key="prometheus_unavailable",
                severity=EVENT_SEVERITY_WARNING,
                title="Мониторинг: Prometheus недоступен",
                body="Не удалось получить метрики из Prometheus.",
                highlight_key="summary",
                focus_metric=None,
                meta_json={"error": str(exc)[:500]},
            )
            return

        if self._last_snapshot is None:
            self._last_snapshot = snapshot
            return

        req_delta = self._counter_delta(snapshot.http_requests_total, self._last_snapshot.http_requests_total)
        err_delta = self._counter_delta(snapshot.http_errors_total, self._last_snapshot.http_errors_total)
        invalid_delta = self._counter_delta(snapshot.invalid_code_total, self._last_snapshot.invalid_code_total)

        self._last_snapshot = snapshot

        settings = get_monitoring_settings()
        warn_delta = float(settings.get("warn_error_delta", 1.0))
        warn_rate = float(settings.get("warn_error_rate", 3.0))
        crit_delta = float(settings.get("crit_error_delta", 3.0))
        crit_rate = float(settings.get("crit_error_rate", 10.0))

        err_rate = (err_delta / req_delta * 100.0) if req_delta > 0 else 0.0

        if err_delta >= crit_delta or err_rate >= crit_rate:
            self._emit_anomaly(
                key="http_errors_critical",
                severity=EVENT_SEVERITY_DANGER,
                title="Мониторинг: критический рост HTTP-ошибок",
                body=f"За интервал errors +{err_delta:.0f}, requests +{req_delta:.0f}, error-rate {err_rate:.1f}%.",
                highlight_key="http_errors",
                focus_metric="http_errors_total",
                meta_json={"errors_delta": err_delta, "requests_delta": req_delta, "error_rate": err_rate},
            )
        elif err_delta >= warn_delta or err_rate >= warn_rate:
            self._emit_anomaly(
                key="http_errors_warning",
                severity=EVENT_SEVERITY_WARNING,
                title="Мониторинг: рост HTTP-ошибок",
                body=f"За интервал errors +{err_delta:.0f}, requests +{req_delta:.0f}, error-rate {err_rate:.1f}%.",
                highlight_key="http_errors",
                focus_metric="http_errors_total",
                meta_json={"errors_delta": err_delta, "requests_delta": req_delta, "error_rate": err_rate},
            )

        if invalid_delta >= self._invalid_crit:
            self._emit_anomaly(
                key="invalid_code_critical",
                severity=EVENT_SEVERITY_DANGER,
                title="Мониторинг: всплеск invalid_code",
                body=f"За интервал invalid_code +{invalid_delta:.0f}.",
                highlight_key="summary",
                focus_metric="auth_verify_result_total",
                meta_json={"invalid_code_delta": invalid_delta},
            )
        elif invalid_delta >= self._invalid_warn:
            self._emit_anomaly(
                key="invalid_code_warning",
                severity=EVENT_SEVERITY_WARNING,
                title="Мониторинг: рост invalid_code",
                body=f"За интервал invalid_code +{invalid_delta:.0f}.",
                highlight_key="summary",
                focus_metric="auth_verify_result_total",
                meta_json={"invalid_code_delta": invalid_delta},
            )


async def run_monitoring_anomaly_loop(stop_event: asyncio.Event) -> None:
    if not _env_bool("MONITORING_ANOMALY_ENABLED", True):
        return

    interval = int(os.getenv("MONITORING_ANOMALY_INTERVAL_SECONDS", "60"))
    interval = max(30, min(interval, 900))

    detector = MonitoringAnomalyDetector()

    while not stop_event.is_set():
        try:
            await detector.tick()
        except Exception:
            logger.exception("Monitoring anomaly detector tick failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass
