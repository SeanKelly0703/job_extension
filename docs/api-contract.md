# API Contract (Phase 1)

Base URL: `http://127.0.0.1:8000`

## GET `/api/v1/jobs`

Returns recently ingested jobs in descending `created_at` order.

### Query Params

- `limit` (optional): integer from `1` to `100`, default `20`.

### Response (200)

```json
{
  "items": [
    {
      "job_id": "job_abc123def456",
      "source_url": "https://www.linkedin.com/jobs/view/123",
      "page_title": "Software Engineer - Example Corp",
      "source_site": "linkedin.com",
      "created_at": "2026-04-23T10:00:02.120532+00:00"
    }
  ],
  "count": 1
}
```

## POST `/api/v1/jobs/ingest`

Accepts scraped job description payload from the extension.

### Request

```json
{
  "source_url": "https://www.linkedin.com/jobs/view/123",
  "page_title": "Software Engineer - Example Corp",
  "source_site": "linkedin.com",
  "job_description": "We are looking for ...",
  "metadata": {
    "captured_at": "2026-04-23T10:00:00Z",
    "truncated": false
  }
}
```

### Response (201)

```json
{
  "job_id": "job_abc123def456",
  "status": "accepted",
  "pipeline_status": {
    "state": "not_started",
    "ats_score": 0,
    "ats_threshold": 80,
    "iteration": 0
  },
  "created_at": "2026-04-23T10:00:02.120532+00:00"
}
```

## POST `/api/v1/pipeline/{job_id}/start`

Starts a mock resume-tailoring pipeline run.

### Request

```json
{
  "original_resume_id": "resume_001",
  "ats_threshold": 80
}
```

At least one of `original_resume_id` or `resume_text` is required.

### Response (200)

```json
{
  "run_id": "run_9f5fbc6afe10",
  "job_id": "job_abc123def456",
  "state": "in_progress",
  "ats_threshold": 80,
  "started_at": "2026-04-23T10:02:11.038472+00:00"
}
```

## GET `/api/v1/pipeline/{run_id}/status`

Returns deterministic mock progression. Each poll increments iteration and ATS score.

Stop rule in contract: server marks run `completed` when `ats_score >= ats_threshold`.

### Response (200)

```json
{
  "run_id": "run_9f5fbc6afe10",
  "job_id": "job_abc123def456",
  "state": "completed",
  "ats_score": 81,
  "ats_threshold": 80,
  "iteration": 3,
  "max_iterations": 5,
  "updated_at": "2026-04-23T10:02:44.814212+00:00"
}
```

## Error Responses

- `404` if `job_id` or `run_id` does not exist.
- `422` for schema validation failures or missing resume inputs on pipeline start.

## Resume Tailoring (Current Scope)

- Resume tailoring is currently handled in the browser extension using chatgpt.com automation.
- Tailored resume output is exported locally via the browser print flow (PDF).
- There is currently no backend upload endpoint for tailored resume PDFs in this phase.
