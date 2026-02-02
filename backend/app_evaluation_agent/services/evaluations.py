import asyncio
import logging
from typing import Sequence

from fastapi import UploadFile
from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app_evaluation_agent.integrations import s3_client, virus_scanner
from app_evaluation_agent.services.agents.coordinator import CoordinatorAgent
from app_evaluation_agent.services.agents.planner import PlannerAgent
from app_evaluation_agent.services.agents.summarizer import SummarizerAgent
from app_evaluation_agent.schemas.evaluation import (
    EvaluationCreate,
    EvaluationUpdate,
    EvaluationWithTasksRead,
)
from app_evaluation_agent.schemas.testcase import TestCaseRead
from app_evaluation_agent.storage.database import AsyncSessionLocal
from app_evaluation_agent.storage.models import (
    App,
    AppType,
    AppVersion,
    Evaluation,
    EvaluationStatus,
    TestCase,
    TestPlan,
)
from app_evaluation_agent.realtime import notify_evaluation_status

logger = logging.getLogger(__name__)


def launch_bootstrap_plan_and_cases(
    evaluation_id: int, executor_ids: Sequence[str] | None
) -> None:
    """
    Fire-and-forget bootstrap of the plan + test cases for a new evaluation.
    """
    CoordinatorAgent.launch_bootstrap_plan_and_cases(evaluation_id, executor_ids)


async def get_evaluation(db: AsyncSession, evaluation_id: int):
    """Gets a single evaluation by its ID."""
    logger.debug("Fetching evaluation id=%s", evaluation_id)
    result = await db.execute(
        select(Evaluation)
        .where(Evaluation.id == evaluation_id)
        .options(
            selectinload(Evaluation.app_version).selectinload(AppVersion.app),
            selectinload(Evaluation.app_version).selectinload(
                AppVersion.previous_versions
            ),
        )
    )
    return result.scalars().first()


async def _get_app_or_error(
    db: AsyncSession,
    app_id: int | None,
    app_name: str | None,
    app_type: str,
) -> App:
    if app_id is not None:
        app = await db.get(App, app_id)
        if not app:
            raise ValueError(f"App {app_id} not found")
        return app

    if not app_name:
        raise ValueError("app_name is required when app_id is not provided")

    result = await db.execute(
        select(App).where(App.name == app_name, App.app_type == AppType(app_type))
    )
    existing = result.scalars().first()
    if existing:
        return existing
    raise ValueError(
        "App not found; create the app first before requesting an evaluation."
    )


async def _get_or_create_app_version(
    db: AsyncSession,
    app: App,
    version: str,
    app_path: str | None,
    app_url: str | None,
) -> AppVersion:
    if not version:
        raise ValueError("app_version is required")

    stmt = select(AppVersion).where(
        AppVersion.app_id == app.id, AppVersion.version == version
    )
    result = await db.execute(stmt)
    existing = result.scalars().first()
    if existing:
        updated = False
        if app_path and not existing.artifact_uri:
            existing.artifact_uri = app_path
            updated = True
        if app_url and not existing.app_url:
            existing.app_url = app_url
            updated = True
        if updated:
            await db.commit()
            await db.refresh(existing)
        return existing

    app_version = AppVersion(
        app_id=app.id,
        version=version,
        artifact_uri=app_path,
        app_url=app_url,
    )
    db.add(app_version)
    await db.commit()
    await db.refresh(app_version)
    logger.info("Created app version %s for app %s", app_version.id, app.id)
    return app_version


async def create_evaluation(
    db: AsyncSession, evaluation: EvaluationCreate
) -> Evaluation:
    """
    Creates a new evaluation record in the database from a schema.
    Supports both desktop (app_path) and web (app_url) use-cases.
    """
    logger.debug(
        "Creating evaluation: app=%s version=%s mode=%s executor=%s",
        evaluation.app_id or evaluation.app_name,
        evaluation.app_version,
        evaluation.execution_mode,
        evaluation.assigned_executor_id,
    )
    app = await _get_app_or_error(
        db=db,
        app_id=evaluation.app_id,
        app_name=evaluation.app_name,
        app_type=evaluation.app_type,
    )
    app_version = await _get_or_create_app_version(
        db=db,
        app=app,
        version=evaluation.app_version,
        app_path=evaluation.app_path,
        app_url=evaluation.app_url,
    )

    db_evaluation = Evaluation(
        app_version_id=app_version.id,
        status=EvaluationStatus.GENERATING,
        execution_mode=evaluation.execution_mode,
        assigned_executor_id=evaluation.assigned_executor_id,
        local_application_path=evaluation.local_application_path,
        high_level_goal=evaluation.high_level_goal,
        run_on_current_screen=evaluation.run_on_current_screen,
    )
    db.add(db_evaluation)
    await db.commit()
    await db.refresh(db_evaluation)
    await notify_evaluation_status(db_evaluation)
    logger.info(
        "Created evaluation %s (app=%s version=%s executor=%s goal=%r)",
        db_evaluation.id,
        app.id,
        app_version.version,
        db_evaluation.assigned_executor_id,
        db_evaluation.high_level_goal,
    )
    return db_evaluation


