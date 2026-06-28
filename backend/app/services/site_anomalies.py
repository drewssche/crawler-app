from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from app.db.models.page import Page
from app.db.models.crawl_persona import CrawlPersona
from app.db.models.run import Run


BASELINE_RUNS_REQUIRED = 3


@dataclass(frozen=True)
class RunMetrics:
    run_id: int
    pages_total: int
    pages_changed: int
    error_pages: int

    @property
    def change_rate(self) -> float:
        return self.pages_changed / self.pages_total if self.pages_total else 0.0

    @property
    def error_rate(self) -> float:
        return self.error_pages / self.pages_total if self.pages_total else 0.0


def _empty_result(successful_runs: int, persona: CrawlPersona | None = None) -> dict:
    return {
        "status": "insufficient_data",
        "severity": "info",
        "message": "Недостаточно данных для baseline.",
        "reasons": [],
        "successful_runs": successful_runs,
        "baseline_runs_required": BASELINE_RUNS_REQUIRED,
        "crawl_persona_id": persona.id if persona else None,
        "persona_key": persona.key if persona else None,
        "persona_label": persona.label if persona else None,
        "baseline": None,
        "latest": None,
    }


def evaluate_project_site_anomalies(db: Session, site_ids: list[int]) -> dict[int, dict]:
    if not site_ids:
        return {}

    default_personas = {
        persona.project_site_id: persona
        for persona in (
            db.query(CrawlPersona)
            .filter(
                CrawlPersona.project_site_id.in_(site_ids),
                CrawlPersona.is_default.is_(True),
            )
            .all()
        )
    }
    runs = (
        db.query(Run)
        .filter(
            Run.project_site_id.in_(site_ids),
            Run.status == "FINISHED",
        )
        .order_by(Run.project_site_id.asc(), Run.id.desc())
        .all()
    )
    selected_runs: dict[int, list[Run]] = defaultdict(list)
    successful_run_counts: dict[int, int] = defaultdict(int)
    for run in runs:
        default_persona = default_personas.get(run.project_site_id)
        default_persona_id = default_persona.id if default_persona else None
        if default_persona_id is not None and run.crawl_persona_id != default_persona_id:
            continue
        successful_run_counts[run.project_site_id] += 1
        if len(selected_runs[run.project_site_id]) < BASELINE_RUNS_REQUIRED + 1:
            selected_runs[run.project_site_id].append(run)

    run_ids = [run.id for site_runs in selected_runs.values() for run in site_runs]
    page_errors: dict[int, int] = {}
    if run_ids:
        page_errors = {
            run_id: int(error_pages or 0)
            for run_id, error_pages in (
                db.query(
                    Page.run_id,
                    func.sum(
                        case(
                            (
                                or_(
                                    Page.status_code >= 400,
                                    Page.fetch_error_code.is_not(None),
                                ),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                )
                .filter(Page.run_id.in_(run_ids))
                .group_by(Page.run_id)
                .all()
            )
        }

    results: dict[int, dict] = {}
    for site_id in site_ids:
        default_persona = default_personas.get(site_id)
        site_runs = selected_runs.get(site_id, [])
        if len(site_runs) < BASELINE_RUNS_REQUIRED + 1:
            results[site_id] = _empty_result(successful_run_counts[site_id], default_persona)
            continue

        metrics = [
            RunMetrics(
                run_id=run.id,
                pages_total=int(run.pages_total or 0),
                pages_changed=int(run.pages_changed or 0),
                error_pages=page_errors.get(run.id, 0),
            )
            for run in site_runs
        ]
        latest = metrics[0]
        baseline = metrics[1 : BASELINE_RUNS_REQUIRED + 1]
        baseline_pages = sum(row.pages_total for row in baseline) / len(baseline)
        baseline_change_rate = sum(row.change_rate for row in baseline) / len(baseline)
        baseline_error_rate = sum(row.error_rate for row in baseline) / len(baseline)

        reasons: list[dict] = []
        if baseline_pages >= 5 and latest.pages_total < baseline_pages * 0.7:
            drop_percent = round((1 - latest.pages_total / baseline_pages) * 100)
            reasons.append(
                {
                    "code": "coverage_drop",
                    "severity": "danger" if latest.pages_total < baseline_pages * 0.5 else "warning",
                    "message": f"Количество страниц снизилось на {drop_percent}% относительно baseline.",
                }
            )

        error_threshold = max(0.1, baseline_error_rate * 2, baseline_error_rate + 0.1)
        if latest.pages_total >= 5 and latest.error_rate >= error_threshold:
            reasons.append(
                {
                    "code": "http_errors_growth",
                    "severity": "danger" if latest.error_rate >= 0.3 else "warning",
                    "message": f"Доля HTTP-ошибок выросла до {latest.error_rate * 100:.1f}%.",
                }
            )

        change_threshold = max(0.5, baseline_change_rate * 2, baseline_change_rate + 0.2)
        if latest.pages_total >= 5 and latest.change_rate >= change_threshold:
            reasons.append(
                {
                    "code": "changes_spike",
                    "severity": "danger" if latest.change_rate >= 0.8 else "warning",
                    "message": f"Необычно много изменений: {latest.change_rate * 100:.1f}% страниц.",
                }
            )

        severity = (
            "danger"
            if any(reason["severity"] == "danger" for reason in reasons)
            else "warning" if reasons else "info"
        )
        results[site_id] = {
            "status": "anomaly" if reasons else "normal",
            "severity": severity,
            "message": reasons[0]["message"] if reasons else "Отклонений от baseline не обнаружено.",
            "reasons": reasons,
            "successful_runs": successful_run_counts[site_id],
            "baseline_runs_required": BASELINE_RUNS_REQUIRED,
            "crawl_persona_id": default_persona.id if default_persona else None,
            "persona_key": default_persona.key if default_persona else None,
            "persona_label": default_persona.label if default_persona else None,
            "baseline": {
                "runs": BASELINE_RUNS_REQUIRED,
                "pages_average": round(baseline_pages, 1),
                "change_rate": round(baseline_change_rate, 4),
                "error_rate": round(baseline_error_rate, 4),
            },
            "latest": {
                "run_id": latest.run_id,
                "pages_total": latest.pages_total,
                "pages_changed": latest.pages_changed,
                "change_rate": round(latest.change_rate, 4),
                "error_pages": latest.error_pages,
                "error_rate": round(latest.error_rate, 4),
            },
        }
    return results
