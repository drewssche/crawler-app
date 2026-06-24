import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.api_response import error_response_payload, get_request_id


def register_exception_handlers(app: FastAPI, logger: logging.Logger) -> None:
    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        detail = exc.detail
        message = detail if isinstance(detail, str) else str((detail or {}).get("message") or "Request failed")
        code = str((detail or {}).get("code") or f"http_{exc.status_code}") if isinstance(detail, dict) else f"http_{exc.status_code}"
        return JSONResponse(
            status_code=exc.status_code,
            content=error_response_payload(
                request,
                code=code,
                message=message,
                details=detail,
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
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
        logger.exception("Unhandled error request_id=%s", get_request_id(request), exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=error_response_payload(
                request,
                code="internal_error",
                message="Internal server error",
            ),
        )
