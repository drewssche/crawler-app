import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.events import router as events_router
from app.api.profiles import router as profiles_router
from app.api.runs import router as runs_router
from app.api.system import router as system_router
from app.core.exception_handlers import register_exception_handlers
from app.core.http_middleware import register_request_context_middleware


def register_routers(app: FastAPI) -> None:
    app.include_router(auth_router)
    app.include_router(admin_router)
    app.include_router(events_router)
    app.include_router(profiles_router)
    app.include_router(runs_router)
    app.include_router(system_router)


def register_cors(app: FastAPI) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def register_http_stack(app: FastAPI, logger: logging.Logger) -> None:
    register_request_context_middleware(app, logger)
    register_exception_handlers(app, logger)
