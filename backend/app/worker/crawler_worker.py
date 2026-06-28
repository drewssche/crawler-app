import logging
import os
import signal
import time

from app.api.runs import process_next_worker_job
from app.db.session import SessionLocal
from app.services.crawler_jobs import crawler_worker_enabled


logger = logging.getLogger(__name__)


def _bounded_float_env(name: str, *, default: float, minimum: float, maximum: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return max(minimum, min(value, maximum))


def _bounded_int_env(name: str, *, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(minimum, min(value, maximum))


def crawler_worker_poll_seconds() -> float:
    return _bounded_float_env("CRAWLER_WORKER_POLL_SECONDS", default=2.0, minimum=0.2, maximum=60.0)


def crawler_worker_tick_limit() -> int:
    return _bounded_int_env("CRAWLER_WORKER_TICK_LIMIT", default=0, minimum=0, maximum=1_000_000)


def run_worker_loop() -> int:
    if not crawler_worker_enabled():
        logger.error("CRAWLER_WORKER_ENABLED is not enabled; refusing to start crawler worker loop.")
        return 2

    stop_requested = False

    def _request_stop(_signum, _frame) -> None:
        nonlocal stop_requested
        stop_requested = True

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    poll_seconds = crawler_worker_poll_seconds()
    tick_limit = crawler_worker_tick_limit()
    ticks = 0
    logger.info("crawler worker loop started poll_seconds=%s tick_limit=%s", poll_seconds, tick_limit or "unlimited")

    while not stop_requested:
        with SessionLocal() as db:
            result = process_next_worker_job(db)
        ticks += 1
        if result.get("processed"):
            logger.info(
                "crawler worker processed job_id=%s run_id=%s status=%s",
                result.get("job_id"),
                result.get("run_id"),
                result.get("status"),
            )
        else:
            time.sleep(poll_seconds)
        if tick_limit and ticks >= tick_limit:
            logger.info("crawler worker tick limit reached: %s", tick_limit)
            break

    logger.info("crawler worker loop stopped")
    return 0


def main() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    raise SystemExit(run_worker_loop())


if __name__ == "__main__":
    main()
