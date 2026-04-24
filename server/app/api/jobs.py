from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.job import (
    JobIngestRequest,
    JobIngestResponse,
    JobListResponse,
    JobSummary,
    PipelineStatusSnapshot,
)
from app.schemas.pipeline import (
    PipelineStartRequest,
    PipelineStartResponse,
    PipelineStatusResponse,
)
from app.services.pipeline_service import pipeline_service

router = APIRouter(prefix="/api/v1", tags=["jobs"])


@router.get("/jobs", response_model=JobListResponse)
def list_jobs(limit: int = Query(default=20, ge=1, le=100)) -> JobListResponse:
    records = pipeline_service.list_jobs(limit=limit)
    items = [
        JobSummary(
            job_id=record.id,
            source_url=record.source_url,
            page_title=record.page_title,
            source_site=record.source_site,
            created_at=record.created_at,
        )
        for record in records
    ]
    return JobListResponse(items=items, count=len(items))


@router.post("/jobs/ingest", response_model=JobIngestResponse, status_code=status.HTTP_201_CREATED)
def ingest_job(request: JobIngestRequest) -> JobIngestResponse:
    job = pipeline_service.ingest_job(request.model_dump(mode="json"))
    return JobIngestResponse(
        job_id=job.id,
        status="accepted",
        pipeline_status=PipelineStatusSnapshot(
            state="not_started",
            ats_score=0,
            ats_threshold=80,
            iteration=0,
        ),
        created_at=job.created_at,
    )


@router.post("/pipeline/{job_id}/start", response_model=PipelineStartResponse)
def start_pipeline(job_id: str, request: PipelineStartRequest) -> PipelineStartResponse:
    if not request.original_resume_id and not request.resume_text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Either original_resume_id or resume_text must be provided.",
        )
    try:
        run = pipeline_service.start_pipeline(job_id=job_id, ats_threshold=request.ats_threshold)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found.",
        ) from error

    return PipelineStartResponse(
        run_id=run.run_id,
        job_id=run.job_id,
        state=run.state,
        ats_threshold=run.ats_threshold,
        started_at=run.updated_at,
    )


@router.get("/pipeline/{run_id}/status", response_model=PipelineStatusResponse)
def get_pipeline_status(run_id: str) -> PipelineStatusResponse:
    try:
        run = pipeline_service.get_run(run_id)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pipeline run not found.",
        ) from error

    return PipelineStatusResponse(
        run_id=run.run_id,
        job_id=run.job_id,
        state=run.state,
        ats_score=run.ats_score,
        ats_threshold=run.ats_threshold,
        iteration=run.iteration,
        max_iterations=run.max_iterations,
        updated_at=run.updated_at,
    )
