import logging
from datetime import datetime
from typing import Sequence

from fastapi import UploadFile
from sqlalchemy import delete, insert, select, update, or_, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app_evaluation_agent.integrations import s3_client, virus_scanner
from app_evaluation_agent.schemas.app import AppCreate, AppUpdate
from app_evaluation_agent.schemas.app_version import (
    AppVersionCreate,
    AppVersionGraph,
    AppVersionGraphEdge,
    AppVersionGraphNode,
    AppVersionUpdate,
)
from app_evaluation_agent.schemas.evaluation import (
    EvaluationCreate,
    EvaluationForVersionCreate,
)
from app_evaluation_agent.services import evaluations as evaluation_service
from app_evaluation_agent.storage.models import (
    App,
    AppType,
    AppVersion,
    Evaluation,
    TestCase,
    TestPlan,
    app_version_lineage,
)

logger = logging.getLogger(__name__)


async def list_apps(
    db: AsyncSession,
    app_type: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[App]:
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    stmt = select(App)
    if app_type:
        stmt = stmt.where(App.app_type == AppType(app_type))
    if search:
        stmt = stmt.where(App.name.ilike(f"%{search}%"))

    stmt = stmt.order_by(App.id.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return result.scalars().all()


async def create_app(db: AsyncSession, payload: AppCreate) -> App:
    existing = await db.execute(select(App).where(App.name == payload.name))
    if existing.scalars().first():
        raise ValueError("App name already exists")
    app = App(name=payload.name, app_type=AppType(payload.app_type))
    db.add(app)
    await db.commit()
    await db.refresh(app)
    logger.info("Created app %s (type=%s)", app.id, app.app_type)
    return app


async def get_app(db: AsyncSession, app_id: int) -> App | None:
    return await db.get(App, app_id)


async def update_app(db: AsyncSession, app_id: int, payload: AppUpdate) -> App | None:
    app = await db.get(App, app_id)
    if not app:
        return None

    if payload.name is not None:
        if payload.name != app.name:
            existing = await db.execute(select(App).where(App.name == payload.name))
            if existing.scalars().first():
                raise ValueError("App name already exists")
        app.name = payload.name
    if payload.app_type is not None:
        app.app_type = AppType(payload.app_type)

    await db.commit()
    await db.refresh(app)
    return app


async def list_app_versions(
    db: AsyncSession, app_id: int, limit: int = 50, offset: int = 0
) -> list[AppVersion]:
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    stmt = (
        select(AppVersion)
        .where(AppVersion.app_id == app_id)
        .order_by(AppVersion.created_at.desc(), AppVersion.id.desc())
        .limit(limit)
        .offset(offset)
        .options(selectinload(AppVersion.previous_versions))
    )
    result = await db.execute(stmt)
    return result.scalars().all()


async def list_app_versions_graph(db: AsyncSession, app_id: int) -> AppVersionGraph:
    stmt = (
        select(AppVersion)
        .where(AppVersion.app_id == app_id)
        .options(selectinload(AppVersion.previous_versions))
    )
    result = await db.execute(stmt)
    versions = result.scalars().all()
    nodes = [
        AppVersionGraphNode(
            id=version.id,
            version=version.version,
            previous_version_id=version.previous_version_id,
            previous_version_ids=version.previous_version_ids,
            release_date=version.release_date,
            change_log=version.change_log,
        )
        for version in versions
    ]
    edges: list[AppVersionGraphEdge] = []
    warnings: list[str] = []
    node_ids = {version.id for version in versions}
    for version in versions:
        for previous_version in version.previous_versions:
            if previous_version.id not in node_ids:
                warnings.append(
                    f"Version {version.id} references missing previous_version_id={previous_version.id}."
                )
                continue
            edges.append(
                AppVersionGraphEdge(
                    from_id=previous_version.id,
                    to_id=version.id,
                )
            )
    warnings.extend(_detect_version_cycles(versions))
    return AppVersionGraph(nodes=nodes, edges=edges, warnings=warnings)


def _detect_version_cycles(versions: Sequence[AppVersion]) -> list[str]:
    visited: set[int] = set()
    stack: set[int] = set()
    warnings: list[str] = []
    version_map = {version.id: version for version in versions}

    def visit(node_id: int) -> None:
        if node_id in stack:
            warnings.append(
                f"Cycle detected at version {node_id} in app_versions lineage."
            )
            return
        if node_id in visited:
            return
        visited.add(node_id)
        stack.add(node_id)
        version = version_map.get(node_id)
        if version:
            for previous_version in version.previous_versions:
                if previous_version.id in version_map:
                    visit(previous_version.id)
        stack.remove(node_id)

    for version in versions:
        visit(version.id)

    return warnings


def _coalesce_previous_version_ids(
    previous_version_id: int | None,
    previous_version_ids: Sequence[int] | None,
) -> list[int] | None:
    if previous_version_id is not None and previous_version_ids is not None:
        raise ValueError("Provide either previous_version_id or previous_version_ids")
    if previous_version_ids is not None:
        return list(previous_version_ids)
    if previous_version_id is not None:
        return [previous_version_id]
    return None


async def _resolve_previous_versions(
    db: AsyncSession,
    app_id: int,
    previous_version_ids: Sequence[int],
    current_version_id: int | None = None,
) -> list[AppVersion]:
    unique_ids: list[int] = []
    seen: set[int] = set()
    for version_id in previous_version_ids:
        if version_id <= 0:
            raise ValueError("previous_version_ids must be positive integers")
        if current_version_id is not None and version_id == current_version_id:
            raise ValueError("previous_version_ids cannot include the version itself")
        if version_id in seen:
            raise ValueError("previous_version_ids must be unique")
        seen.add(version_id)
        unique_ids.append(version_id)

    if not unique_ids:
        return []

    result = await db.execute(select(AppVersion).where(AppVersion.id.in_(unique_ids)))
    versions = result.scalars().all()
    if len(versions) != len(unique_ids):
        raise ValueError("previous_version_ids must reference existing versions")
    for version in versions:
        if version.app_id != app_id:
            raise ValueError(
                "previous_version_ids must reference versions that belong to this app"
            )
    return versions


async def create_app_version(
    db: AsyncSession,
    app_id: int,
    payload: AppVersionCreate,
) -> AppVersion:
    app = await db.get(App, app_id)
    if not app:
        raise ValueError(f"App {app_id} not found")
    previous_version_ids = _coalesce_previous_version_ids(
        payload.previous_version_id, payload.previous_version_ids
    )
    previous_versions: list[AppVersion] = []
    previous_version_id: int | None = payload.previous_version_id
    if previous_version_ids is not None:
        previous_versions = await _resolve_previous_versions(
            db, app_id, previous_version_ids
        )
        previous_version_id = previous_version_ids[0] if previous_version_ids else None
    existing = await db.execute(
        select(AppVersion).where(
            AppVersion.app_id == app_id, AppVersion.version == payload.version
        )
    )
    if existing.scalars().first():
        raise ValueError("Version already exists for this app")

    version = AppVersion(
        app_id=app.id,
        version=payload.version,
        artifact_uri=payload.artifact_uri,
        app_url=payload.app_url,
        previous_version_id=previous_version_id,
        release_date=payload.release_date,
        change_log=payload.change_log,
    )
    db.add(version)
    await db.flush()
    if previous_version_ids is not None:
        await db.execute(
            insert(app_version_lineage),
            [
                {
                    "app_version_id": version.id,
                    "previous_version_id": previous_version.id,
                }
                for previous_version in previous_versions
            ],
        )
    await db.commit()
    refreshed = await get_app_version(db, app_id, version.id)
    if refreshed is None:
        raise ValueError("App version not found after create")
    return refreshed


async def create_app_version_from_upload(
    db: AsyncSession,
    app_id: int,
    version: str,
    file: UploadFile,
    previous_version_id: int | None = None,
    previous_version_ids: Sequence[int] | None = None,
    release_date: datetime | None = None,
    change_log: str | None = None,
) -> AppVersion:
    app = await db.get(App, app_id)
    if not app:
        raise ValueError(f"App {app_id} not found")

    await virus_scanner.scan_file_stream(file)
    await file.seek(0)
    s3_uri = await s3_client.upload_file_stream_to_s3(file, file.filename)

    payload = AppVersionCreate(
        app_id=app_id,
        version=version,
        artifact_uri=s3_uri,
        previous_version_id=previous_version_id,
        previous_version_ids=(
            list(previous_version_ids) if previous_version_ids is not None else None
        ),
        release_date=release_date,
        change_log=change_log,
    )
    return await create_app_version(db, app_id, payload)


async def get_app_version(
    db: AsyncSession, app_id: int, version_id: int
) -> AppVersion | None:
    stmt = (
        select(AppVersion)
        .where(AppVersion.id == version_id, AppVersion.app_id == app_id)
        .options(selectinload(AppVersion.app))
        .options(selectinload(AppVersion.previous_versions))
    )
    result = await db.execute(stmt)
    return result.scalars().first()


async def update_app_version(
    db: AsyncSession, app_id: int, version_id: int, payload: AppVersionUpdate
) -> AppVersion | None:
    version = await get_app_version(db, app_id, version_id)
    if not version:
        return None

    if payload.version is not None:
        if payload.version != version.version:
            existing = await db.execute(
                select(AppVersion).where(
                    AppVersion.app_id == app_id,
                    AppVersion.version == payload.version,
                    AppVersion.id != version_id,
                )
            )
            if existing.scalars().first():
                raise ValueError("Version already exists for this app")
        version.version = payload.version
    if payload.artifact_uri is not None:
        version.artifact_uri = payload.artifact_uri
    if payload.app_url is not None:
        version.app_url = payload.app_url
    previous_version_ids = _coalesce_previous_version_ids(
        payload.previous_version_id, payload.previous_version_ids
    )
    if previous_version_ids is not None:
        await _ensure_no_lineage_cycle(db, version_id, previous_version_ids)
        previous_versions = await _resolve_previous_versions(
            db, app_id, previous_version_ids, current_version_id=version_id
        )
        await db.execute(
            delete(app_version_lineage).where(
                app_version_lineage.c.app_version_id == version_id
            )
        )
        if previous_versions:
            await db.execute(
                insert(app_version_lineage),
                [
                    {
                        "app_version_id": version_id,
                        "previous_version_id": previous_version.id,
                    }
                    for previous_version in previous_versions
                ],
            )
        version.previous_version_id = (
            previous_version_ids[0] if previous_version_ids else None
        )
    if payload.release_date is not None:
        version.release_date = payload.release_date
    if payload.change_log is not None:
        version.change_log = payload.change_log

    await db.commit()
    refreshed = await get_app_version(db, app_id, version_id)
    if refreshed is None:
        raise ValueError("App version not found after update")
    return refreshed


async def _ensure_no_lineage_cycle(
    db: AsyncSession, version_id: int, previous_version_ids: Sequence[int]
) -> None:
    if not previous_version_ids:
        return
    if version_id in previous_version_ids:
        raise ValueError("previous_version_ids cannot include the version itself")

    stmt = text("""
        WITH RECURSIVE ancestors(id) AS (
            SELECT previous_version_id
            FROM app_version_lineage
            WHERE app_version_id = ANY(:parent_ids)
            UNION
            SELECT avl.previous_version_id
            FROM app_version_lineage avl
            JOIN ancestors a ON avl.app_version_id = a.id
        )
        SELECT 1
        FROM ancestors
        WHERE id = :version_id
        LIMIT 1
        """)
    result = await db.execute(
        stmt,
        {
            "parent_ids": list(previous_version_ids),
            "version_id": version_id,
        },
    )
    if result.scalar_one_or_none() is not None:
        raise ValueError("previous_version_ids would create a lineage cycle")


async def delete_app_version(db: AsyncSession, app_id: int, version_id: int) -> bool:
    """
    Deletes an app version and its evaluations, plans, and cases.
    """
    version = await get_app_version(db, app_id, version_id)
    if not version:
        logger.debug(
            "App version %s for app %s not found during delete",
            version_id,
            app_id,
        )
        return False

    affected_result = await db.execute(
        select(app_version_lineage.c.app_version_id).where(
            app_version_lineage.c.previous_version_id == version_id
        )
    )
    affected_version_ids = [row[0] for row in affected_result.all()]

    await db.execute(
        delete(app_version_lineage).where(
            or_(
                app_version_lineage.c.app_version_id == version_id,
                app_version_lineage.c.previous_version_id == version_id,
            )
        )
    )

    await db.execute(
        update(AppVersion)
        .where(AppVersion.previous_version_id == version_id)
        .values(previous_version_id=None)
    )

    if affected_version_ids:
        remaining_result = await db.execute(
            select(
                app_version_lineage.c.app_version_id,
                app_version_lineage.c.previous_version_id,
            )
            .where(app_version_lineage.c.app_version_id.in_(affected_version_ids))
            .order_by(
                app_version_lineage.c.app_version_id,
                app_version_lineage.c.previous_version_id,
            )
        )
        replacement_map: dict[int, int] = {}
        for app_version_id, previous_version_id in remaining_result.all():
            if app_version_id not in replacement_map:
                replacement_map[app_version_id] = previous_version_id
        for app_version_id, previous_version_id in replacement_map.items():
            await db.execute(
                update(AppVersion)
                .where(AppVersion.id == app_version_id)
                .values(previous_version_id=previous_version_id)
            )

    eval_result = await db.execute(
        select(Evaluation.id).where(Evaluation.app_version_id == version_id)
    )
    evaluation_ids = [row[0] for row in eval_result.all()]

    if evaluation_ids:
        await db.execute(
            delete(TestCase).where(TestCase.evaluation_id.in_(evaluation_ids))
        )
        await db.execute(
            delete(TestPlan).where(TestPlan.evaluation_id.in_(evaluation_ids))
        )
        await db.execute(delete(Evaluation).where(Evaluation.id.in_(evaluation_ids)))

    await db.execute(delete(AppVersion).where(AppVersion.id == version_id))
    await db.commit()
    logger.info(
        "Deleted app version %s for app %s and associated evaluations",
        version_id,
        app_id,
    )
    return True


async def list_evaluations_for_version(
    db: AsyncSession, app_version_id: int, limit: int = 50, offset: int = 0
) -> list[Evaluation]:
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    stmt = (
        select(Evaluation)
        .where(Evaluation.app_version_id == app_version_id)
        .order_by(Evaluation.created_at.desc())
        .limit(limit)
        .offset(offset)
        .options(
            selectinload(Evaluation.app_version).selectinload(AppVersion.app),
            selectinload(Evaluation.app_version).selectinload(
                AppVersion.previous_versions
            ),
        )
    )
    result = await db.execute(stmt)
    return result.scalars().all()


async def create_evaluation_for_version(
    db: AsyncSession,
    app_id: int,
    version_id: int,
    payload: EvaluationForVersionCreate,
) -> Evaluation:
    version = await get_app_version(db, app_id, version_id)
    if not version or not version.app:
        raise ValueError("App version not found")

    evaluation_payload = EvaluationCreate(
        app_id=version.app_id,
        app_name=version.app.name,
        app_type=version.app.app_type.value,
        app_version=version.version,
        app_path=version.artifact_uri,
        app_url=version.app_url,
        execution_mode=payload.execution_mode,
        assigned_executor_id=payload.assigned_executor_id,
        local_application_path=payload.local_application_path,
        high_level_goal=payload.high_level_goal,
        run_on_current_screen=payload.run_on_current_screen,
        executor_ids=list(payload.executor_ids),
    )
    return await evaluation_service.create_evaluation(db, evaluation_payload)


async def delete_app(db: AsyncSession, app_id: int) -> bool:
    """
    Deletes an app and all associated versions, evaluations, plans, and cases.
    """
    app = await db.get(App, app_id)
    if not app:
        logger.debug("App %s not found during delete", app_id)
        return False

    versions_result = await db.execute(
        select(AppVersion.id).where(AppVersion.app_id == app_id)
    )
    version_ids = [row[0] for row in versions_result.all()]

    if version_ids:
        eval_result = await db.execute(
            select(Evaluation.id).where(Evaluation.app_version_id.in_(version_ids))
        )
        evaluation_ids = [row[0] for row in eval_result.all()]

        if evaluation_ids:
            await db.execute(
                delete(TestCase).where(TestCase.evaluation_id.in_(evaluation_ids))
            )
            await db.execute(
                delete(TestPlan).where(TestPlan.evaluation_id.in_(evaluation_ids))
            )
            await db.execute(
                delete(Evaluation).where(Evaluation.id.in_(evaluation_ids))
            )

        await db.execute(delete(AppVersion).where(AppVersion.id.in_(version_ids)))

    await db.execute(delete(App).where(App.id == app_id))
    await db.commit()
    logger.info("Deleted app %s and associated versions/evaluations", app_id)
    return True
