import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.profiles import router as profiles_router
from app.api.runs import router as runs_router
from app.core.security import hash_password
from app.db.models.user import User
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
    admin_email = os.getenv("ADMIN_EMAIL")
    admin_password = os.getenv("ADMIN_PASSWORD")

    if not admin_email or not admin_password:
        return

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == admin_email).first()
        if existing:
            existing.role = "admin"
            existing.is_admin = True
            existing.is_approved = True
            db.commit()
            return

        admin = User(
            email=admin_email,
            hashed_password=hash_password(admin_password),
            role="admin",
            is_admin=True,
            is_approved=True,
        )
        db.add(admin)
        db.commit()
    finally:
        db.close()
