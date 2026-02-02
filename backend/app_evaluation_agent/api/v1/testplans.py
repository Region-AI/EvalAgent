import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app_evaluation_agent.schemas.testplan import TestPlanDetail
from app_evaluation_agent.services import testcases as testcase_service
from app_evaluation_agent.storage.database import get_db_session

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/{plan_id}", response_model=TestPlanDetail)
async def get_test_plan(plan_id: int, db: AsyncSession = Depends(get_db_session)):
    plan = await testcase_service.get_test_plan_by_id(db, plan_id)
    if not plan:
        logger.debug("Test plan %s not found", plan_id)
        raise HTTPException(status_code=404, detail="Test plan not found")

    # Ensure test cases are loaded
    cases = plan.test_cases if hasattr(plan, "test_cases") else []

    return TestPlanDetail(
        id=plan.id,
        evaluation_id=plan.evaluation_id,
        status=plan.status,
        summary=plan.summary,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
        test_cases=cases,
    )
