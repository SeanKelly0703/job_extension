from fastapi.testclient import TestClient

from app.main import app
from app.services.pipeline_service import pipeline_service

client = TestClient(app)


def _valid_ingest_payload() -> dict:
    return {
        "source_url": "https://www.linkedin.com/jobs/view/123",
        "page_title": "Software Engineer - Example",
        "source_site": "linkedin.com",
        "job_description": (
            "We are looking for an engineer with experience in Python, APIs, testing, "
            "and collaboration across product and design teams."
        ),
        "metadata": {"captured_at": "2026-04-23T10:00:00Z", "truncated": False},
    }


def setup_function() -> None:
    pipeline_service.jobs.clear()
    pipeline_service.runs.clear()


def test_health_endpoint() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ingest_job_returns_accepted_payload() -> None:
    response = client.post("/api/v1/jobs/ingest", json=_valid_ingest_payload())
    assert response.status_code == 201

    data = response.json()
    assert data["status"] == "accepted"
    assert data["job_id"].startswith("job_")
    assert data["pipeline_status"] == {
        "state": "not_started",
        "ats_score": 0,
        "ats_threshold": 80,
        "iteration": 0,
    }


def test_start_pipeline_requires_resume_input() -> None:
    ingest_response = client.post("/api/v1/jobs/ingest", json=_valid_ingest_payload())
    job_id = ingest_response.json()["job_id"]

    response = client.post(f"/api/v1/pipeline/{job_id}/start", json={"ats_threshold": 80})
    assert response.status_code == 422
    assert response.json()["detail"] == "Either original_resume_id or resume_text must be provided."


def test_pipeline_start_and_status_progression() -> None:
    ingest_response = client.post("/api/v1/jobs/ingest", json=_valid_ingest_payload())
    job_id = ingest_response.json()["job_id"]

    start_response = client.post(
        f"/api/v1/pipeline/{job_id}/start",
        json={"original_resume_id": "resume_001", "ats_threshold": 80},
    )
    assert start_response.status_code == 200
    run_id = start_response.json()["run_id"]
    assert start_response.json()["state"] == "in_progress"

    status_one = client.get(f"/api/v1/pipeline/{run_id}/status")
    status_two = client.get(f"/api/v1/pipeline/{run_id}/status")
    status_three = client.get(f"/api/v1/pipeline/{run_id}/status")

    assert status_one.status_code == 200
    assert status_one.json()["iteration"] == 1
    assert status_one.json()["ats_score"] == 57

    assert status_two.status_code == 200
    assert status_two.json()["iteration"] == 2
    assert status_two.json()["ats_score"] == 69

    assert status_three.status_code == 200
    assert status_three.json()["iteration"] == 3
    assert status_three.json()["ats_score"] == 81
    assert status_three.json()["state"] == "completed"


def test_pipeline_not_found_errors() -> None:
    start_response = client.post(
        "/api/v1/pipeline/job_missing/start",
        json={"original_resume_id": "resume_001", "ats_threshold": 80},
    )
    assert start_response.status_code == 404
    assert start_response.json()["detail"] == "Job not found."

    status_response = client.get("/api/v1/pipeline/run_missing/status")
    assert status_response.status_code == 404
    assert status_response.json()["detail"] == "Pipeline run not found."
