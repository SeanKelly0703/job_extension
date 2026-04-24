from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, HttpUrl


class JobIngestRequest(BaseModel):
    source_url: HttpUrl
    page_title: str = Field(default="", max_length=500)
    source_site: str = Field(default="", max_length=200)
    job_description: str = Field(min_length=50, max_length=20000)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PipelineStatusSnapshot(BaseModel):
    state: str
    ats_score: int
    ats_threshold: int
    iteration: int


class JobIngestResponse(BaseModel):
    job_id: str
    status: str
    pipeline_status: PipelineStatusSnapshot
    created_at: datetime


class JobSummary(BaseModel):
    job_id: str
    source_url: str
    page_title: str
    source_site: str
    created_at: datetime


class JobListResponse(BaseModel):
    items: list[JobSummary]
    count: int
