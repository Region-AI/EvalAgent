import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app_evaluation_agent.services import testcases as testcase_service
from app_evaluation_agent.storage.models import (
    Base,
    App,
    AppType,
    AppVersion,
    Evaluation,
    EvaluationStatus,
    TestCase,
    TestCaseStatus,
    TestPlan,
    TestPlanStatus,
)

pytest.importorskip("aiosqlite")


async def _create_app_version(db_session: AsyncSession) -> AppVersion:
    app = App(name="Test App", app_type=AppType.DESKTOP_APP)
    db_session.add(app)
    await db_session.commit()
    await db_session.refresh(app)

    app_version = AppVersion(
        app_id=app.id,
        version="1.0.0",
        artifact_uri="s3://mock-app-builds/test-app",
    )
    db_session.add(app_version)
    await db_session.commit()
    await db_session.refresh(app_version)
    return app_version


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    await engine.dispose()


@pytest.mark.asyncio
async def test_next_test_case_assigns_unassigned_case(db_session: AsyncSession):
    executor_id = "worker-1"

    app_version = await _create_app_version(db_session)
    evaluation = Evaluation(
        app_version_id=app_version.id,
        status=EvaluationStatus.READY,
        execution_mode="local",
    )
    db_session.add(evaluation)
    await db_session.commit()
    await db_session.refresh(evaluation)

    plan = TestPlan(
        evaluation_id=evaluation.id,
        status=TestPlanStatus.READY,
        summary={"goal": "demo"},
    )
    db_session.add(plan)
    await db_session.commit()
    await db_session.refresh(plan)

    case = TestCase(
        plan_id=plan.id,
        evaluation_id=evaluation.id,
        name="Case 1",
        status=TestCaseStatus.PENDING,
        execution_order=1,
    )
    db_session.add(case)
    await db_session.commit()

    fetched = await testcase_service.next_test_case_for_executor(
        db_session, executor_id
    )

    assert fetched is not None
    assert fetched.id == case.id
    assert fetched.status == TestCaseStatus.ASSIGNED
    assert fetched.assigned_executor_id == executor_id


@pytest.mark.asyncio
async def test_next_test_case_respects_existing_assignment(db_session: AsyncSession):
    executor_id = "worker-1"
    other_executor = "worker-2"

    app_version = await _create_app_version(db_session)
    evaluation = Evaluation(
        app_version_id=app_version.id,
        status=EvaluationStatus.READY,
        execution_mode="local",
    )
    db_session.add(evaluation)
    await db_session.commit()
    await db_session.refresh(evaluation)

    plan = TestPlan(
        evaluation_id=evaluation.id,
        status=TestPlanStatus.READY,
        summary={"goal": "demo"},
    )
    db_session.add(plan)
    await db_session.commit()
    await db_session.refresh(plan)

    # Case for other executor
    other_case = TestCase(
        plan_id=plan.id,
        evaluation_id=evaluation.id,
        name="Case other",
        status=TestCaseStatus.PENDING,
        execution_order=1,
        assigned_executor_id=other_executor,
    )
    db_session.add(other_case)

    # Case unassigned should be picked up by executor_id
    case = TestCase(
        plan_id=plan.id,
        evaluation_id=evaluation.id,
        name="Case mine",
        status=TestCaseStatus.PENDING,
        execution_order=2,
    )
    db_session.add(case)
    await db_session.commit()

    fetched = await testcase_service.next_test_case_for_executor(
        db_session, executor_id
    )

    assert fetched is not None
    assert fetched.name == "Case mine"
    assert fetched.assigned_executor_id == executor_id


@pytest.mark.asyncio
async def test_next_test_case_handles_stringified_list_assignment(
    db_session: AsyncSession,
):
    executor_id = "worker-1"

    app_version = await _create_app_version(db_session)
    evaluation = Evaluation(
        app_version_id=app_version.id,
        status=EvaluationStatus.READY,
        execution_mode="local",
    )
    db_session.add(evaluation)
    await db_session.commit()
    await db_session.refresh(evaluation)

    plan = TestPlan(
        evaluation_id=evaluation.id,
        status=TestPlanStatus.READY,
        summary={"goal": "demo"},
    )
    db_session.add(plan)
    await db_session.commit()
    await db_session.refresh(plan)

    case = TestCase(
        plan_id=plan.id,
        evaluation_id=evaluation.id,
        name="Case string list",
        status=TestCaseStatus.PENDING,
        execution_order=1,
        assigned_executor_id='["worker-1"]',  # legacy stored as stringified list
    )
    db_session.add(case)
    await db_session.commit()

    fetched = await testcase_service.next_test_case_for_executor(
        db_session, executor_id
    )

    assert fetched is not None
    assert fetched.id == case.id
    assert fetched.assigned_executor_id == executor_id
