from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.core.paging import build_paged_response, paginate_query
from app.db.session import get_db
from app.db.models.profile import Profile
from app.db.models.user import User
from app.schemas.profile import ProfileCreate, ProfileOut

router = APIRouter(prefix="/profiles", tags=["profiles"])


@router.get("")
def list_profiles(
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    query = db.query(Profile).order_by(Profile.id.desc())
    paged = paginate_query(query, page=page, page_size=page_size)
    if page is None:
        return paged
    items, total, safe_page, safe_page_size = paged
    return build_paged_response(items=items, total=total, page=safe_page, page_size=safe_page_size)


@router.post("", response_model=ProfileOut)
def create_profile(
    payload: ProfileCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    obj = Profile(**payload.model_dump(mode="json"))
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/{profile_id}", response_model=ProfileOut)
def get_profile(profile_id: int, db: Session = Depends(get_db)):
    obj = db.get(Profile, profile_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Profile not found")
    return obj


@router.delete("/{profile_id}")
def delete_profile(
    profile_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    obj = db.get(Profile, profile_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Profile not found")
    db.delete(obj)
    db.commit()
    return {"ok": True}
