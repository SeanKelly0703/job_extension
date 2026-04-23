from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class JobRecord:
    id: str
    source_url: str
    page_title: str
    source_site: str
    job_description: str
    metadata: dict[str, Any]
    created_at: datetime = field(default_factory=utcnow)


@dataclass
class PipelineRunRecord:
    run_id: str
    job_id: str
    ats_threshold: int
    ats_score: int = 45
    iteration: int = 0
    max_iterations: int = 5
    state: str = "in_progress"
    updated_at: datetime = field(default_factory=utcnow)

    def advance(self) -> None:
        if self.state != "in_progress":
            return
        self.iteration += 1
        self.ats_score = min(100, self.ats_score + 12)
        if self.ats_score >= self.ats_threshold:
            self.state = "completed"
        elif self.iteration >= self.max_iterations:
            self.state = "failed"
        self.updated_at = utcnow()


class PipelineService:
    def __init__(self) -> None:
        self.jobs: dict[str, JobRecord] = {}
        self.runs: dict[str, PipelineRunRecord] = {}

    def ingest_job(self, payload: dict[str, Any]) -> JobRecord:
        job_id = f"job_{uuid4().hex[:12]}"
        record = JobRecord(
            id=job_id,
            source_url=payload["source_url"],
            page_title=payload["page_title"],
            source_site=payload["source_site"],
            job_description=payload["job_description"],
            metadata=payload.get("metadata", {}),
        )
        self.jobs[job_id] = record
        return record

    def start_pipeline(self, job_id: str, ats_threshold: int) -> PipelineRunRecord:
        if job_id not in self.jobs:
            raise KeyError("job_not_found")
        run_id = f"run_{uuid4().hex[:12]}"
        run = PipelineRunRecord(run_id=run_id, job_id=job_id, ats_threshold=ats_threshold)
        self.runs[run_id] = run
        return run

    def get_run(self, run_id: str) -> PipelineRunRecord:
        run = self.runs.get(run_id)
        if not run:
            raise KeyError("run_not_found")
        run.advance()
        return run


pipeline_service = PipelineService()
