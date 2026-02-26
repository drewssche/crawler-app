import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.orm import Session

from app.core.admin_sync import parse_admin_emails, sync_admin_users
from app.core.monitoring_anomaly import run_monitoring_anomaly_loop
from app.db.session import SessionLocal


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
