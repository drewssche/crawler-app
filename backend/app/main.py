import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.profiles import router as profiles_router
from app.api.runs import router as runs_router
from app.core.admin_sync import parse_admin_emails, sync_admin_users
from app.db.session import SessionLocal

app = FastAPI(title="Crawler API")
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(profiles_router)
app.include_router(runs_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}


@app.on_event("startup")
def bootstrap_admin():
    admin_emails_raw = os.getenv("ADMIN_EMAILS", "")
    admin_password = os.getenv("ADMIN_PASSWORD")
    admin_emails = parse_admin_emails(admin_emails_raw)

    if not admin_emails or not admin_password:
        return

    db = SessionLocal()
    try:
        sync_admin_users(db, admin_emails, admin_password)
    finally:
        db.close()
