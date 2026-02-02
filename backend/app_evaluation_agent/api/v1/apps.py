import logging
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app_evaluation_agent.schemas.app import AppCreate, AppRead, AppUpdate
from app_evaluation_agent.schemas.app_version import (
    AppVersionCreate,
    AppVersionGraph,
    AppVersionRead,
    AppVersionUpdate,
)
from app_evaluation_agent.schemas.bug import BugRead
from app_evaluation_agent.schemas.evaluation import (
    EvaluationForVersionCreate,
    EvaluationRead,
    EvaluationWithTasksRead,
)
from app_evaluation_agent.services import apps as app_service
from app_evaluation_agent.services import bugs as bug_service
from app_evaluation_agent.services import evaluations as evaluation_service
from app_evaluation_agent.storage.database import get_db_session

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("", response_model=list[AppRead])
async def list_apps(
    app_type: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db_session),
):
    return await app_service.list_apps(
        db=db, app_type=app_type, search=search, limit=limit, offset=offset
    )


@router.post("", response_model=AppRead, status_code=201)
async def create_app(payload: AppCreate, db: AsyncSession = Depends(get_db_session)):
    try:
        return await app_service.create_app(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{app_id}", response_model=AppRead)
async def get_app(app_id: int, db: AsyncSession = Depends(get_db_session)):
    app = await app_service.get_app(db, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="App not found")
    return app


@router.patch("/{app_id}", response_model=AppRead)
async def update_app(
    app_id: int,
    payload: AppUpdate,
    db: AsyncSession = Depends(get_db_session),
):
    try:
        app = await app_service.update_app(db, app_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not app:
        raise HTTPException(status_code=404, detail="App not found")
    return app


@router.delete("/{app_id}", status_code=204)
async def delete_app(app_id: int, db: AsyncSession = Depends(get_db_session)):
    deleted = await app_service.delete_app(db, app_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="App not found")
    return None


@router.get("/{app_id}/versions", response_model=list[AppVersionRead])
async def list_app_versions(
    app_id: int,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db_session),
):
    return await app_service.list_app_versions(
        db=db, app_id=app_id, limit=limit, offset=offset
    )


@router.get("/{app_id}/bugs", response_model=list[BugRead])
async def list_bugs_for_app(
    app_id: int,
    status: str | None = None,
    severity_level: str | None = None,
    app_version_id: int | None = None,
    evaluation_id: int | None = None,
    test_case_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db_session),
):
    app = await app_service.get_app(db, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="App not found")
    try:
        return await bug_service.list_bugs_for_app(
            db,
            app_id=app_id,
            status=status,
            severity_level=severity_level,
            app_version_id=app_version_id,
            evaluation_id=evaluation_id,
            test_case_id=test_case_id,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{app_id}/versions/graph", response_model=AppVersionGraph)
async def get_app_versions_graph(
    app_id: int, db: AsyncSession = Depends(get_db_session)
):
    app = await app_service.get_app(db, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="App not found")
    return await app_service.list_app_versions_graph(db=db, app_id=app_id)


@router.post("/{app_id}/versions", response_model=AppVersionRead, status_code=201)
async def create_app_version(
    app_id: int,
    version: str = Form(...),
    app_url: str | None = Form(None),
    app_path: str | None = Form(None),
    previous_version_id: int | None = Form(None),
    previous_version_ids: list[int] | None = Form(None),
    release_date: datetime | None = Form(None),
    change_log: str | None = Form(None),
    file: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db_session),
):
    if file and (app_url or app_path):
        raise HTTPException(
            status_code=400,
            detail="Provide only one of file, app_url, or app_path.",
        )
    if not file and not app_url and not app_path:
        raise HTTPException(
            status_code=400, detail="Provide file, app_url, or app_path."
        )
    if previous_version_id is not None and previous_version_ids is not None:
        raise HTTPException(
            status_code=400,
            detail="Provide either previous_version_id or previous_version_ids.",
        )

    try:
        if file:
            return await app_service.create_app_version_from_upload(
                db=db,
                app_id=app_id,
                version=version,
                file=file,
                previous_version_id=previous_version_id,
                previous_version_ids=previous_version_ids,
                release_date=release_date,
                change_log=change_log,
            )
        payload = AppVersionCreate(
            app_id=app_id,
            version=version,
            artifact_uri=app_path,
            app_url=app_url,
            previous_version_id=previous_version_id,
            previous_version_ids=previous_version_ids,
            release_date=release_date,
            change_log=change_log,
        )
        return await app_service.create_app_version(db, app_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{app_id}/versions/{version_id}", response_model=AppVersionRead)
async def get_app_version(
    app_id: int, version_id: int, db: AsyncSession = Depends(get_db_session)
):
    version = await app_service.get_app_version(db, app_id, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="App version not found")
    return version


@router.patch("/{app_id}/versions/{version_id}", response_model=AppVersionRead)
async def update_app_version(
    app_id: int,
    version_id: int,
    payload: AppVersionUpdate,
    db: AsyncSession = Depends(get_db_session),
):
    try:
        version = await app_service.update_app_version(db, app_id, version_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not version:
        raise HTTPException(status_code=404, detail="App version not found")
    return version


@router.delete("/{app_id}/versions/{version_id}", status_code=204)
async def delete_app_version(
    app_id: int, version_id: int, db: AsyncSession = Depends(get_db_session)
):
    deleted = await app_service.delete_app_version(db, app_id, version_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="App version not found")
    return None


@router.get(
    "/{app_id}/versions/{version_id}/evaluations",
    response_model=list[EvaluationRead],
)
async def list_version_evaluations(
    app_id: int,
    version_id: int,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db_session),
):
    version = await app_service.get_app_version(db, app_id, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="App version not found")
    return await app_service.list_evaluations_for_version(
        db=db, app_version_id=version_id, limit=limit, offset=offset
    )


@router.post(
    "/{app_id}/versions/{version_id}/evaluations",
    response_model=EvaluationWithTasksRead,
    status_code=202,
)
async def create_version_evaluation(
    app_id: int,
    version_id: int,
    payload: EvaluationForVersionCreate,
    db: AsyncSession = Depends(get_db_session),
):
    try:
        evaluation = await app_service.create_evaluation_for_version(
            db=db, app_id=app_id, version_id=version_id, payload=payload
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    evaluation_service.launch_bootstrap_plan_and_cases(
        evaluation.id, payload.executor_ids
    )
    return await evaluation_service.get_evaluation_with_tasks(
        db=db,
        evaluation=evaluation,
        selectable_executor_ids=payload.executor_ids,
    )
