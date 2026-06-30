from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.db.models.crawl_persona import CrawlPersona
from app.db.models.crawler_run_job import CrawlerRunJob
from app.db.models.project import Project
from app.db.models.project_schedule import ProjectSchedule
from app.db.models.project_site import ProjectSite
from app.db.models.run import Run
from app.services.crawl_personas import get_default_persona
from app.services.crawler_jobs import enqueue_site_run_job, find_active_site_job


SCHEDULE_FREQUENCIES = {"daily", "weekly"}
WEEKDAYS = set(range(7))


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def normalize_timezone(value: str) -> str:
    normalized = (value or "").strip() or "UTC"
    try:
        ZoneInfo(normalized)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_timezone",
                "message": "Timezone должен быть валидным IANA значением, например Europe/Minsk или UTC.",
                "timezone": normalized,
            },
        ) from exc
    return normalized


def normalize_frequency(value: str) -> str:
    normalized = (value or "").strip().lower() or "daily"
    if normalized not in SCHEDULE_FREQUENCIES:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_schedule_frequency",
                "message": "Расписание поддерживает daily или weekly.",
            },
        )
    return normalized


def normalize_time_of_day(value: str) -> str:
    raw = (value or "").strip()
    try:
        hour_raw, minute_raw = raw.split(":", 1)
        hour = int(hour_raw)
        minute = int(minute_raw)
    except (ValueError, AttributeError) as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_schedule_time",
                "message": "Время запуска должно быть в формате HH:MM.",
            },
        ) from exc
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_schedule_time",
                "message": "Время запуска должно быть в диапазоне 00:00–23:59.",
            },
        )
    return f"{hour:02d}:{minute:02d}"


def normalize_weekdays(values: list[int] | None, *, frequency: str) -> list[int]:
    if frequency == "daily":
        return []
    cleaned_set: set[int] = set()
    for value in values or []:
        try:
            number = int(value)
        except (TypeError, ValueError):
            continue
        if number in WEEKDAYS:
            cleaned_set.add(number)
    cleaned = sorted(cleaned_set)
    if not cleaned:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_schedule_weekdays",
                "message": "Для weekly нужно выбрать хотя бы один день недели.",
            },
        )
    return cleaned


def weekdays_to_csv(values: list[int]) -> str:
    return ",".join(str(value) for value in values)


def weekdays_from_csv(value: str | None) -> list[int]:
    result: list[int] = []
    for item in (value or "").split(","):
        item = item.strip()
        if not item:
            continue
        try:
            number = int(item)
        except ValueError:
            continue
        if number in WEEKDAYS:
            result.append(number)
    return sorted(set(result))


def compute_next_run_at(
    *,
    frequency: str,
    time_of_day: str,
    weekdays: list[int],
    timezone_name: str,
    after: datetime | None = None,
) -> datetime:
    tz = ZoneInfo(normalize_timezone(timezone_name))
    normalized_frequency = normalize_frequency(frequency)
    normalized_time = normalize_time_of_day(time_of_day)
    hour, minute = (int(part) for part in normalized_time.split(":"))
    after_utc = (after or utcnow()).replace(tzinfo=timezone.utc)
    local_now = after_utc.astimezone(tz)
    target_time = time(hour=hour, minute=minute)
    candidate_day = local_now.date()
    normalized_weekdays = normalize_weekdays(weekdays, frequency=normalized_frequency)

    for offset in range(0, 15):
        day = candidate_day + timedelta(days=offset)
        if normalized_frequency == "weekly" and day.weekday() not in normalized_weekdays:
            continue
        candidate_local = datetime.combine(day, target_time, tzinfo=tz)
        if candidate_local <= local_now:
            continue
        return candidate_local.astimezone(timezone.utc).replace(tzinfo=None)

    raise HTTPException(
        status_code=422,
        detail={
            "code": "schedule_next_run_unavailable",
            "message": "Не удалось рассчитать следующий запуск расписания.",
        },
    )


def serialize_project_schedule(schedule: ProjectSchedule | None) -> dict:
    if schedule is None:
        return {
            "id": None,
            "project_id": None,
            "is_enabled": False,
            "frequency": "daily",
            "time_of_day": "09:00",
            "weekdays": [],
            "timezone": "UTC",
            "next_run_at": None,
            "last_run_at": None,
            "paused_at": None,
            "last_skip_reason": None,
            "created_at": None,
            "updated_at": None,
        }
    return {
        "id": schedule.id,
        "project_id": schedule.project_id,
        "is_enabled": schedule.is_enabled,
        "frequency": schedule.frequency,
        "time_of_day": schedule.time_of_day,
        "weekdays": weekdays_from_csv(schedule.weekdays_csv),
        "timezone": schedule.timezone,
        "next_run_at": schedule.next_run_at,
        "last_run_at": schedule.last_run_at,
        "paused_at": schedule.paused_at,
        "last_skip_reason": schedule.last_skip_reason,
        "created_at": schedule.created_at,
        "updated_at": schedule.updated_at,
    }


def get_project_schedule(db: Session, *, project_id: int) -> ProjectSchedule | None:
    return db.query(ProjectSchedule).filter(ProjectSchedule.project_id == project_id).first()


