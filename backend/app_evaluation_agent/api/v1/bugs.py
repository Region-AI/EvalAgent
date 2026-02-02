import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app_evaluation_agent.schemas.bug import (
    BugCreate,
    BugFixCreate,
    BugFixRead,
    BugOccurrenceCreate,
    BugOccurrenceRead,
    BugRead,
    BugUpdate,
)
from app_evaluation_agent.services import bugs as bug_service
from app_evaluation_agent.storage.database import get_db_session

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/", response_model=BugRead, status_code=201)
async def create_bug(payload: BugCreate, db: AsyncSession = Depends(get_db_session)):
    try:
        return await bug_service.create_bug(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{bug_id}", response_model=BugRead)
async def get_bug(bug_id: int, db: AsyncSession = Depends(get_db_session)):
    bug = await bug_service.get_bug(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug not found")
    return bug


@router.patch("/{bug_id}", response_model=BugRead)
async def update_bug(
    bug_id: int, payload: BugUpdate, db: AsyncSession = Depends(get_db_session)
):
    try:
        bug = await bug_service.update_bug(db, bug_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not bug:
        raise HTTPException(status_code=404, detail="Bug not found")
    return bug


@router.delete("/{bug_id}", status_code=204)
async def delete_bug(bug_id: int, db: AsyncSession = Depends(get_db_session)):
    deleted = await bug_service.delete_bug(db, bug_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Bug not found")
    return Response(status_code=204)


@router.post("/{bug_id}/occurrences", response_model=BugOccurrenceRead, status_code=201)
async def create_bug_occurrence(
    bug_id: int,
    payload: BugOccurrenceCreate,
    db: AsyncSession = Depends(get_db_session),
):
    try:
        return await bug_service.create_bug_occurrence(db, bug_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{bug_id}/occurrences", response_model=list[BugOccurrenceRead])
async def list_bug_occurrences(
    bug_id: int,
    evaluation_id: Optional[int] = None,
    test_case_id: Optional[int] = None,
    app_version_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db_session),
):
    bug = await bug_service.get_bug(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug not found")
    return await bug_service.list_bug_occurrences(
        db,
        bug_id=bug_id,
        evaluation_id=evaluation_id,
        test_case_id=test_case_id,
        app_version_id=app_version_id,
        limit=limit,
        offset=offset,
    )


@router.post("/{bug_id}/fixes", response_model=BugFixRead, status_code=201)
async def create_bug_fix(
    bug_id: int, payload: BugFixCreate, db: AsyncSession = Depends(get_db_session)
):
    try:
        return await bug_service.create_bug_fix(db, bug_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{bug_id}/fixes", response_model=list[BugFixRead])
async def list_bug_fixes(bug_id: int, db: AsyncSession = Depends(get_db_session)):
    bug = await bug_service.get_bug(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug not found")
    return await bug_service.list_bug_fixes(db, bug_id)


@router.delete("/{bug_id}/fixes/{fix_id}", status_code=204)
async def delete_bug_fix(
    bug_id: int, fix_id: int, db: AsyncSession = Depends(get_db_session)
):
    deleted = await bug_service.delete_bug_fix(db, bug_id, fix_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Bug fix not found")
    return Response(status_code=204)
