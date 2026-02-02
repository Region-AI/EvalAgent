import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app_evaluation_agent.realtime import notify_evaluation_status
from app_evaluation_agent.schemas.bug import (
    BugCreate,
    BugOccurrenceCreate,
    BugUpdate,
)
from app_evaluation_agent.services import bugs as bug_service
from app_evaluation_agent.services.agents.bug_triage import BugTriageAgent
from app_evaluation_agent.services.evaluations import launch_summarization_for_plan
from app_evaluation_agent.storage.models import (
    AppVersion,
    Evaluation,
    EvaluationStatus,
    TestCase,
    TestCaseStatus,
)

logger = logging.getLogger(__name__)


async def get_test_plan_by_id(db: AsyncSession, plan_id: int):
    """
    Get TestPlan by ID.
    """
    from app_evaluation_agent.storage.models import TestPlan  # local import

    result = await db.execute(select(TestPlan).where(TestPlan.id == plan_id))
    return result.scalars().first()


async def create_test_case(
    db: AsyncSession,
    plan_id: int,
    evaluation_id: int,
    name: str,
    description: Optional[str] = None,
    input_data: Optional[dict] = None,
    execution_order: Optional[int] = None,
    assigned_executor_id: Optional[str] = None,
) -> TestCase:
    """
    Create a new test case under the given plan/evaluation.
    """
    # Validate plan exists and matches evaluation
    from app_evaluation_agent.storage.models import TestPlan

    plan = await db.get(TestPlan, plan_id)
    if not plan:
        raise ValueError(f"Plan {plan_id} not found")
    if plan.evaluation_id != evaluation_id:
        raise ValueError(
            f"Plan {plan_id} belongs to evaluation {plan.evaluation_id}, not {evaluation_id}"
        )

    case = TestCase(
        plan_id=plan_id,
        evaluation_id=evaluation_id,
        name=name,
        description=description,
        input_data=input_data,
        status=TestCaseStatus.PENDING,
        execution_order=execution_order,
        assigned_executor_id=assigned_executor_id,
    )
    db.add(case)
    await db.commit()
    await db.refresh(case)
    logger.info(
        "Created test case %s under plan %s (evaluation %s)",
        case.id,
        plan_id,
        evaluation_id,
    )
    return case


async def get_test_case(db: AsyncSession, case_id: int) -> Optional[TestCase]:
    """
    Fetch a single test case by ID.
    """
    result = await db.execute(select(TestCase).where(TestCase.id == case_id))
    return result.scalars().first()


async def next_test_case_for_executor(
    db: AsyncSession, executor_id: str
) -> Optional[TestCase]:
    """
    Fetch the next pending test case for a given executor, mark it as ASSIGNED,
    and return it. Pending cases are visible to all executors.
    """
    stmt = (
        select(TestCase)
        .join(Evaluation, Evaluation.id == TestCase.evaluation_id)
        .where(TestCase.status == TestCaseStatus.PENDING)
        # Prioritize older evaluations first, then execution order within each evaluation.
        .order_by(Evaluation.created_at, TestCase.execution_order, TestCase.id)
        .limit(1)
    )

    result = await db.execute(stmt)
    case = result.scalars().first()

    if case:
        case.status = TestCaseStatus.ASSIGNED
        case.assigned_executor_id = executor_id
        await db.commit()
        await db.refresh(case)
        logger.debug("Assigned test case %s to executor %s", case.id, executor_id)
        return case

    logger.debug("No pending test case for executor %s", executor_id)
    return None


async def delete_test_case(db: AsyncSession, case_id: int) -> bool:
    """
    Delete a single test case by ID.
    """
    case = await get_test_case(db, case_id)
    if not case:
        return False
    await db.delete(case)
    await db.commit()
    logger.info("Deleted test case %s", case_id)
    return True


async def update_test_case(
    db: AsyncSession,
    case_id: int,
    status: Optional[TestCaseStatus] = None,
    result_payload: Optional[dict] = None,
    assigned_executor_id: Optional[str] = None,
    name: Optional[str] = None,
    description: Optional[str] = None,
    input_data: Optional[dict] = None,
    execution_order: Optional[int] = None,
) -> Optional[TestCase]:
    """
    Update a test case:
        - status
        - result (payload)
        - assigned executor
        - name/description/input_data/execution_order

    If this completes the entire plan, summarization is triggered.
    """
    case = await get_test_case(db, case_id)
    if not case:
        return None

    evaluation = await db.get(Evaluation, case.evaluation_id)
    was_completed = evaluation and evaluation.status == EvaluationStatus.COMPLETED

    if status is not None:
        case.status = status
    if result_payload is not None:
        case.result = result_payload
    if assigned_executor_id is not None:
        case.assigned_executor_id = assigned_executor_id
    if name is not None:
        case.name = name
    if description is not None:
        case.description = description
    if input_data is not None:
        case.input_data = input_data
    if execution_order is not None:
        case.execution_order = execution_order

    await db.commit()
    await db.refresh(case)

    if result_payload is not None:
        await _maybe_triage_bugs(db, case, result_payload)

    if was_completed and evaluation:
        evaluation.status = EvaluationStatus.READY
        await db.commit()
        await db.refresh(evaluation)
        await notify_evaluation_status(evaluation)
        logger.info(
            "Evaluation %s moved to READY after test case %s update.",
            evaluation.id,
            case.id,
        )
        return case

    await _maybe_finalize_plan(db, case)
    return case


