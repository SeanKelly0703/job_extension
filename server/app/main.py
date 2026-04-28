from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.jobs import router as jobs_router

app = FastAPI(
    title="Job Extension API",
    version="0.1.0",
    description="Phase 1 API for job description ingestion and ATS pipeline stubs.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs_router)

app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.get("/")
def jobs_frontend() -> FileResponse:
    return FileResponse("app/static/jobs.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
