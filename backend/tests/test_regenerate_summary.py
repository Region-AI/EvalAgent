import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

pytest.importorskip("aiosqlite")

from app_evaluation_agent.services import evaluations as evaluation_service
from app_evaluation_agent.services.agents.summarizer import SummarizerAgent
from app_evaluation_agent.storage.models import (  # noqa: E402
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
async def test_regenerate_summary_updates_completed_evaluation(
    db_session: AsyncSession, monkeypatch
):
    app_version = await _create_app_version(db_session)
    evaluation = Evaluation(
        app_version_id=app_version.id,
        status=EvaluationStatus.COMPLETED,
        execution_mode="cloud",
        results={"summary": "old"},
    )
    db_session.add(evaluation)
    await db_session.commit()
    await db_session.refresh(evaluation)

    plan = TestPlan(
        evaluation_id=evaluation.id,
        status=TestPlanStatus.COMPLETED,
        summary={"goal": "demo"},
    )
    db_session.add(plan)
    await db_session.commit()
    await db_session.refresh(plan)

    case = TestCase(
        plan_id=plan.id,
        evaluation_id=evaluation.id,
        name="Case 1",
        description=None,
        input_data={},
        status=TestCaseStatus.COMPLETED,
        execution_order=1,
    )
    db_session.add(case)
    await db_session.commit()

    async def fake_summarize(db, plan_obj):
        eval_obj = plan_obj.evaluation
        eval_obj.results = {"summary": "regenerated"}
        await db.commit()
        await db.refresh(eval_obj)
        return eval_obj

    monkeypatch.setattr(
        SummarizerAgent,
        "summarize_evaluation",
        fake_summarize,
    )

    regenerated = await evaluation_service.regenerate_summary(db_session, evaluation.id)

    assert regenerated is not None
    assert regenerated.results == {"summary": "regenerated"}
    assert regenerated.status == EvaluationStatus.COMPLETED


@pytest.mark.asyncio
async def test_regenerate_summary_requires_completed_status(db_session: AsyncSession):
    app_version = await _create_app_version(db_session)
    evaluation = Evaluation(
        app_version_id=app_version.id,
        status=EvaluationStatus.READY,
        execution_mode="cloud",
    )
    db_session.add(evaluation)
    await db_session.commit()
    await db_session.refresh(evaluation)

    with pytest.raises(ValueError):
        await evaluation_service.regenerate_summary(db_session, evaluation.id)


@pytest.mark.asyncio
async def test_regenerate_summary_returns_none_for_missing_evaluation(
    db_session: AsyncSession,
):
    regenerated = await evaluation_service.regenerate_summary(db_session, 9999)
    assert regenerated is None
