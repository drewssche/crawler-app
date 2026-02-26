import os
import logging

from fastapi import FastAPI
from app.core.app_lifecycle import lifespan
from app.core.app_wiring import register_cors, register_http_stack, register_routers

logger = logging.getLogger(__name__)
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

app = FastAPI(title="Crawler API", lifespan=lifespan)
register_routers(app)
register_cors(app)
register_http_stack(app, logger)
