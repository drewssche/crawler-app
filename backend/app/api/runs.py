import hashlib
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.paging import build_paged_response, paginate_query
from app.db.models.page import Page
from app.db.models.profile import Profile
from app.db.models.run import Run
from app.db.session import get_db

router = APIRouter(prefix="/runs", tags=["runs"])


@router.post("/start/{profile_id}")
def start_run(profile_id: int, db: Session = Depends(get_db)):
    profile = db.get(Profile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    run = Run(profile_id=profile_id, status="RUNNING", started_at=datetime.utcnow())
    db.add(run)
    db.commit()
    db.refresh(run)

    url = profile.start_url
    try:
        with httpx.Client(follow_redirects=True, timeout=20) as client:
            resp = client.get(url)

        ct = resp.headers.get("content-type", "")
        html = resp.text if "text/html" in ct else ""
        h = hashlib.sha256(html.encode("utf-8", errors="ignore")).hexdigest()

        page = Page(
            run_id=run.id,
            url=str(resp.url),
            status_code=resp.status_code,
            content_type=ct,
            html=html,
            html_hash=h,
        )
        db.add(page)

        run.pages_total = 1
        run.status = "FINISHED"
        run.finished_at = datetime.utcnow()
        db.commit()
    except Exception:
        run.status = "FAILED"
        run.finished_at = datetime.utcnow()
        db.commit()
        raise

    return {"ok": True, "run_id": run.id}


@router.get("/by-profile/{profile_id}")
def list_runs(
    profile_id: int,
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
):
    query = db.query(Run).filter(Run.profile_id == profile_id).order_by(Run.id.desc())
    paged = paginate_query(query, page=page, page_size=page_size)
    if page is None:
        return paged
    items, total, safe_page, safe_page_size = paged
    return build_paged_response(items=items, total=total, page=safe_page, page_size=safe_page_size)


@router.get("/{run_id}/pages")
def list_pages(
    run_id: int,
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
):
    query = db.query(Page).filter(Page.run_id == run_id).order_by(Page.id.asc())
    paged = paginate_query(query, page=page, page_size=page_size)
    if page is None:
        return paged
    items, total, safe_page, safe_page_size = paged
    return build_paged_response(items=items, total=total, page=safe_page, page_size=safe_page_size)
