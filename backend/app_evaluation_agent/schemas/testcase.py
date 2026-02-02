from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator

from app_evaluation_agent.storage.models import TestCaseStatus


class TestCaseBase(BaseModel):
    evaluation_id: int
    plan_id: int
    name: str
    description: Optional[str] = None
    input_data: Optional[dict] = None
    status: TestCaseStatus = TestCaseStatus.PENDING
    result: Optional[dict] = None
    execution_order: Optional[int] = None
    assigned_executor_id: Optional[str] = None

    @field_validator("status", mode="before")
    def _normalize_status(cls, v):
        if isinstance(v, TestCaseStatus):
            return v.value
        return v


class TestCaseCreate(TestCaseBase):
    pass


class TestCaseRead(TestCaseBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class TestCaseUpdate(BaseModel):
    status: Optional[TestCaseStatus] = None
    result: Optional[dict] = None
    assigned_executor_id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    input_data: Optional[dict] = None
    execution_order: Optional[int] = None
