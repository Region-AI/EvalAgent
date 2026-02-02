import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from arq import create_pool

from app_evaluation_agent.api.v1 import evaluations as eval_api
from app_evaluation_agent.api.v1 import events as events_api
from app_evaluation_agent.api.v1 import apps as apps_api
from app_evaluation_agent.api.v1 import bugs as bugs_api
from app_evaluation_agent.api.v1 import vision as vision_api
from app_evaluation_agent.api.v1 import logs as logs_api
from app_evaluation_agent.api.v1 import testplans as testplans_api
from app_evaluation_agent.api.v1 import testcases as testcases_api
from app_evaluation_agent.logging_utils import configure_logging
from app_evaluation_agent.services.evaluations import (
    resume_pending_generations,
    resume_pending_summaries,
)
from app_evaluation_agent.worker import WorkerSettings, arq_pool

# Configure log persistence for uvicorn/FastAPI early in the import cycle.
configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # On startup, create the Redis connection pool
    global arq_pool
    logger.debug("Creating Redis connection pool for ARQ worker")
    arq_pool = await create_pool(WorkerSettings.redis_settings)
    logger.info("Redis connection pool created for ARQ worker")

    # Resume any evaluations that were left in SUMMARIZING
    try:
        await resume_pending_summaries()
    except Exception:
        logger.exception("Failed to resume pending summarizations on startup")

    # Resume any evaluations stuck in GENERATING
    try:
        await resume_pending_generations()
    except Exception:
        logger.exception("Failed to resume pending generations on startup")

    yield
    # On shutdown, close the pool
    logger.debug("Shutting down Redis connection pool for ARQ worker")
    await arq_pool.close()
    logger.info("Redis connection pool closed")


app = FastAPI(title="Eval Agent API", version="0.1.0", lifespan=lifespan)

# Include the apps router
app.include_router(apps_api.router, prefix="/api/v1/apps", tags=["Apps"])

# Include the bugs router
app.include_router(bugs_api.router, prefix="/api/v1/bugs", tags=["Bugs"])

# Include the evaluations router
app.include_router(eval_api.router, prefix="/api/v1/evaluations", tags=["Evaluations"])

# Include the log export router
app.include_router(logs_api.router, prefix="/api/v1/logs", tags=["Logs"])

# Include the events router
app.include_router(events_api.router, prefix="/api/v1/events", tags=["Events"])

# Include test plan router
app.include_router(
    testplans_api.router, prefix="/api/v1/testplans", tags=["Test Plans"]
)

# Include test case router
app.include_router(
    testcases_api.router, prefix="/api/v1/testcases", tags=["Test Cases"]
)

# Include the new vision router
app.include_router(
    vision_api.router,
    prefix="/api/v1/vision",
    tags=["Vision & Agent Control"],  # <-- Add the new router
)


@app.get("/")
def read_root():
    logger.debug("Root endpoint called")
    return {"message": "Eval Agent API is running."}