def upsert_project_schedule(
    db: Session,
    *,
    project_id: int,
    actor_user_id: int | None,
    is_enabled: bool,
    frequency: str,
    time_of_day: str,
    weekdays: list[int] | None,
    timezone_name: str,
    now: datetime | None = None,
) -> ProjectSchedule:
    current_time = now or utcnow()
    normalized_frequency = normalize_frequency(frequency)
    normalized_time = normalize_time_of_day(time_of_day)
    normalized_timezone = normalize_timezone(timezone_name)
    normalized_weekdays = normalize_weekdays(weekdays, frequency=normalized_frequency)
    schedule = get_project_schedule(db, project_id=project_id)
    if schedule is None:
        schedule = ProjectSchedule(
            project_id=project_id,
            created_by_user_id=actor_user_id,
            created_at=current_time,
        )
        db.add(schedule)
    schedule.updated_by_user_id = actor_user_id
    schedule.is_enabled = bool(is_enabled)
    schedule.frequency = normalized_frequency
    schedule.time_of_day = normalized_time
    schedule.weekdays_csv = weekdays_to_csv(normalized_weekdays)
    schedule.timezone = normalized_timezone
    schedule.paused_at = None if is_enabled else (schedule.paused_at or current_time)
    schedule.last_skip_reason = None
    schedule.updated_at = current_time
    schedule.next_run_at = (
        compute_next_run_at(
            frequency=normalized_frequency,
            time_of_day=normalized_time,
            weekdays=normalized_weekdays,
            timezone_name=normalized_timezone,
            after=current_time,
        )
        if is_enabled
        else None
    )
    db.commit()
    db.refresh(schedule)
    return schedule


def pause_project_schedule(db: Session, *, schedule: ProjectSchedule, actor_user_id: int | None) -> ProjectSchedule:
    now = utcnow()
    schedule.is_enabled = False
    schedule.paused_at = now
    schedule.next_run_at = None
    schedule.updated_by_user_id = actor_user_id
    schedule.updated_at = now
    db.commit()
    db.refresh(schedule)
    return schedule


def resume_project_schedule(db: Session, *, schedule: ProjectSchedule, actor_user_id: int | None) -> ProjectSchedule:
    now = utcnow()
    schedule.is_enabled = True
    schedule.paused_at = None
    schedule.next_run_at = compute_next_run_at(
        frequency=schedule.frequency,
        time_of_day=schedule.time_of_day,
        weekdays=weekdays_from_csv(schedule.weekdays_csv),
        timezone_name=schedule.timezone,
        after=now,
    )
    schedule.updated_by_user_id = actor_user_id
    schedule.updated_at = now
    db.commit()
    db.refresh(schedule)
    return schedule


def project_has_active_work(db: Session, *, project_id: int) -> bool:
    active_run = (
        db.query(Run.id)
        .filter(Run.project_id == project_id, Run.status.in_(("CREATED", "RUNNING")))
        .first()
    )
    if active_run is not None:
        return True
    sites = db.query(ProjectSite.id).filter(ProjectSite.project_id == project_id).all()
    return any(find_active_site_job(db, project_site_id=row.id) is not None for row in sites)


def _persona_ready_for_schedule(persona: CrawlPersona | None) -> bool:
    if persona is None:
        return True
    if persona.kind == "guest":
        return True
    return bool(persona.has_secrets)


def run_due_schedules(db: Session, *, now: datetime | None = None) -> dict:
    current_time = now or utcnow()
    due = (
        db.query(ProjectSchedule)
        .filter(ProjectSchedule.is_enabled.is_(True), ProjectSchedule.next_run_at.isnot(None), ProjectSchedule.next_run_at <= current_time)
        .order_by(ProjectSchedule.next_run_at.asc(), ProjectSchedule.id.asc())
        .all()
    )
    results: list[dict] = []
    for schedule in due:
        project = db.get(Project, schedule.project_id)
        if project is None:
            continue
        enqueued_jobs: list[CrawlerRunJob] = []
        skip_reason: str | None = None
        if project_has_active_work(db, project_id=schedule.project_id):
            skip_reason = "active_run_or_job"
        else:
            sites = (
                db.query(ProjectSite)
                .filter(ProjectSite.project_id == schedule.project_id, ProjectSite.is_enabled.is_(True))
                .order_by(ProjectSite.sort_order.asc(), ProjectSite.id.asc())
                .all()
            )
            if not sites:
                skip_reason = "no_enabled_sites"
            for site in sites:
                persona = get_default_persona(db, site)
                if not _persona_ready_for_schedule(persona):
                    continue
                enqueued_jobs.append(enqueue_site_run_job(db, site=site, persona=persona, actor_user_id=schedule.updated_by_user_id))
            if sites and not enqueued_jobs:
                skip_reason = "no_ready_personas"
        schedule.last_run_at = current_time if enqueued_jobs else schedule.last_run_at
        schedule.last_skip_reason = skip_reason
        schedule.next_run_at = compute_next_run_at(
            frequency=schedule.frequency,
            time_of_day=schedule.time_of_day,
            weekdays=weekdays_from_csv(schedule.weekdays_csv),
            timezone_name=schedule.timezone,
            after=current_time,
        )
        schedule.updated_at = current_time
        db.commit()
        db.refresh(schedule)
        results.append(
            {
                "project_id": schedule.project_id,
                "schedule_id": schedule.id,
                "enqueued": len(enqueued_jobs),
                "skipped": skip_reason,
                "next_run_at": schedule.next_run_at,
            }
        )
    return {"ok": True, "checked": len(due), "results": results}
