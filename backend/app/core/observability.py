import logging

from fastapi import Request

from app.core.api_response import get_request_id


def log_business_event(
    logger: logging.Logger,
    request: Request,
    *,
    event: str,
    **fields,
) -> None:
    request_id = get_request_id(request)
    chunks = [f"event={event}", f"request_id={request_id}"]
    for key, value in fields.items():
        chunks.append(f"{key}={value}")
    logger.info("business_event %s", " ".join(chunks))

