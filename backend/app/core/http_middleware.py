import logging
import time
from uuid import uuid4

from fastapi import FastAPI, Request

from app.core.metrics import increment_counter


def register_request_context_middleware(app: FastAPI, logger: logging.Logger) -> None:
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
            if response.status_code >= 400:
                increment_counter(
                    "http_errors_total",
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
