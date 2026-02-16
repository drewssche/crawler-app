from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import require_admin_user
from app.db.models.user import User
from app.db.session import get_db

router = APIRouter(prefix="/admin", tags=["admin"])


class ApproveUserIn(BaseModel):
    role: Literal["editor", "viewer"]


@router.get("/users")
def list_users(status: str = "pending", db: Session = Depends(get_db), _admin: User = Depends(require_admin_user)):
    query = db.query(User)
    if status == "pending":
        query = query.filter(User.is_approved.is_(False))
    users = query.order_by(User.id.asc()).all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "role": u.role,
            "is_approved": u.is_approved,
        }
        for u in users
    ]


@router.post("/users/{user_id}/approve")
def approve_user(
    user_id: int,
    payload: ApproveUserIn,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_user),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.role = payload.role
    user.is_approved = True
    user.is_admin = False
    db.commit()
    return {"ok": True, "id": user.id, "role": user.role, "is_approved": user.is_approved}
