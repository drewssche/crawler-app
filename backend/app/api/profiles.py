from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.core.paging import build_paged_response, paginate_query
from app.db.session import get_db
from app.db.models.profile import Profile
from app.db.models.run import Run
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


@router.get("/summary")
def list_profiles_summary(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    last_run_sq = (
        db.query(
            Run.profile_id.label("profile_id"),
            func.max(Run.id).label("last_run_id"),
        )
        .group_by(Run.profile_id)
        .subquery()
    )
    runs_count_sq = (
        db.query(
            Run.profile_id.label("profile_id"),
            func.count(Run.id).label("runs_total"),
        )
        .group_by(Run.profile_id)
        .subquery()
    )
    rows = (
        db.query(
            Profile.id.label("id"),
            Profile.name.label("name"),
            Profile.start_url.label("start_url"),
            Profile.allowed_domains_csv.label("allowed_domains_csv"),
            Run.id.label("last_run_id"),
            Run.status.label("last_run_status"),
            Run.started_at.label("last_run_started_at"),
            Run.finished_at.label("last_run_finished_at"),
            Run.pages_total.label("last_run_pages_total"),
            Run.pages_changed.label("last_run_pages_changed"),
            func.coalesce(runs_count_sq.c.runs_total, 0).label("runs_total"),
        )
        .outerjoin(last_run_sq, last_run_sq.c.profile_id == Profile.id)
        .outerjoin(Run, Run.id == last_run_sq.c.last_run_id)
        .outerjoin(runs_count_sq, runs_count_sq.c.profile_id == Profile.id)
        .order_by(Profile.id.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "name": row.name,
            "start_url": row.start_url,
            "allowed_domains_csv": row.allowed_domains_csv,
            "runs_total": int(row.runs_total or 0),
            "last_run": None
            if row.last_run_id is None
            else {
                "id": row.last_run_id,
                "status": row.last_run_status,
                "started_at": row.last_run_started_at,
                "finished_at": row.last_run_finished_at,
                "pages_total": int(row.last_run_pages_total or 0),
                "pages_changed": int(row.last_run_pages_changed or 0),
            },
        }
        for row in rows
    ]


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
