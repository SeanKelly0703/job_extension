# Server (FastAPI) - Phase 1

## Setup

1. Create and activate a virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Run server:

```bash
uvicorn app.main:app --reload --port 8000
```

4. Open API docs:

- `http://127.0.0.1:8000/docs`

## Implemented Endpoints

- `POST /api/v1/jobs/ingest`
- `POST /api/v1/pipeline/{job_id}/start`
- `GET /api/v1/pipeline/{run_id}/status`
- `GET /health`

## Run Tests

```bash
pytest
```

The tests cover health, ingest, pipeline start/status progression, and not-found errors.

## Manual QA Checklist

1. Start server and confirm `GET /health` returns `{"status":"ok"}`.
2. Load extension in Chrome from `extension/`.
3. Open a supported job page and click `Extract` in popup.
4. Confirm job text appears in textarea.
5. Click `Send to Server` and confirm `Job ID` appears.
6. Use API docs to call pipeline start with returned `job_id`.
7. Poll status endpoint until run reaches `completed` when score is above threshold.

## Current Limitations

- In-memory storage only (no database yet).
- Pipeline logic is deterministic mock behavior.
- No PDF export in Phase 1.