async def create_evaluation_from_upload(
    db: AsyncSession,
    file: UploadFile,
    execution_mode: str,
    executor_id: str | None,
    local_path: str | None,
    high_level_goal: str | None,
    executor_ids: Sequence[str],
    app_name: str,
    app_version: str,
    app_type: str,
) -> Evaluation:
    """
    Handles the full upload workflow: scan, store, and create a record.
    This is for DESKTOP APP executables only.
    """
    logger.debug(
        "Creating evaluation from upload: filename=%s app=%s version=%s mode=%s executor=%s local_path=%s",
        file.filename,
        app_name,
        app_version,
        execution_mode,
        executor_id,
        local_path,
    )
    # Security scan remains mandatory for all uploads.
    await virus_scanner.scan_file_stream(file)

    # Rewind the file stream after scanning before uploading to S3.
    await file.seek(0)

    # Store the executable in S3 for archival, as per the architecture.
    s3_uri = await s3_client.upload_file_stream_to_s3(file, file.filename)

    # Create a data schema including the S3 URI and the new local path.
    evaluation_data = EvaluationCreate(
        app_name=app_name,
        app_type=app_type,
        app_version=app_version,
        app_path=s3_uri,
        execution_mode=execution_mode,
        assigned_executor_id=executor_id,
        local_application_path=local_path,
        high_level_goal=high_level_goal,
        executor_ids=list(executor_ids),
    )

    return await create_evaluation(db, evaluation_data)


async def get_evaluation_with_tasks(
    db: AsyncSession,
    evaluation: Evaluation,
    selectable_executor_ids: Sequence[str] | None = None,
) -> EvaluationWithTasksRead:
    """
    Returns the evaluation along with its tasks and a selectable executor list.
    """
    stmt = (
        select(Evaluation)
        .where(Evaluation.id == evaluation.id)
        .options(
            selectinload(Evaluation.app_version).selectinload(AppVersion.app),
            selectinload(Evaluation.app_version).selectinload(
                AppVersion.previous_versions
            ),
        )
    )
    evaluation_result = await db.execute(stmt)
    evaluation = evaluation_result.scalars().first()
    if evaluation is None:
        raise ValueError("Evaluation not found")
    stmt = (
        select(TestCase)
        .where(TestCase.evaluation_id == evaluation.id)
        .order_by(TestCase.execution_order, TestCase.id)
    )
    result = await db.execute(stmt)
    cases = result.scalars().all()
    task_models = [TestCaseRead.model_validate(case) for case in cases]
    evaluation_with_tasks = EvaluationWithTasksRead.model_validate(evaluation)
    return evaluation_with_tasks.model_copy(
        update={
            "tasks": task_models,
            "selectable_executor_ids": list(selectable_executor_ids or []),
        }
    )


