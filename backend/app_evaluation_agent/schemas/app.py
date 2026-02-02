from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, field_validator

from app_evaluation_agent.storage.models import AppType

AppTypeLiteral = Literal["desktop_app", "web_app"]


class AppBase(BaseModel):
    name: str
    app_type: AppTypeLiteral = "desktop_app"

    @field_validator("app_type", mode="before")
    def _normalize_app_type(cls, v):
        if isinstance(v, AppType):
            return v.value
        return v


class AppCreate(AppBase):
    pass


class AppUpdate(BaseModel):
    name: Optional[str] = None
    app_type: Optional[AppTypeLiteral] = None

    @field_validator("app_type", mode="before")
    def _normalize_app_type(cls, v):
        if isinstance(v, AppType):
            return v.value
        return v


class AppRead(AppBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)
