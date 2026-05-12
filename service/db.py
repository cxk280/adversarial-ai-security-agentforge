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
    gate_json           TEXT NOT NULL DEFAULT '{}',
    langfuse_trace_url  TEXT
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

-- Documentation Agent output (ARCHITECTURE.md §1.3). One row per
-- attack_id (a seed_id) for which Sonnet has generated a polished
-- VULN-NNNN-shape markdown writeup. GET /findings prefers this body
-- over the auto-generated stub when present, so the dashboard shows
-- the curated version without manual VULN-NNNN.md authoring.
CREATE TABLE IF NOT EXISTS documentation_agent_outputs (
    attack_id     TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    severity      TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    campaign_id   TEXT NOT NULL,
    model         TEXT NOT NULL,
    generated_at  TEXT NOT NULL,
    -- Tracks the Documentation Agent's lifecycle for this attack_id:
    --   absent       Doc Agent skipped (e.g. ANTHROPIC_API_KEY unset),
    --                row exists only to reserve the assigned_vuln_id
    --   in_progress  Sonnet call in flight; body is a placeholder
    --   completed    body_markdown holds the polished writeup
    --   failed       body_markdown holds an error stub; generated_at
    --                is the failure time
    -- The findings API uses this to surface a "writing…" indicator
    -- while the agent is still working.
    status            TEXT NOT NULL DEFAULT 'completed',
    -- Stable VULN-NNNN identifier allocated when this exploit first
    -- appears in /findings. Persisted so the same exploit keeps the
    -- same id across requests + redeploys.
    assigned_vuln_id  TEXT
);

-- Finding status overlay. The on-disk VULN-NNNN.md is the source of
-- truth for content (title, severity, body, repro); status is the one
-- field that can be mutated at runtime via PATCH /findings/{id}/status.
-- This table stores those mutations; the API joins it into the
-- response so the UI sees the live status without needing a redeploy.
CREATE TABLE IF NOT EXISTS finding_status_overrides (
    finding_id  TEXT PRIMARY KEY,
    status      TEXT NOT NULL,
    changed_at  TEXT NOT NULL,
    changed_by  TEXT,
    commit_sha  TEXT,
    rationale   TEXT
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
        # Tolerant ALTERs for columns added after the initial schema.
        # The persistent Railway volume keeps the old shape across
        # redeploys, so we need to retro-add new columns.
        for ddl in (
            "ALTER TABLE regression_runs ADD COLUMN langfuse_trace_url TEXT",
            "ALTER TABLE documentation_agent_outputs ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'",
            "ALTER TABLE documentation_agent_outputs ADD COLUMN assigned_vuln_id TEXT",
        ):
            try:
                conn.execute(ddl)
            except sqlite3.OperationalError:
                pass  # column already exists

        # One-shot cleanup of legacy AUTO-* identifiers from a previous
        # iteration where auto-generated findings used a different
        # prefix. Every finding is now a VULN-NNNN; AUTO-* overrides
        # are orphans (their target id no longer exists), so we drop
        # them rather than leave silently-non-applying rows behind.
        try:
            conn.execute(
                "DELETE FROM finding_status_overrides WHERE finding_id LIKE 'AUTO-%'"
            )
        except sqlite3.OperationalError:
            pass

        # One-shot migration: clean slate for the DB-allocated finding
        # entries. The id-allocator now produces VULN-NNNN, but
        # pre-existing data still leaks through two layers:
        #   1. documentation_agent_outputs rows have markdown bodies
        #      from an earlier prompt that baked "AUTO-<attack_id>"
        #      into the title verbatim.
        #   2. attempts rows with verdict='pass' regenerate AUTO-
        #      finding entries on every /findings GET (via the
        #      allocator), even after we've wiped doc_agent_outputs.
        # Both layers need clearing for the wipe to actually stick.
        #
        # We delete the passing attempts AND the doc-agent rows in
        # one transaction, marker-gated so it runs exactly once.
        # The non-passing attempts (held/partial/inconclusive) stay
        # — those are the evidence that the target's defenses worked,
        # and they're what the Coverage matrix's "tested but held"
        # cells depend on. Campaign-level totals in regression_runs.
        # totals_json are stored as a snapshot at run-completion, so
        # the Run History counts stay intact even though individual
        # passing attempts are gone.
        marker_kind = "migration:reset_doc_agent_outputs_v2"
        already_ran = conn.execute(
            "SELECT 1 FROM audit_log WHERE kind = ? LIMIT 1", (marker_kind,)
        ).fetchone()
        if not already_ran:
            conn.execute("DELETE FROM documentation_agent_outputs")
            conn.execute("DELETE FROM attempts WHERE verdict = 'pass'")
            # Any user-set status overrides on DB-allocated VULN-NNNN
            # findings are also dropped — the underlying findings are
            # gone, the overrides would otherwise dangle.
            conn.execute(
                "DELETE FROM finding_status_overrides WHERE finding_id NOT IN ('VULN-0001', 'VULN-0002', 'VULN-0003')"
            )
            import uuid as _uuid
            from datetime import datetime, timezone
            conn.execute(
                """
                INSERT INTO audit_log
                    (audit_id, kind, actor, commit_sha, ci_url, detail_json, created_at)
                VALUES
                    (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    _uuid.uuid4().hex, marker_kind, "init_db",
                    None, None, "{}",
                    datetime.now(timezone.utc).isoformat(),
                ),
            )


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


def get_doc_agent_output(attack_id: str) -> dict[str, Any] | None:
    """Return the Documentation Agent's polished writeup for an
    attack_id, or None if none has been generated yet."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM documentation_agent_outputs WHERE attack_id = ?",
            (attack_id,),
        ).fetchone()
    return dict(row) if row else None


def list_doc_agent_outputs() -> dict[str, dict[str, Any]]:
    """All DocAgent outputs as {attack_id → row}. Used by the list
    endpoint to apply the polish in a single round-trip."""
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM documentation_agent_outputs").fetchall()
    return {r["attack_id"]: dict(r) for r in rows}


def upsert_doc_agent_output(row: dict[str, Any]) -> None:
    """Insert-or-update the Doc Agent writeup for an attack_id. Row
    must include attack_id, title, severity, body_markdown,
    campaign_id, model, generated_at. Optionally `status` (default
    'completed') and `assigned_vuln_id`."""
    payload = {"status": "completed", "assigned_vuln_id": None, **row}
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO documentation_agent_outputs
                (attack_id, title, severity, body_markdown, campaign_id,
                 model, generated_at, status, assigned_vuln_id)
            VALUES
                (:attack_id, :title, :severity, :body_markdown, :campaign_id,
                 :model, :generated_at, :status, :assigned_vuln_id)
            ON CONFLICT(attack_id) DO UPDATE SET
                title         = excluded.title,
                severity      = excluded.severity,
                body_markdown = excluded.body_markdown,
                campaign_id   = excluded.campaign_id,
                model         = excluded.model,
                generated_at  = excluded.generated_at,
                status        = excluded.status,
                -- Don't overwrite an already-allocated vuln_id with
                -- NULL — the allocation is permanent.
                assigned_vuln_id = COALESCE(excluded.assigned_vuln_id, documentation_agent_outputs.assigned_vuln_id)
            """,
            payload,
        )


def set_doc_agent_vuln_id(attack_id: str, vuln_id: str) -> None:
    """Persist the allocated VULN-NNNN id for an attack_id without
    touching any other fields. Used by the findings allocator path
    when no doc-agent body has been generated yet."""
    with get_conn() as conn:
        conn.execute(
            "UPDATE documentation_agent_outputs SET assigned_vuln_id = ? WHERE attack_id = ?",
            (vuln_id, attack_id),
        )


def get_doc_agent_output_by_vuln_id(vuln_id: str) -> dict[str, Any] | None:
    """Reverse lookup: find the Doc Agent row whose assigned_vuln_id
    matches. Used by GET /findings/{id} when the id starts with VULN-
    but no markdown file exists on disk."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM documentation_agent_outputs WHERE assigned_vuln_id = ?",
            (vuln_id,),
        ).fetchone()
    return dict(row) if row else None


