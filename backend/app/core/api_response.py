from fastapi import Request


def get_request_id(request: Request) -> str:
    rid = getattr(request.state, "request_id", None)
    return str(rid) if rid else "-"


def error_response_payload(
    request: Request,
    *,
    code: str,
    message: str,
    details=None,
) -> dict:
    return {
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "details": details,
        },
        "request_id": get_request_id(request),
    }


def success_response_payload(
    request: Request,
    *,
    data,
    meta: dict | None = None,
) -> dict:
    return {
        "ok": True,
        "data": data,
        "meta": meta or {},
        "request_id": get_request_id(request),
    }
