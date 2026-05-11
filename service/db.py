"""Lightweight persistence for the adversary-agent.

SQLite for MVP — single file, no server, zero ops cost. The data model
fits in five tables and Postgres compatibility is preserved by sticking
to portable SQL (no SQLite-specific JSON1 functions, no autoincrement
PRIMARY KEY tricks). Switching to Postgres in prod is a config change."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from typing import Any


_DB_PATH = os.getenv("ADVERSARY_DB_PATH", "./adversary.sqlite")
_LOCK = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_conn():
    """Single-process connection guarded by a lock — fine for MVP-scale
    write traffic. Swap to a connection pool when we move to Postgres."""
    with _LOCK:
        conn = _connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS regression_runs (
    run_id              TEXT PRIMARY KEY,
    state               TEXT NOT NULL,
    target_url          TEXT NOT NULL,
    suite_ref           TEXT NOT NULL,
    commit_sha          TEXT,
    baseline_target_sha TEXT,
    source              TEXT NOT NULL,
    source_url          TEXT,
    started_at          TEXT NOT NULL,
    ended_at            TEXT,
    spend_usd           REAL NOT NULL DEFAULT 0,
    totals_json         TEXT NOT NULL DEFAULT '{}',
    deltas_json         TEXT NOT NULL DEFAULT '{}',
    gate_json           TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS attempts (
    attempt_id    TEXT PRIMARY KEY,
    run_id        TEXT NOT NULL REFERENCES regression_runs(run_id),
    seed_id       TEXT NOT NULL,
    category      TEXT NOT NULL,
    subcategory   TEXT NOT NULL,
    verdict       TEXT NOT NULL,
    response_text TEXT,
    latency_ms    INTEGER,
    spend_usd     REAL NOT NULL DEFAULT 0,
    started_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    audit_id    TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    actor       TEXT,
    commit_sha  TEXT,
    ci_url      TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_started_at ON regression_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_target     ON regression_runs(target_url);
CREATE INDEX IF NOT EXISTS idx_attempts_run    ON attempts(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_log(created_at DESC);
"""


def init_db() -> None:
    """Idempotent — safe to run on every boot."""
    with get_conn() as conn:
        conn.executescript(_SCHEMA)


# ─── Run helpers ─────────────────────────────────────────────────────

def insert_run(row: dict[str, Any]) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO regression_runs
                (run_id, state, target_url, suite_ref, commit_sha,
                 baseline_target_sha, source, source_url, started_at,
                 ended_at, spend_usd, totals_json, deltas_json, gate_json)
            VALUES
                (:run_id, :state, :target_url, :suite_ref, :commit_sha,
                 :baseline_target_sha, :source, :source_url, :started_at,
                 :ended_at, :spend_usd, :totals_json, :deltas_json, :gate_json)
            """,
            row,
        )


def update_run(run_id: str, fields: dict[str, Any]) -> None:
    if not fields:
        return
    cols = ", ".join(f"{k} = :{k}" for k in fields)
    params = {**fields, "run_id": run_id}
    with get_conn() as conn:
        conn.execute(f"UPDATE regression_runs SET {cols} WHERE run_id = :run_id", params)


def get_run(run_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM regression_runs WHERE run_id = ?", (run_id,)
        ).fetchone()
    if row is None:
        return None
    return _row_to_dict(row)


def list_runs(*, target: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    sql = "SELECT * FROM regression_runs"
    params: list[Any] = []
    if target:
        sql += " WHERE target_url = ?"
        params.append(target)
    sql += " ORDER BY started_at DESC LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def insert_attempt(row: dict[str, Any]) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO attempts
                (attempt_id, run_id, seed_id, category, subcategory, verdict,
                 response_text, latency_ms, spend_usd, started_at)
            VALUES
                (:attempt_id, :run_id, :seed_id, :category, :subcategory, :verdict,
                 :response_text, :latency_ms, :spend_usd, :started_at)
            """,
            row,
        )


def list_attempts(run_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM attempts WHERE run_id = ? ORDER BY started_at",
            (run_id,),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def insert_audit(row: dict[str, Any]) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO audit_log
                (audit_id, kind, actor, commit_sha, ci_url, detail_json, created_at)
            VALUES
                (:audit_id, :kind, :actor, :commit_sha, :ci_url, :detail_json, :created_at)
            """,
            row,
        )


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    for k in ("totals_json", "deltas_json", "gate_json", "detail_json"):
        if k in d and isinstance(d[k], str):
            try:
                d[k.removesuffix("_json")] = json.loads(d.pop(k))
            except json.JSONDecodeError:
                d.pop(k, None)
    return d
