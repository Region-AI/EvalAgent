from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator

from app_evaluation_agent.storage.models import TestPlanStatus
from app_evaluation_agent.schemas.testcase import TestCaseRead  # circular safe import


class TestPlanBase(BaseModel):
    evaluation_id: int
    status: TestPlanStatus = TestPlanStatus.PENDING
    summary: Optional[dict] = None

    @field_validator("status", mode="before")
    def _normalize_status(cls, v):
        if isinstance(v, TestPlanStatus):
            return v.value
        return v


class TestPlanCreate(BaseModel):
    evaluation_id: int
    status: TestPlanStatus = TestPlanStatus.PENDING
    summary: Optional[dict] = None


class TestPlanRead(TestPlanBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class TestPlanDetail(TestPlanRead):
    test_cases: list[TestCaseRead] = []
