from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class AppVersionBase(BaseModel):
    app_id: int
    version: str
    artifact_uri: Optional[str] = None
    app_url: Optional[str] = None
    previous_version_id: Optional[int] = None
    previous_version_ids: Optional[list[int]] = None
    release_date: Optional[datetime] = None
    change_log: Optional[str] = None


class AppVersionCreate(AppVersionBase):
    pass


class AppVersionUpdate(BaseModel):
    version: Optional[str] = None
    artifact_uri: Optional[str] = None
    app_url: Optional[str] = None
    previous_version_id: Optional[int] = None
    previous_version_ids: Optional[list[int]] = None
    release_date: Optional[datetime] = None
    change_log: Optional[str] = None


class AppVersionRead(AppVersionBase):
    id: int
    previous_version_ids: list[int] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AppVersionGraphNode(BaseModel):
    id: int
    version: str
    previous_version_id: Optional[int] = None
    previous_version_ids: list[int] = Field(default_factory=list)
    release_date: Optional[datetime] = None
    change_log: Optional[str] = None


class AppVersionGraphEdge(BaseModel):
    from_id: int
    to_id: int


class AppVersionGraph(BaseModel):
    nodes: list[AppVersionGraphNode]
    edges: list[AppVersionGraphEdge]
    warnings: list[str] = []
