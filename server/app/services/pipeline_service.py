from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(value: datetime) -> str:
    return value.isoformat()


def from_iso(value: str) -> datetime:
    return datetime.fromisoformat(value)


@dataclass
class JobRecord:
    id: str
    title: str
    company: str
    salary: str
    location: str
    source_url: str
    page_title: str
    source_site: str
    job_description: str
    metadata: dict[str, Any]
    created_at: datetime


@dataclass
class PipelineRunRecord:
    run_id: str
    job_id: str
    ats_threshold: int
    ats_score: int = 45
    iteration: int = 0
    max_iterations: int = 5
    state: str = "in_progress"
    updated_at: datetime | None = None

    def __post_init__(self) -> None:
        if self.updated_at is None:
            self.updated_at = utcnow()


class PipelineService:
    def __init__(self, db_path: str = "data/pipeline.db") -> None:
        self.db_path = db_path
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_db(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT '',
                    company TEXT NOT NULL DEFAULT '',
                    salary TEXT NOT NULL DEFAULT '',
                    location TEXT NOT NULL DEFAULT '',
                    source_url TEXT NOT NULL,
                    page_title TEXT NOT NULL,
                    source_site TEXT NOT NULL,
                    job_description TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            # Lightweight migration for older DBs that predate the new fields.
            existing_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(jobs)").fetchall()
            }
            for column_name in ["title", "company", "salary", "location"]:
                if column_name not in existing_columns:
                    connection.execute(
                        f"ALTER TABLE jobs ADD COLUMN {column_name} TEXT NOT NULL DEFAULT ''"
                    )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    ats_threshold INTEGER NOT NULL,
                    ats_score INTEGER NOT NULL,
                    iteration INTEGER NOT NULL,
                    max_iterations INTEGER NOT NULL,
                    state TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(job_id) REFERENCES jobs(id)
                )
                """
            )
            connection.commit()

    @staticmethod
    def _row_to_job(row: sqlite3.Row) -> JobRecord:
        return JobRecord(
            id=row["id"],
            title=row["title"] if "title" in row.keys() else "",
            company=row["company"] if "company" in row.keys() else "",
            salary=row["salary"] if "salary" in row.keys() else "",
            location=row["location"] if "location" in row.keys() else "",
            source_url=row["source_url"],
            page_title=row["page_title"],
            source_site=row["source_site"],
            job_description=row["job_description"],
            metadata=json.loads(row["metadata_json"]),
            created_at=from_iso(row["created_at"]),
        )

    @staticmethod
    def _row_to_run(row: sqlite3.Row) -> PipelineRunRecord:
        return PipelineRunRecord(
            run_id=row["run_id"],
            job_id=row["job_id"],
            ats_threshold=row["ats_threshold"],
            ats_score=row["ats_score"],
            iteration=row["iteration"],
            max_iterations=row["max_iterations"],
            state=row["state"],
            updated_at=from_iso(row["updated_at"]),
        )

    @staticmethod
    def _normalize_company(company: str) -> str:
        return " ".join((company or "").strip().lower().split())

    def ingest_job(self, payload: dict[str, Any], dedupe_by_company: bool = True) -> tuple[JobRecord, bool]:
        company_value = str(payload.get("company", "") or "")
        normalized_company = self._normalize_company(company_value)
        if dedupe_by_company and normalized_company:
            with self._connect() as connection:
                row = connection.execute(
                    """
                    SELECT *
                    FROM jobs
                    WHERE lower(trim(company)) = ?
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (normalized_company,),
                ).fetchone()
            if row:
                return self._row_to_job(row), False

        job_id = f"job_{uuid4().hex[:12]}"
        created_at = utcnow()
        record = JobRecord(
            id=job_id,
            title=str(payload.get("title", "") or ""),
            company=company_value,
            salary=str(payload.get("salary", "") or ""),
            location=str(payload.get("location", "") or ""),
            source_url=payload["source_url"],
            page_title=payload["page_title"],
            source_site=payload["source_site"],
            job_description=payload["job_description"],
            metadata=payload.get("metadata", {}),
            created_at=created_at,
        )
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO jobs (
                    id, title, company, salary, location,
                    source_url, page_title, source_site, job_description, metadata_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    record.title,
                    record.company,
                    record.salary,
                    record.location,
                    record.source_url,
                    record.page_title,
                    record.source_site,
                    record.job_description,
                    json.dumps(record.metadata),
                    to_iso(record.created_at),
                ),
            )
            connection.commit()
        return record, True

    def start_pipeline(self, job_id: str, ats_threshold: int) -> PipelineRunRecord:
        with self._connect() as connection:
            job_exists = connection.execute("SELECT 1 FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if not job_exists:
                raise KeyError("job_not_found")

            run_id = f"run_{uuid4().hex[:12]}"
            run = PipelineRunRecord(run_id=run_id, job_id=job_id, ats_threshold=ats_threshold)
            connection.execute(
                """
                INSERT INTO runs (run_id, job_id, ats_threshold, ats_score, iteration, max_iterations, state, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run.run_id,
                    run.job_id,
                    run.ats_threshold,
                    run.ats_score,
                    run.iteration,
                    run.max_iterations,
                    run.state,
                    to_iso(run.updated_at),
                ),
            )
            connection.commit()
        return run

    def list_jobs(
        self,
        limit: int = 20,
        search: str = "",
        company: str = "",
        sort_by: str = "created_at",
        sort_order: str = "desc",
    ) -> list[JobRecord]:
        allowed_sort = {"created_at", "company", "title"}
        sort_column = sort_by if sort_by in allowed_sort else "created_at"
        direction = "ASC" if str(sort_order).lower() == "asc" else "DESC"
        clauses: list[str] = []
        params: list[Any] = []
        if search:
            like = f"%{search.lower()}%"
            clauses.append(
                "(lower(title) LIKE ? OR lower(company) LIKE ? OR lower(job_description) LIKE ?)"
            )
            params.extend([like, like, like])
        if company:
            clauses.append("lower(company) = ?")
            params.append(self._normalize_company(company))
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._connect() as connection:
            query = f"""
                SELECT * FROM jobs
                {where_sql}
                ORDER BY {sort_column} {direction}
                LIMIT ?
            """
            rows = connection.execute(
                query,
                (*params, limit),
            ).fetchall()
        return [self._row_to_job(row) for row in rows]

    def get_job(self, job_id: str) -> JobRecord:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise KeyError("job_not_found")
        return self._row_to_job(row)

    def update_job(self, job_id: str, payload: dict[str, Any]) -> JobRecord:
        existing = self.get_job(job_id)
        title = str(payload.get("title", existing.title) or "")
        company = str(payload.get("company", existing.company) or "")
        salary = str(payload.get("salary", existing.salary) or "")
        location = str(payload.get("location", existing.location) or "")
        source_url = str(payload.get("source_url", existing.source_url) or "")
        page_title = str(payload.get("page_title", existing.page_title) or "")
        source_site = str(payload.get("source_site", existing.source_site) or "")
        job_description = str(payload.get("job_description", existing.job_description) or "")
        metadata = payload.get("metadata", existing.metadata)
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE jobs
                SET title = ?, company = ?, salary = ?, location = ?, source_url = ?, page_title = ?,
                    source_site = ?, job_description = ?, metadata_json = ?
                WHERE id = ?
                """,
                (
                    title,
                    company,
                    salary,
                    location,
                    source_url,
                    page_title,
                    source_site,
                    job_description,
                    json.dumps(metadata),
                    job_id,
                ),
            )
            connection.commit()
        return self.get_job(job_id)

    def delete_job(self, job_id: str) -> bool:
        with self._connect() as connection:
            result = connection.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            connection.commit()
        return result.rowcount > 0

    def _advance_run(self, run: PipelineRunRecord) -> PipelineRunRecord:
        if run.state == "in_progress":
            run.iteration += 1
            run.ats_score = min(100, run.ats_score + 12)
            if run.ats_score >= run.ats_threshold:
                run.state = "completed"
            elif run.iteration >= run.max_iterations:
                run.state = "failed"
            run.updated_at = utcnow()

        with self._connect() as connection:
            connection.execute(
                """
                UPDATE runs
                SET ats_score = ?, iteration = ?, state = ?, updated_at = ?
                WHERE run_id = ?
                """,
                (run.ats_score, run.iteration, run.state, to_iso(run.updated_at), run.run_id),
            )
            connection.commit()

        return run

    def get_run(self, run_id: str) -> PipelineRunRecord:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()

        if not row:
            raise KeyError("run_not_found")

        run = self._row_to_run(row)
        return self._advance_run(run)

    def reset(self) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM runs")
            connection.execute("DELETE FROM jobs")
            connection.commit()


pipeline_service = PipelineService()