async def list_evaluations_for_executor(
    db: AsyncSession, executor_id: str | None = None, limit: int = 50, offset: int = 0
) -> list[Evaluation]:
    """
    Returns evaluations visible to all executors, ordered by newest first.
    """
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    stmt = (
        select(Evaluation)
        .options(
            selectinload(Evaluation.app_version).selectinload(AppVersion.app),
            selectinload(Evaluation.app_version).selectinload(
                AppVersion.previous_versions
            ),
        )
        .order_by(Evaluation.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()
    logger.debug(
        "Fetched %s evaluations for executor=%s (limit=%s offset=%s)",
        len(rows),
        executor_id,
        limit,
        offset,
    )
    return rows


async def update_evaluation(
    db: AsyncSession, evaluation_id: int, update_data: EvaluationUpdate
) -> Evaluation | None:
    """
    Updates an evaluation's status and results.
    """
    logger.debug(
        "Updating evaluation id=%s status=%s has_results=%s",
        evaluation_id,
        update_data.status,
        update_data.results is not None,
    )
    evaluation = await get_evaluation(db, evaluation_id)
    if not evaluation:
        logger.debug("Evaluation %s not found during update", evaluation_id)
        return None

    evaluation.status = update_data.status
    if update_data.results is not None:
        evaluation.results = update_data.results

    await db.commit()
    await db.refresh(evaluation)
    await notify_evaluation_status(evaluation)

    # If an external caller marks this evaluation as SUMMARIZING without results,
    # start summarization in the background.
    if (
        update_data.status == EvaluationStatus.SUMMARIZING
        and update_data.results is None
    ):
        stmt = (
            select(TestPlan)
            .where(TestPlan.evaluation_id == evaluation_id)
            .order_by(TestPlan.created_at)
            .options(
                selectinload(TestPlan.test_cases),
                selectinload(TestPlan.evaluation),
            )
            .limit(1)
        )
        plan_result = await db.execute(stmt)
        plan = plan_result.scalars().first()
        if plan:
            launch_summarization_for_plan(evaluation_id, plan.id)
            logger.info(
                "Evaluation %s summarization started via explicit SUMMARIZING update.",
                evaluation_id,
            )
        else:
            logger.warning(
                "Summary generation skipped; no plan found for evaluation %s",
                evaluation_id,
            )

    return evaluation


async def update_evaluation_summary(
    db: AsyncSession, evaluation_id: int, summary_payload
) -> Evaluation | None:
    """
    Updates an evaluation's summary inside results.
    """
    evaluation = await get_evaluation(db, evaluation_id)
    if not evaluation:
        logger.debug("Evaluation %s not found during summary update", evaluation_id)
        return None

    existing_results = evaluation.results
    if isinstance(existing_results, dict):
        results = dict(existing_results)
    else:
        results = {}
        if existing_results is not None:
            results["previous_results"] = existing_results

    results["summary"] = summary_payload
    evaluation.results = results

    await db.commit()
    await db.refresh(evaluation)
    logger.info("Updated summary for evaluation %s", evaluation_id)
    return evaluation


async def _run_summarization_for_plan(evaluation_id: int, plan_id: int) -> None:
    async with AsyncSessionLocal() as session:
        try:
            stmt = (
                select(TestPlan)
                .where(TestPlan.id == plan_id)
                .options(
                    selectinload(TestPlan.test_cases),
                    selectinload(TestPlan.evaluation),
                )
            )
            plan_result = await session.execute(stmt)
            plan = plan_result.scalars().first()
            if not plan:
                logger.error(
                    "Summary regeneration aborted; plan %s not found for evaluation %s",
                    plan_id,
                    evaluation_id,
                )
                return

            summary_eval = await SummarizerAgent.summarize_evaluation(session, plan)
            target_evaluation = summary_eval or plan.evaluation
            if target_evaluation:
                target_evaluation.status = EvaluationStatus.COMPLETED
                await session.commit()
                await session.refresh(target_evaluation)
                await notify_evaluation_status(target_evaluation)
                logger.info(
                    "Summarized evaluation %s via plan %s",
                    evaluation_id,
                    plan_id,
                )
        except Exception:
            logger.exception("Failed to summarize evaluation %s", evaluation_id)
            evaluation = await session.get(Evaluation, evaluation_id)
            if evaluation:
                evaluation.status = EvaluationStatus.COMPLETED
                await session.commit()
                await session.refresh(evaluation)
                await notify_evaluation_status(evaluation)


def launch_summarization_for_plan(evaluation_id: int, plan_id: int) -> None:
    asyncio.create_task(_run_summarization_for_plan(evaluation_id, plan_id))


async def regenerate_summary(db: AsyncSession, evaluation_id: int) -> Evaluation | None:
    """
    Start the summarization flow for an already completed evaluation.
    Returns immediately after moving the evaluation to SUMMARIZING.
    """
    evaluation = await get_evaluation(db, evaluation_id)
    if not evaluation:
        logger.debug(
            "Evaluation %s not found during summary regeneration", evaluation_id
        )
        return None

    if evaluation.status != EvaluationStatus.COMPLETED:
        raise ValueError(
            "Evaluation must be COMPLETED before regenerating the summary."
        )

    stmt = (
        select(TestPlan)
        .where(TestPlan.evaluation_id == evaluation_id)
        .order_by(TestPlan.created_at)
        .limit(1)
    )
    plan_result = await db.execute(stmt)
    plan = plan_result.scalars().first()
    if not plan:
        raise ValueError(
            "No test plan exists for this evaluation; cannot regenerate summary."
        )

    evaluation.status = EvaluationStatus.SUMMARIZING
    await db.commit()
    await db.refresh(evaluation)
    await notify_evaluation_status(evaluation)

    launch_summarization_for_plan(evaluation_id, plan.id)
    return evaluation


async def resume_pending_summaries() -> None:
    """
    On startup, resume any evaluations stuck in SUMMARIZING state by re-running
    the summarizer to completion.
    """
    async with AsyncSessionLocal() as db:
        stmt = (
            select(TestPlan)
            .join(Evaluation, Evaluation.id == TestPlan.evaluation_id)
            .where(Evaluation.status == EvaluationStatus.SUMMARIZING)
            .options(
                selectinload(TestPlan.test_cases),
                selectinload(TestPlan.evaluation),
            )
        )
        result = await db.execute(stmt)
        plans = result.scalars().all()

        if not plans:
            return

        logger.info(
            "Resuming summarization for %s evaluation(s) on startup.",
            len(plans),
        )

        for plan in plans:
            try:
                evaluation = await SummarizerAgent.summarize_evaluation(db, plan)
                if evaluation:
                    evaluation.status = EvaluationStatus.COMPLETED
                    await db.commit()
                    await db.refresh(evaluation)
                    await notify_evaluation_status(evaluation)
                    logger.info(
                        "Completed pending summarization for evaluation %s via plan %s",
                        evaluation.id,
                        plan.id,
                    )
            except Exception:
                logger.exception(
                    "Failed to resume summarization for plan %s (evaluation %s)",
                    plan.id,
                    getattr(plan, "evaluation_id", None),
                )


async def resume_pending_generations() -> None:
    """
    On startup, resume any evaluations stuck in GENERATING state by completing
    plan/test case generation and moving them to READY.
    """
    async with AsyncSessionLocal() as db:
        stmt = (
            select(Evaluation)
            .where(Evaluation.status == EvaluationStatus.GENERATING)
            .options(
                selectinload(Evaluation.test_plans).selectinload(TestPlan.test_cases),
            )
        )
        result = await db.execute(stmt)
        evaluations = result.scalars().all()

        if not evaluations:
            return

        logger.info(
            "Resuming plan generation for %s evaluation(s) on startup.",
            len(evaluations),
        )

        for evaluation in evaluations:
            try:
                plans = evaluation.test_plans or []
                plan = plans[0] if plans else None
                if not plan:
                    plan = await PlannerAgent.generate_test_plan(db, evaluation)
                cases_result = await db.execute(
                    select(TestCase).where(TestCase.plan_id == plan.id)
                )
                cases = cases_result.scalars().all()
                if not cases:
                    await PlannerAgent.generate_test_cases(db, plan, evaluation)

                evaluation.status = EvaluationStatus.READY
                await db.commit()
                await db.refresh(evaluation)
                await notify_evaluation_status(evaluation)
                logger.info(
                    "Completed generation for evaluation %s via plan %s",
                    evaluation.id,
                    plan.id,
                )
            except Exception:
                logger.exception(
                    "Failed to resume plan generation for evaluation %s",
                    evaluation.id,
                )


async def delete_evaluation(db: AsyncSession, evaluation_id: int) -> bool:
    """
    Deletes an evaluation and all related test plans and test cases.
    """
    evaluation = await get_evaluation(db, evaluation_id)
    if not evaluation:
        logger.debug("Evaluation %s not found during delete", evaluation_id)
        return False

    await db.execute(delete(TestCase).where(TestCase.evaluation_id == evaluation_id))
    await db.execute(delete(TestPlan).where(TestPlan.evaluation_id == evaluation_id))
    await db.execute(delete(Evaluation).where(Evaluation.id == evaluation_id))
    await db.commit()
    logger.info("Deleted evaluation %s and associated plans/cases", evaluation_id)
    return True