async def _load_evaluation_for_triage(
    db: AsyncSession, evaluation_id: int
) -> Optional[Evaluation]:
    stmt = (
        select(Evaluation)
        .where(Evaluation.id == evaluation_id)
        .options(selectinload(Evaluation.app_version).selectinload(AppVersion.app))
    )
    result = await db.execute(stmt)
    return result.scalars().first()


async def _maybe_triage_bugs(
    db: AsyncSession, case: TestCase, result_payload: dict
) -> None:
    if not isinstance(result_payload, dict):
        return

    evaluation = await _load_evaluation_for_triage(db, case.evaluation_id)
    if not evaluation or not evaluation.app_version or not evaluation.app_version.app:
        return

    app = evaluation.app_version.app
    case_status = getattr(case.status, "value", case.status)

    evaluation_context = {
        "evaluation_id": evaluation.id,
        "execution_mode": evaluation.execution_mode,
        "assigned_executor_id": evaluation.assigned_executor_id,
        "app_id": app.id,
        "app_name": app.name,
        "app_version_id": evaluation.app_version_id,
        "app_version": evaluation.app_version.version,
        "high_level_goal": evaluation.high_level_goal,
        "run_on_current_screen": evaluation.run_on_current_screen,
    }

    drafts = await BugTriageAgent.triage_test_case(
        app_id=app.id,
        case_name=case.name,
        case_description=case.description,
        case_status=str(case_status),
        result_payload=result_payload,
        evaluation_context=evaluation_context,
    )
    if not drafts:
        return

    for draft in drafts:
        bug = await bug_service.get_bug_by_fingerprint(db, app.id, draft.fingerprint)
        observed_at = draft.observed_at or datetime.now(timezone.utc)

        if bug:
            await bug_service.update_bug(
                db,
                bug.id,
                BugUpdate(last_seen_at=observed_at),
            )
        else:
            bug = await bug_service.create_bug(
                db,
                BugCreate(
                    app_id=app.id,
                    title=draft.title,
                    description=draft.description,
                    severity_level=draft.severity_level,
                    priority=draft.priority,
                    status=draft.status,
                    discovered_version_id=evaluation.app_version_id,
                    fingerprint=draft.fingerprint,
                    environment=draft.environment,
                    reproduction_steps=draft.reproduction_steps,
                    first_seen_at=observed_at,
                    last_seen_at=observed_at,
                ),
            )

        await bug_service.create_bug_occurrence(
            db,
            bug.id,
            BugOccurrenceCreate(
                evaluation_id=evaluation.id,
                test_case_id=case.id,
                app_version_id=evaluation.app_version_id,
                step_index=draft.step_index,
                action=draft.action,
                expected=draft.expected,
                actual=draft.actual,
                result_snapshot=draft.result_snapshot,
                screenshot_uri=draft.screenshot_uri,
                log_uri=draft.log_uri,
                raw_model_coords=draft.raw_model_coords,
                observed_at=observed_at,
                executor_id=evaluation.assigned_executor_id
                or case.assigned_executor_id,
            ),
        )


async def _maybe_finalize_plan(db: AsyncSession, case: TestCase) -> None:
    """
    When all test cases under a plan are finished (COMPLETED or FAILED),
    start summarization in the background.
    """

    # IMPORTANT:
    # Reload plan WITH relationships eager loaded, not via lazy loading.
    from app_evaluation_agent.storage.models import TestPlan

    stmt = (
        select(TestPlan)
        .where(TestPlan.id == case.plan_id)
        .options(
            selectinload(TestPlan.test_cases),
            selectinload(TestPlan.evaluation),
        )
    )
    result = await db.execute(stmt)
    plan = result.scalars().first()

    if not plan:
        return

    # cases are now eagerly loaded — NO lazy access, NO MissingGreenlet
    cases = plan.test_cases or []

    # Only proceed if all test cases ended
    if not all(
        tc.status in (TestCaseStatus.COMPLETED, TestCaseStatus.FAILED) for tc in cases
    ):
        return

    evaluation = plan.evaluation

    # Mark evaluation as summarizing before calling the summarizer
    if evaluation:
        evaluation.status = EvaluationStatus.SUMMARIZING
        await db.commit()
        await db.refresh(evaluation)
        await notify_evaluation_status(evaluation)
        logger.info(
            "Evaluation %s moved to SUMMARIZING before aggregation.",
            evaluation.id,
        )

    if evaluation:
        launch_summarization_for_plan(evaluation.id, plan.id)