def get_finding_status_override(finding_id: str) -> dict[str, Any] | None:
    """Return the override row for a finding, or None if no override exists.
    The API merges this on top of the markdown-parsed status when serving
    GET /findings."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM finding_status_overrides WHERE finding_id = ?",
            (finding_id,),
        ).fetchone()
    return dict(row) if row else None


def list_finding_status_overrides() -> dict[str, dict[str, Any]]:
    """All overrides as {finding_id → row}. Used by the list endpoint to
    apply overrides in a single round-trip per request."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM finding_status_overrides",
        ).fetchall()
    return {r["finding_id"]: dict(r) for r in rows}


def upsert_finding_status_override(row: dict[str, Any]) -> None:
    """Insert-or-update the override for a single finding. `row` must
    include finding_id, status, changed_at; changed_by/commit_sha/
    rationale are optional."""
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO finding_status_overrides
                (finding_id, status, changed_at, changed_by, commit_sha, rationale)
            VALUES
                (:finding_id, :status, :changed_at, :changed_by, :commit_sha, :rationale)
            ON CONFLICT(finding_id) DO UPDATE SET
                status     = excluded.status,
                changed_at = excluded.changed_at,
                changed_by = excluded.changed_by,
                commit_sha = excluded.commit_sha,
                rationale  = excluded.rationale
            """,
            {
                "changed_by": None,
                "commit_sha": None,
                "rationale": None,
                **row,
            },
        )


def coverage_by_subcategory() -> list[dict[str, Any]]:
    """Aggregate attempts by (category, subcategory): case count, pass-held
    rate, exploit count, last-seen timestamp. Used to derive the live
    Coverage matrix from real runs rather than a hardcoded table."""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT
                category,
                subcategory,
                COUNT(*)                                       AS cases,
                SUM(CASE WHEN verdict = 'pass' THEN 1 ELSE 0 END) AS exploits,
                SUM(CASE WHEN verdict = 'fail' THEN 1 ELSE 0 END) AS held,
                SUM(CASE WHEN verdict = 'partial' THEN 1 ELSE 0 END) AS partial,
                MAX(started_at)                                AS last_run_at
            FROM attempts
            GROUP BY category, subcategory
            """,
        ).fetchall()
    return [dict(r) for r in rows]


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
