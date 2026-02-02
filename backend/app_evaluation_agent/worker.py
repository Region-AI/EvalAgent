import asyncio
import logging

from arq import create_pool
from arq.connections import RedisSettings

from app_evaluation_agent.utils.config import settings
from app_evaluation_agent.storage.database import AsyncSessionLocal
from app_evaluation_agent.storage.models import (
    AppVersion,
    Evaluation,
    EvaluationStatus,
    AppType,
)
from app_evaluation_agent.realtime import notify_evaluation_status
from sqlalchemy.orm import selectinload

logger = logging.getLogger(__name__)

# This pool will be used by the FastAPI app to enqueue jobs
arq_pool = None


async def run_evaluation_task(ctx, evaluation_id: int):
    """
    This is the main background task.
    It simulates a long-running evaluation process.
    """
    logger.info("Starting evaluation for job ID: %s", evaluation_id)
    db = AsyncSessionLocal()
    try:
        # 1. Get the job from the DB and update its status
        evaluation = await db.get(
            Evaluation,
            evaluation_id,
            options=(
                selectinload(Evaluation.app_version).selectinload(AppVersion.app),
            ),
        )
        if not evaluation:
            logger.error("Evaluation %s not found", evaluation_id)
            return

        evaluation.status = EvaluationStatus.IN_PROGRESS
        await db.commit()
        await db.refresh(evaluation)
        await notify_evaluation_status(evaluation)

        # Branch by app type (demo/mock)
        app_type = None
        artifact = None
        app_version = None
        if evaluation.app_version:
            app_version = evaluation.app_version
            artifact = app_version.artifact_uri or app_version.app_url
            if app_version.app:
                app_type = app_version.app.app_type

        if app_type == AppType.DESKTOP_APP:
            logger.debug("[Desktop] Running mock agent workflow for %s", artifact)
        elif app_type == AppType.WEB_APP:
            logger.debug(
                "[Web] Running mock browser-based workflow for %s",
                artifact,
            )

        # 2. <<< PLACE REAL ORCHESTRATION HERE >>>
        await asyncio.sleep(5)
        logger.info("Mock workflow finished for evaluation %s", evaluation_id)

        # 3. Update status to completed
        evaluation.status = EvaluationStatus.COMPLETED
        await db.commit()
        await db.refresh(evaluation)
        await notify_evaluation_status(evaluation)
        logger.info("Evaluation %s completed successfully", evaluation_id)

    except Exception as e:
        # Handle failures
        logger.exception("Evaluation %s failed", evaluation_id)
        evaluation = await db.get(Evaluation, evaluation_id)
        if evaluation:
            evaluation.status = EvaluationStatus.FAILED
            await db.commit()
            await db.refresh(evaluation)
            await notify_evaluation_status(evaluation)
    finally:
        await db.close()

    return f"Evaluation {evaluation_id} processed."


# ARQ Worker Settings
class WorkerSettings:
    functions = [run_evaluation_task]
    redis_settings = RedisSettings(host=settings.redis.host, port=settings.redis.port)
