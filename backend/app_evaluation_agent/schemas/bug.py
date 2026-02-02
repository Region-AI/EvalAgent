from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app_evaluation_agent.storage.models import BugSeverity, BugStatus


class BugBase(BaseModel):
    app_id: int = Field(..., description="Owning app ID.")
    title: str
    description: Optional[str] = None
    severity_level: BugSeverity = BugSeverity.P2
    priority: Optional[int] = None
    status: BugStatus = BugStatus.NEW
    discovered_version_id: Optional[int] = None
    fingerprint: Optional[str] = None
    environment: Optional[dict] = None
    reproduction_steps: Optional[dict] = None
    first_seen_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None

    @field_validator("severity_level", "status", mode="before")
    def _normalize_enums(cls, v):
        if hasattr(v, "value"):
            return v.value
        return v


class BugCreate(BugBase):
    pass


class BugUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity_level: Optional[BugSeverity] = None
    priority: Optional[int] = None
    status: Optional[BugStatus] = None
    discovered_version_id: Optional[int] = None
    fingerprint: Optional[str] = None
    environment: Optional[dict] = None
    reproduction_steps: Optional[dict] = None
    first_seen_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None

    @field_validator("severity_level", "status", mode="before")
    def _normalize_enums(cls, v):
        if hasattr(v, "value"):
            return v.value
        return v


class BugRead(BugBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class BugOccurrenceBase(BaseModel):
    evaluation_id: Optional[int] = None
    test_case_id: Optional[int] = None
    app_version_id: Optional[int] = None
    step_index: Optional[int] = None
    action: Optional[dict] = None
    expected: Optional[str] = None
    actual: Optional[str] = None
    result_snapshot: Optional[dict] = None
    screenshot_uri: Optional[str] = None
    log_uri: Optional[str] = None
    raw_model_coords: Optional[dict] = None
    observed_at: Optional[datetime] = None
    executor_id: Optional[str] = None


class BugOccurrenceCreate(BugOccurrenceBase):
    pass


class BugOccurrenceRead(BugOccurrenceBase):
    id: int
    bug_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class BugFixCreate(BaseModel):
    fixed_in_version_id: int
    verified_by_evaluation_id: Optional[int] = None
    note: Optional[str] = None


class BugFixRead(BugFixCreate):
    id: int
    bug_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)
