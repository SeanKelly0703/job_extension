from fastapi.testclient import TestClient

from app.main import app
from app.services.pipeline_service import pipeline_service

client = TestClient(app)


def _valid_ingest_payload() -> dict:
    return {
        "source_url": "https://www.linkedin.com/jobs/view/123",
        "title": "Software Engineer",
        "company": "Example Corp",
        "salary": "$120,000",
        "location": "Remote",
        "page_title": "Software Engineer - Example",
        "source_site": "linkedin.com",
        "job_description": (
            "We are looking for an engineer with experience in Python, APIs, testing, "
            "and collaboration across product and design teams."
        ),
        "metadata": {"captured_at": "2026-04-23T10:00:00Z", "truncated": False},
    }


def setup_function() -> None:
    pipeline_service.reset()


def test_health_endpoint() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ingest_job_returns_accepted_payload() -> None:
    response = client.post("/api/v1/jobs/ingest", json=_valid_ingest_payload())
    assert response.status_code == 201

    data = response.json()
    assert data["status"] == "accepted"
    assert data["was_created"] is True
    assert data["job_id"].startswith("job_")
    assert data["pipeline_status"] == {
        "state": "not_started",
        "ats_score": 0,
        "ats_threshold": 80,
        "iteration": 0,
    }


def test_list_jobs_returns_latest_first_with_limit() -> None:
    payload_one = _valid_ingest_payload()
    payload_one["page_title"] = "Older role"
    payload_one["source_url"] = "https://www.linkedin.com/jobs/view/111"
    payload_one["source_site"] = "linkedin.com"
    client.post("/api/v1/jobs/ingest", json=payload_one)

    payload_two = _valid_ingest_payload()
    payload_two["page_title"] = "Newest role"
    payload_two["source_url"] = "https://www.indeed.com/jobs/view/222"
    payload_two["source_site"] = "indeed.com"
    payload_two["company"] = "Another Corp"
    client.post("/api/v1/jobs/ingest", json=payload_two)

    response = client.get("/api/v1/jobs?limit=1")
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["page_title"] == "Newest role"
    assert data["items"][0]["source_site"] == "indeed.com"
    assert data["items"][0]["title"]
    assert "company" in data["items"][0]


def test_ingest_dedupes_by_company() -> None:
    first = client.post("/api/v1/jobs/ingest", json=_valid_ingest_payload())
    assert first.status_code == 201
    second_payload = _valid_ingest_payload()
    second_payload["source_url"] = "https://www.linkedin.com/jobs/view/999"
    second_payload["page_title"] = "Another Title"
    second = client.post("/api/v1/jobs/ingest", json=second_payload)
    assert second.status_code == 201
    assert second.json()["status"] == "already_exists"
    assert second.json()["was_created"] is False
    listed = client.get("/api/v1/jobs?limit=10")
    assert listed.status_code == 200
    assert listed.json()["count"] == 1


def test_jobs_crud_filter_sort() -> None:
    created = client.post(
        "/api/v1/jobs",
        json={
            "title": "Data Engineer",
            "company": "DataWorks",
            "salary": "$100k",
            "location": "Hybrid",
            "source_url": "https://example.com/job/1",
            "source_site": "example.com",
            "page_title": "Data Engineer",
            "job_description": "Build data pipelines."
        },
    )
    assert created.status_code == 201
    job_id = created.json()["job_id"]

    updated = client.put(
        f"/api/v1/jobs/{job_id}",
        json={"title": "Senior Data Engineer", "company": "DataWorks", "job_description": "Build robust pipelines."},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Senior Data Engineer"

    listed = client.get("/api/v1/jobs?search=dataworks&sort_by=company&sort_order=asc&limit=20")
    assert listed.status_code == 200
    assert listed.json()["count"] >= 1

    deleted = client.delete(f"/api/v1/jobs/{job_id}")
    assert deleted.status_code == 204


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
