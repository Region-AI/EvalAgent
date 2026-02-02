import logging
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app_evaluation_agent.schemas.bug import (
    BugCreate,
    BugFixCreate,
    BugOccurrenceCreate,
    BugUpdate,
)
from app_evaluation_agent.storage.models import (
    App,
    AppVersion,
    Bug,
    BugFix,
    BugOccurrence,
    BugSeverity,
    BugStatus,
    Evaluation,
    TestCase,
)

logger = logging.getLogger(__name__)


async def list_bugs_for_app(
    db: AsyncSession,
    app_id: int,
    status: Optional[str] = None,
    severity_level: Optional[str] = None,
    app_version_id: Optional[int] = None,
    evaluation_id: Optional[int] = None,
    test_case_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Bug]:
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    stmt = select(Bug).where(Bug.app_id == app_id)
    if status:
        stmt = stmt.where(Bug.status == BugStatus(status))
    if severity_level:
        stmt = stmt.where(Bug.severity_level == BugSeverity(severity_level))

    if app_version_id or evaluation_id or test_case_id:
        stmt = stmt.join(BugOccurrence)
        if app_version_id:
            stmt = stmt.where(BugOccurrence.app_version_id == app_version_id)
        if evaluation_id:
            stmt = stmt.where(BugOccurrence.evaluation_id == evaluation_id)
        if test_case_id:
            stmt = stmt.where(BugOccurrence.test_case_id == test_case_id)
        # Use DISTINCT ON to avoid JSON equality requirements in Postgres.
        stmt = stmt.distinct(Bug.id)

    stmt = stmt.order_by(Bug.id.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return result.scalars().all()


async def create_bug(db: AsyncSession, payload: BugCreate) -> Bug:
    app = await db.get(App, payload.app_id)
    if not app:
        raise ValueError("App not found")

    if payload.fingerprint:
        existing = await db.execute(
            select(Bug).where(
                Bug.app_id == payload.app_id, Bug.fingerprint == payload.fingerprint
            )
        )
        if existing.scalars().first():
            raise ValueError("Bug with this fingerprint already exists")

    if payload.discovered_version_id is not None:
        version = await db.get(AppVersion, payload.discovered_version_id)
        if not version or version.app_id != payload.app_id:
            raise ValueError("discovered_version_id must belong to the same app")

    bug = Bug(
        app_id=payload.app_id,
        title=payload.title,
        description=payload.description,
        severity_level=BugSeverity(payload.severity_level),
        priority=payload.priority,
        status=BugStatus(payload.status),
        discovered_version_id=payload.discovered_version_id,
        fingerprint=payload.fingerprint,
        environment=payload.environment,
        reproduction_steps=payload.reproduction_steps,
        first_seen_at=payload.first_seen_at,
        last_seen_at=payload.last_seen_at,
    )
    db.add(bug)
    await db.commit()
    await db.refresh(bug)
    logger.info("Created bug %s for app %s", bug.id, bug.app_id)
    return bug


async def get_bug(db: AsyncSession, bug_id: int) -> Bug | None:
    return await db.get(Bug, bug_id)


async def get_bug_by_fingerprint(
    db: AsyncSession, app_id: int, fingerprint: str
) -> Bug | None:
    if not fingerprint:
        return None
    result = await db.execute(
        select(Bug).where(Bug.app_id == app_id, Bug.fingerprint == fingerprint)
    )
    return result.scalars().first()


async def update_bug(db: AsyncSession, bug_id: int, payload: BugUpdate) -> Bug | None:
    bug = await db.get(Bug, bug_id)
    if not bug:
        return None

    if payload.title is not None:
        bug.title = payload.title
    if payload.description is not None:
        bug.description = payload.description
    if payload.severity_level is not None:
        bug.severity_level = BugSeverity(payload.severity_level)
    if payload.priority is not None:
        bug.priority = payload.priority
    if payload.status is not None:
        bug.status = BugStatus(payload.status)
    if payload.discovered_version_id is not None:
        version = await db.get(AppVersion, payload.discovered_version_id)
        if not version or version.app_id != bug.app_id:
            raise ValueError("discovered_version_id must belong to the same app")
        bug.discovered_version_id = payload.discovered_version_id
    if payload.fingerprint is not None:
        if payload.fingerprint != bug.fingerprint:
            existing = await db.execute(
                select(Bug).where(
                    Bug.app_id == bug.app_id, Bug.fingerprint == payload.fingerprint
                )
            )
            if existing.scalars().first():
                raise ValueError("Bug with this fingerprint already exists")
        bug.fingerprint = payload.fingerprint
    if payload.environment is not None:
        bug.environment = payload.environment
    if payload.reproduction_steps is not None:
        bug.reproduction_steps = payload.reproduction_steps
    if payload.first_seen_at is not None:
        bug.first_seen_at = payload.first_seen_at
    if payload.last_seen_at is not None:
        bug.last_seen_at = payload.last_seen_at

    await db.commit()
    await db.refresh(bug)
    return bug


async def delete_bug(db: AsyncSession, bug_id: int) -> bool:
    bug = await db.get(Bug, bug_id)
    if not bug:
        return False
    await db.execute(delete(BugOccurrence).where(BugOccurrence.bug_id == bug_id))
    await db.execute(delete(BugFix).where(BugFix.bug_id == bug_id))
    await db.execute(delete(Bug).where(Bug.id == bug_id))
    await db.commit()
    logger.info("Deleted bug %s", bug_id)
    return True


async def list_bug_occurrences(
    db: AsyncSession,
    bug_id: int,
    evaluation_id: Optional[int] = None,
    test_case_id: Optional[int] = None,
    app_version_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[BugOccurrence]:
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    stmt = select(BugOccurrence).where(BugOccurrence.bug_id == bug_id)
    if evaluation_id:
        stmt = stmt.where(BugOccurrence.evaluation_id == evaluation_id)
    if test_case_id:
        stmt = stmt.where(BugOccurrence.test_case_id == test_case_id)
    if app_version_id:
        stmt = stmt.where(BugOccurrence.app_version_id == app_version_id)
    stmt = stmt.order_by(BugOccurrence.id.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return result.scalars().all()


async def create_bug_occurrence(
    db: AsyncSession, bug_id: int, payload: BugOccurrenceCreate
) -> BugOccurrence:
    bug = await db.get(Bug, bug_id)
    if not bug:
        raise ValueError("Bug not found")

    evaluation: Evaluation | None = None
    if payload.evaluation_id is not None:
        evaluation = await db.get(Evaluation, payload.evaluation_id)
        if not evaluation:
            raise ValueError("Evaluation not found")
        version = await db.get(AppVersion, evaluation.app_version_id)
        if version and version.app_id != bug.app_id:
            raise ValueError("Evaluation app version does not match bug app")

    if payload.test_case_id is not None:
        test_case = await db.get(TestCase, payload.test_case_id)
        if not test_case:
            raise ValueError("Test case not found")
        if evaluation and test_case.evaluation_id != evaluation.id:
            raise ValueError("Test case does not belong to the evaluation")

    if payload.app_version_id is not None:
        version = await db.get(AppVersion, payload.app_version_id)
        if not version:
            raise ValueError("App version not found")
        if version.app_id != bug.app_id:
            raise ValueError("App version does not match bug app")
        if evaluation and evaluation.app_version_id != version.id:
            raise ValueError("App version does not match evaluation")

    occurrence = BugOccurrence(
        bug_id=bug_id,
        evaluation_id=payload.evaluation_id,
        test_case_id=payload.test_case_id,
        app_version_id=payload.app_version_id,
        step_index=payload.step_index,
        action=payload.action,
        expected=payload.expected,
        actual=payload.actual,
        result_snapshot=payload.result_snapshot,
        screenshot_uri=payload.screenshot_uri,
        log_uri=payload.log_uri,
        raw_model_coords=payload.raw_model_coords,
        observed_at=payload.observed_at,
        executor_id=payload.executor_id,
    )
    db.add(occurrence)
    await db.commit()
    await db.refresh(occurrence)
    logger.info("Created bug occurrence %s for bug %s", occurrence.id, bug_id)
    return occurrence


async def list_bug_fixes(db: AsyncSession, bug_id: int) -> list[BugFix]:
    stmt = select(BugFix).where(BugFix.bug_id == bug_id).order_by(BugFix.id.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


async def create_bug_fix(
    db: AsyncSession, bug_id: int, payload: BugFixCreate
) -> BugFix:
    bug = await db.get(Bug, bug_id)
    if not bug:
        raise ValueError("Bug not found")

    version = await db.get(AppVersion, payload.fixed_in_version_id)
    if not version:
        raise ValueError("App version not found")
    if version.app_id != bug.app_id:
        raise ValueError("Fixed version does not match bug app")

    if payload.verified_by_evaluation_id is not None:
        evaluation = await db.get(Evaluation, payload.verified_by_evaluation_id)
        if not evaluation:
            raise ValueError("Evaluation not found")

    existing = await db.execute(
        select(BugFix).where(
            BugFix.bug_id == bug_id,
            BugFix.fixed_in_version_id == payload.fixed_in_version_id,
        )
    )
    if existing.scalars().first():
        raise ValueError("Bug fix already recorded for this version")

    fix = BugFix(
        bug_id=bug_id,
        fixed_in_version_id=payload.fixed_in_version_id,
        verified_by_evaluation_id=payload.verified_by_evaluation_id,
        note=payload.note,
    )
    db.add(fix)
    await db.commit()
    await db.refresh(fix)
    logger.info("Created bug fix %s for bug %s", fix.id, bug_id)
    return fix


async def delete_bug_fix(db: AsyncSession, bug_id: int, fix_id: int) -> bool:
    fix = await db.get(BugFix, fix_id)
    if not fix or fix.bug_id != bug_id:
        return False
    await db.execute(delete(BugFix).where(BugFix.id == fix_id))
    await db.commit()
    logger.info("Deleted bug fix %s for bug %s", fix_id, bug_id)
    return True
