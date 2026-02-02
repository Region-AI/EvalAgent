import asyncio
import logging
import random
from typing import Sequence, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app_evaluation_agent.storage.database import AsyncSessionLocal
from app_evaluation_agent.storage.models import Evaluation, EvaluationStatus
from app_evaluation_agent.realtime import notify_evaluation_status
from .planner import PlannerAgent

logger = logging.getLogger(__name__)


class CoordinatorAgent:
    """
    Coordinates planner + summarizer agents to prepare execution.
    """

    @classmethod
    async def bootstrap_plan_and_cases(
        cls,
        db: AsyncSession,
        evaluation: Evaluation,
        executor_ids: Sequence[str] | None,
    ) -> Tuple:
        """
        Immediately generate a test plan and test cases for the evaluation.
        """
        try:
            logger.info(
                "Bootstrapping test plan for evaluation %s (goal=%r, executors=%s)",
                evaluation.id,
                evaluation.high_level_goal,
                list(executor_ids or []),
            )
            plan = await PlannerAgent.generate_test_plan(db, evaluation)
            test_cases = await PlannerAgent.generate_test_cases(db, plan, evaluation)
            logger.info(
                "Generated %s test cases for plan %s (evaluation %s)",
                len(test_cases),
                plan.id,
                evaluation.id,
            )
            if executor_ids:
                for tc in test_cases:
                    tc.assigned_executor_id = random.choice(executor_ids)
                await db.commit()
                for tc in test_cases:
                    await db.refresh(tc)
                logger.debug(
                    "Assigned executors to %s test cases for plan %s: candidates=%s",
                    len(test_cases),
                    plan.id,
                    list(executor_ids),
                )
            evaluation.status = EvaluationStatus.READY
            await db.commit()
            await db.refresh(evaluation)
            await notify_evaluation_status(evaluation)
            logger.info(
                "Evaluation %s prepared with test plan %s and test cases",
                evaluation.id,
                plan.id,
            )
            return plan, test_cases
        except Exception:  # noqa: BLE001
            logger.exception(
                "Failed to bootstrap test plan for evaluation %s", evaluation.id
            )
            await db.rollback()
            evaluation.status = EvaluationStatus.FAILED
            await db.commit()
            await db.refresh(evaluation)
            await notify_evaluation_status(evaluation)
            return (), ()

    @classmethod
    def launch_bootstrap_plan_and_cases(
        cls, evaluation_id: int, executor_ids: Sequence[str] | None
    ) -> None:
        """
        Fire-and-forget bootstrap of plan + test cases so API responses
        can return immediately after DB insert.
        """

        async def _run():
            async with AsyncSessionLocal() as db:
                try:
                    eval_obj = await db.get(Evaluation, evaluation_id)
                    if not eval_obj:
                        logger.error(
                            "Bootstrap aborted; evaluation %s not found", evaluation_id
                        )
                        return
                    await cls.bootstrap_plan_and_cases(db, eval_obj, executor_ids)
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "Error bootstrapping test plan for evaluation %s", evaluation_id
                    )

        asyncio.create_task(_run())
