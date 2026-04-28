from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.job import (
    JobIngestRequest,
    JobIngestResponse,
    JobListResponse,
    JobSummary,
    JobUpsertRequest,
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
def list_jobs(
    limit: int = Query(default=20, ge=1, le=200),
    search: str = Query(default=""),
    company: str = Query(default=""),
    sort_by: str = Query(default="created_at"),
    sort_order: str = Query(default="desc"),
) -> JobListResponse:
    records = pipeline_service.list_jobs(
        limit=limit,
        search=search,
        company=company,
        sort_by=sort_by,
        sort_order=sort_order,
    )
    items = [
        JobSummary(
            job_id=record.id,
            title=record.title,
            company=record.company,
            salary=record.salary,
            location=record.location,
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
    payload = request.model_dump(mode="json")
    if not payload.get("source_url"):
        payload["source_url"] = "https://unknown.local/job"
    if not payload.get("page_title"):
        payload["page_title"] = payload.get("title", "")
    if not payload.get("source_site"):
        payload["source_site"] = "manual"
    job, was_created = pipeline_service.ingest_job(payload, dedupe_by_company=True)
    return JobIngestResponse(
        job_id=job.id,
        status="accepted" if was_created else "already_exists",
        was_created=was_created,
        pipeline_status=PipelineStatusSnapshot(
            state="not_started",
            ats_score=0,
            ats_threshold=80,
            iteration=0,
        ),
        created_at=job.created_at,
    )


@router.post("/jobs", response_model=JobSummary, status_code=status.HTTP_201_CREATED)
def add_job(request: JobUpsertRequest) -> JobSummary:
    payload = request.model_dump(mode="json")
    if not payload.get("source_url"):
        payload["source_url"] = "https://unknown.local/job"
    if not payload.get("page_title"):
        payload["page_title"] = payload.get("title", "")
    if not payload.get("source_site"):
        payload["source_site"] = "manual"
    if not payload.get("job_description"):
        payload["job_description"] = f"{payload.get('title', '')} {payload.get('company', '')}".strip() or "Manual job entry"
    job, _ = pipeline_service.ingest_job(payload, dedupe_by_company=False)
    return JobSummary(
        job_id=job.id,
        title=job.title,
        company=job.company,
        salary=job.salary,
        location=job.location,
        source_url=job.source_url,
        page_title=job.page_title,
        source_site=job.source_site,
        created_at=job.created_at,
    )


@router.put("/jobs/{job_id}", response_model=JobSummary)
def update_job(job_id: str, request: JobUpsertRequest) -> JobSummary:
    try:
        job = pipeline_service.update_job(job_id, request.model_dump(mode="json"))
    except KeyError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.") from error
    return JobSummary(
        job_id=job.id,
        title=job.title,
        company=job.company,
        salary=job.salary,
        location=job.location,
        source_url=job.source_url,
        page_title=job.page_title,
        source_site=job.source_site,
        created_at=job.created_at,
    )


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(job_id: str) -> None:
    deleted = pipeline_service.delete_job(job_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")


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
