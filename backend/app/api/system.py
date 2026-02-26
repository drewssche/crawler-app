from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse

from app.core.api_response import get_request_id, success_response_payload
from app.core.export_utils import csv_attachment_response, xlsx_attachment_response
from app.core.metrics import prometheus_text, snapshot_metrics
from app.core.metrics_export import flatten_metric_rows
from app.core.monitoring_cache import get_metrics_snapshot_ttl_seconds, get_or_set_cached
from app.core.security import require_permission
from app.db.models.user import User

router = APIRouter(tags=["system"])


@router.get("/health")
def health(request: Request):
    return {"ok": True, "status": "ok", "request_id": get_request_id(request)}


@router.get("/metrics")
def metrics(request: Request, _: User = Depends(require_permission("audit.view"))):
    payload = get_or_set_cached(
        "monitoring:metrics_snapshot:v1",
        get_metrics_snapshot_ttl_seconds(),
        lambda: {"counters": snapshot_metrics()},
    )
    return success_response_payload(request, data=payload)


@router.get("/metrics/prometheus")
def metrics_prometheus():
    return PlainTextResponse(content=prometheus_text(), media_type="text/plain; version=0.0.4; charset=utf-8")


@router.get("/metrics/export.csv")
def export_metrics_csv(
    group: str = "all",
    query: str = "",
    _: User = Depends(require_permission("audit.view")),
):
    rows = flatten_metric_rows(group, query)
    return csv_attachment_response(
        filename="metrics.csv",
        header=["metric", "description", "labels", "value"],
        rows=(
            [row["metric"], row["description"], row["labels"], row["value"]]
            for row in rows
        ),
    )


@router.get("/metrics/export.xlsx")
def export_metrics_xlsx(
    group: str = "all",
    query: str = "",
    _: User = Depends(require_permission("audit.view")),
):
    rows = flatten_metric_rows(group, query)
    return xlsx_attachment_response(
        filename="metrics.xlsx",
        sheet_name="Metrics",
        header=["metric", "description", "labels", "value"],
        rows=(
            [row["metric"], row["description"], row["labels"], row["value"]]
            for row in rows
        ),
    )
