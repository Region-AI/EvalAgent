import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app_evaluation_agent.schemas.testcase import (
    TestCaseCreate,
    TestCaseRead,
    TestCaseUpdate,
)
from app_evaluation_agent.services import testcases as testcase_service
from app_evaluation_agent.storage.database import get_db_session
from app_evaluation_agent.storage.models import TestCaseStatus

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/next", response_model=Optional[TestCaseRead], status_code=200)
async def get_next_test_case(
    executor_id: str, db: AsyncSession = Depends(get_db_session)
):
    """
    Assigns the next pending test case for the given executor.
    Returns 204 when none are available.
    """
    case = await testcase_service.next_test_case_for_executor(db, executor_id)
    if not case:
        return Response(status_code=204)
    return case


@router.post("/", response_model=TestCaseRead, status_code=201)
async def create_test_case(
    payload: TestCaseCreate, db: AsyncSession = Depends(get_db_session)
):
    """
    Create a new test case under the specified plan/evaluation.
    """
    try:
        case = await testcase_service.create_test_case(
            db=db,
            plan_id=payload.plan_id,
            evaluation_id=payload.evaluation_id,
            name=payload.name,
            description=payload.description,
            input_data=payload.input_data,
            execution_order=payload.execution_order,
            assigned_executor_id=payload.assigned_executor_id,
        )
        return case
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/{case_id}", response_model=TestCaseRead)
async def update_test_case(
    case_id: int, update: TestCaseUpdate, db: AsyncSession = Depends(get_db_session)
):
    """
    Update a test case status/result.
    """
    status = update.status
    if isinstance(status, str):
        status = TestCaseStatus(status)

    updated = await testcase_service.update_test_case(
        db,
        case_id=case_id,
        status=status,
        result_payload=update.result,
        assigned_executor_id=update.assigned_executor_id,
        name=update.name,
        description=update.description,
        input_data=update.input_data,
        execution_order=update.execution_order,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Test case not found")
    return updated


@router.delete("/{case_id}", status_code=204)
async def delete_test_case(case_id: int, db: AsyncSession = Depends(get_db_session)):
    """
    Delete a test case by ID.
    """
    deleted = await testcase_service.delete_test_case(db, case_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Test case not found")
    return Response(status_code=204)
