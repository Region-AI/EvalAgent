import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

pytest.importorskip("aiosqlite")

from app_evaluation_agent.services import evaluations as evaluation_service
from app_evaluation_agent.storage.models import (
    App,
    AppType,
    AppVersion,
    Base,
    Evaluation,
    EvaluationStatus,
    TestCase,
    TestCaseStatus,
    TestPlan,
    TestPlanStatus,
)


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    await engine.dispose()


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


@pytest.mark.asyncio
async def test_delete_evaluation_removes_test_plans_and_cases(db_session: AsyncSession):
    app_version = await _create_app_version(db_session)
    evaluation = Evaluation(
        app_version_id=app_version.id,
        status=EvaluationStatus.PENDING,
        execution_mode="cloud",
    )
    db_session.add(evaluation)
    await db_session.commit()
    await db_session.refresh(evaluation)

    plan = TestPlan(
        evaluation_id=evaluation.id,
        status=TestPlanStatus.PENDING,
        summary={"goal": "demo"},
    )
    db_session.add(plan)
    await db_session.commit()
    await db_session.refresh(plan)

    case = TestCase(
        plan_id=plan.id,
        evaluation_id=evaluation.id,
        name="Case 1",
        description="ensure cascade delete removes me",
        input_data={},
        status=TestCaseStatus.PENDING,
        execution_order=1,
    )
    db_session.add(case)
    await db_session.commit()

    deleted = await evaluation_service.delete_evaluation(db_session, evaluation.id)

    assert deleted is True
    assert await db_session.get(Evaluation, evaluation.id) is None

    plans = (await db_session.execute(select(TestPlan))).scalars().all()
    cases = (await db_session.execute(select(TestCase))).scalars().all()
    assert plans == []
    assert cases == []


@pytest.mark.asyncio
async def test_delete_evaluation_returns_false_when_missing(db_session: AsyncSession):
    deleted = await evaluation_service.delete_evaluation(db_session, 9999)
    assert deleted is False
