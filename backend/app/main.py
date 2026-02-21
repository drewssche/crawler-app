import os
import logging
import time
import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy.orm import Session
from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.events import router as events_router
from app.api.profiles import router as profiles_router
from app.api.runs import router as runs_router
from app.core.admin_sync import parse_admin_emails, sync_admin_users
from app.core.api_response import error_response_payload, get_request_id, success_response_payload
from app.core.metrics import increment_counter, prometheus_text, snapshot_metrics
from app.core.monitoring_cache import get_metrics_snapshot_ttl_seconds, get_or_set_cached
from app.core.export_utils import csv_attachment_response, xlsx_attachment_response
from app.core.monitoring_anomaly import run_monitoring_anomaly_loop
from app.core.security import require_permission
from app.db.models.user import User
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

METRIC_DESCRIPTIONS: dict[str, str] = {
    "http_requests_total": "Количество HTTP-запросов к API.",
    "http_errors_total": "Количество HTTP-ошибок (4xx/5xx).",
    "auth_start_total": "Количество стартов авторизации.",
    "auth_verify_total": "Количество проверок одноразового кода.",
    "auth_request_access_total": "Количество заявок на доступ.",
    "admin_bulk_total": "Количество массовых admin-операций.",
    "admin_action_total": "Количество единичных admin-действий.",
    "events_center_total": "Количество загрузок центра событий.",
    "events_feed_total": "Количество загрузок полной ленты событий.",
    "events_read_total": "Изменения статуса прочитанности событий.",
    "events_dismiss_total": "Изменения статуса скрытия событий.",
}


def _flatten_metric_rows(group: str, query: str) -> list[dict[str, str | int | float]]:
    counters = snapshot_metrics()
    group_prefix = group.strip().lower()
    q = query.strip().lower()
    rows: list[dict[str, str | int | float]] = []
    for metric_name, items in counters.items():
        if group_prefix and group_prefix != "all" and not metric_name.startswith(f"{group_prefix}_"):
            continue
        for item in items:
            labels_dict = item.get("labels", {}) if isinstance(item, dict) else {}
            labels = ", ".join(f"{k}={v}" for k, v in sorted(labels_dict.items())) if labels_dict else "-"
            value = item.get("value", 0) if isinstance(item, dict) else 0
            row = {
                "metric": metric_name,
                "description": METRIC_DESCRIPTIONS.get(metric_name, "Служебная метрика."),
                "labels": labels,
                "value": value,
            }
            if q:
                haystack = f"{row['metric']} {row['description']} {row['labels']}".lower()
                if q not in haystack:
                    continue
            rows.append(row)
    rows.sort(key=lambda x: float(x["value"]), reverse=True)
    return rows


@asynccontextmanager
async def lifespan(_: FastAPI):
    admin_emails_raw = os.getenv("ADMIN_EMAILS", "")
    admin_password = os.getenv("ADMIN_PASSWORD")
    admin_emails = parse_admin_emails(admin_emails_raw)
    if admin_emails and admin_password:
        db: Session = SessionLocal()
        try:
            sync_admin_users(db, admin_emails, admin_password)
        finally:
            db.close()
    anomaly_stop_event: asyncio.Event | None = None
    anomaly_task: asyncio.Task | None = None
    if os.getenv("MONITORING_ANOMALY_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}:
        anomaly_stop_event = asyncio.Event()
        anomaly_task = asyncio.create_task(run_monitoring_anomaly_loop(anomaly_stop_event))

    yield

    if anomaly_stop_event is not None:
        anomaly_stop_event.set()
    if anomaly_task is not None:
        try:
            await asyncio.wait_for(anomaly_task, timeout=3)
        except (asyncio.TimeoutError, Exception):
            anomaly_task.cancel()


app = FastAPI(title="Crawler API", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(events_router)
app.include_router(profiles_router)
app.include_router(runs_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid4().hex
    request.state.request_id = request_id
    started_at = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - started_at) * 1000
    response.headers["X-Request-ID"] = request_id
    if request.url.path not in {"/metrics", "/metrics/prometheus"}:
        increment_counter(
            "http_requests_total",
            method=request.method.upper(),
            path=request.url.path,
            status=str(response.status_code),
        )
    logger.info(
        "http_request request_id=%s method=%s path=%s status=%s duration_ms=%.2f",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    detail = exc.detail
    message = detail if isinstance(detail, str) else "Request failed"
    increment_counter(
        "http_errors_total",
        code=str(exc.status_code),
        path=request.url.path,
        method=request.method.upper(),
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=error_response_payload(
            request,
            code=f"http_{exc.status_code}",
            message=message,
            details=detail,
        ),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    increment_counter(
        "http_errors_total",
        code="422",
        path=request.url.path,
        method=request.method.upper(),
    )
    return JSONResponse(
        status_code=422,
        content=error_response_payload(
            request,
            code="validation_error",
            message="Validation error",
            details=exc.errors(),
        ),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    increment_counter(
        "http_errors_total",
        code="500",
        path=request.url.path,
        method=request.method.upper(),
    )
    logger.exception("Unhandled error request_id=%s", get_request_id(request), exc_info=exc)
    return JSONResponse(
        status_code=500,
        content=error_response_payload(
            request,
            code="internal_error",
            message="Internal server error",
        ),
    )


@app.get("/health")
def health(request: Request):
    return {"ok": True, "status": "ok", "request_id": get_request_id(request)}


@app.get("/metrics")
def metrics(request: Request, _: User = Depends(require_permission("audit.view"))):
    payload = get_or_set_cached(
        "monitoring:metrics_snapshot:v1",
        get_metrics_snapshot_ttl_seconds(),
        lambda: {"counters": snapshot_metrics()},
    )
    return success_response_payload(request, data=payload)


@app.get("/metrics/prometheus")
def metrics_prometheus():
    return PlainTextResponse(content=prometheus_text(), media_type="text/plain; version=0.0.4; charset=utf-8")


@app.get("/metrics/export.csv")
def export_metrics_csv(
    group: str = "all",
    query: str = "",
    _: User = Depends(require_permission("audit.view")),
):
    rows = _flatten_metric_rows(group, query)
    return csv_attachment_response(
        filename="metrics.csv",
        header=["metric", "description", "labels", "value"],
        rows=(
            [row["metric"], row["description"], row["labels"], row["value"]]
            for row in rows
        ),
    )


@app.get("/metrics/export.xlsx")
def export_metrics_xlsx(
    group: str = "all",
    query: str = "",
    _: User = Depends(require_permission("audit.view")),
):
    rows = _flatten_metric_rows(group, query)
    return xlsx_attachment_response(
        filename="metrics.xlsx",
        sheet_name="Metrics",
        header=["metric", "description", "labels", "value"],
        rows=(
            [row["metric"], row["description"], row["labels"], row["value"]]
            for row in rows
        ),
    )
