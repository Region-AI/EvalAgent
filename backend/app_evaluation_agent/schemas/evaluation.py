from datetime import datetime
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app_evaluation_agent.schemas.app_version import AppVersionRead
from app_evaluation_agent.schemas.testcase import TestCaseRead
from app_evaluation_agent.storage.models import EvaluationStatus

AppTypeLiteral = Literal["desktop_app", "web_app"]


class EvaluationBase(BaseModel):
    app_version_id: int
    high_level_goal: Optional[str] = None
    # When true, the runner should attach to the user's current screen instead of launching from an artifact.
    run_on_current_screen: bool = False

    # Accept AppType enum from ORM and coerce to its string value
    @field_validator("app_version_id", mode="before")
    def _normalize_app_version_id(cls, v):
        if isinstance(v, str) and v.isdigit():
            return int(v)
        return v


class EvaluationCreate(BaseModel):
    # Existing app identifier.
    app_id: Optional[int] = None

    # New app attributes (used when app_id is not supplied).
    app_name: Optional[str] = None
    app_type: AppTypeLiteral = "desktop_app"

    # The app version label (unique per app).
    app_version: str

    # The artifact URI or web URL for this version.
    app_path: Optional[str] = None
    app_url: Optional[str] = None

    @field_validator("app_type", mode="before")
    def _normalize_app_type(cls, v):
        if hasattr(v, "value"):
            return v.value
        return v

    # The execution mode ('cloud' or 'local').
    execution_mode: str = "cloud"

    # The unique ID of the machine for local execution.
    assigned_executor_id: Optional[str] = None

    # For local desktop-mode uploads (path on runner).
    local_application_path: Optional[str] = None

    # Optional goal provided by the caller.
    high_level_goal: Optional[str] = None

    # Use the client's current screen (skip app launch/upload).
    run_on_current_screen: bool = False

    # Executor IDs that may be selected when assigning test cases.
    executor_ids: List[str] = Field(
        ...,
        min_items=1,
        description="Candidate executor IDs; tasks will be distributed randomly across this list.",
    )


class EvaluationRead(EvaluationBase):
    id: int
    status: EvaluationStatus
    created_at: datetime
    updated_at: Optional[datetime] = None
    execution_mode: str
    assigned_executor_id: Optional[str] = None
    results: Optional[dict] = None
    app_path: Optional[str] = None
    app_url: Optional[str] = None
    app_version: Optional[AppVersionRead] = None
    app_name: Optional[str] = None

    # This ensures the client receives the local path when it polls for a job.
    local_application_path: Optional[str] = None

    # Coerce Enums to their values when validating/serializing response
    # and allow constructing from SQLAlchemy objects.
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class EvaluationUpdate(BaseModel):
    status: EvaluationStatus
    results: Optional[dict] = None


class EvaluationSummaryUpdate(BaseModel):
    summary: Any = Field(
        ..., description="Replacement summary payload for the evaluation results."
    )


class EvaluationForVersionCreate(BaseModel):
    execution_mode: str = "cloud"
    assigned_executor_id: Optional[str] = None
    local_application_path: Optional[str] = None
    high_level_goal: Optional[str] = None
    run_on_current_screen: bool = False
    executor_ids: List[str] = Field(
        ...,
        min_items=1,
        description="Candidate executor IDs; tasks will be distributed randomly across this list.",
    )


class EvaluationWithTasksRead(EvaluationRead):
    tasks: List[TestCaseRead] = Field(default_factory=list)
    selectable_executor_ids: List[str] = Field(default_factory=list)
