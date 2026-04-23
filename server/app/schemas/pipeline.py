from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

PipelineState = Literal["in_progress", "completed", "failed"]


class PipelineStartRequest(BaseModel):
    original_resume_id: str | None = Field(default=None, max_length=200)
    resume_text: str | None = Field(default=None, max_length=100000)
    ats_threshold: int = Field(default=80, ge=1, le=100)


class PipelineStartResponse(BaseModel):
    run_id: str
    job_id: str
    state: PipelineState
    ats_threshold: int
    started_at: datetime


class PipelineStatusResponse(BaseModel):
    run_id: str
    job_id: str
    state: PipelineState
    ats_score: int
    ats_threshold: int
    iteration: int
    max_iterations: int
    updated_at: datetime
