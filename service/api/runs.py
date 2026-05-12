"""POST/GET /regression-runs and POST /regression-runs/{id}/cancel."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from service import db
from service.auth import require_bearer
from service.models import (
    BypassRecord,
    RunAccepted,
    RunDeltas,
    RunGate,
    RunStatus,
    RunSubmit,
    RunTotals,
    now_iso,
)
from service.runner import execute_run


router = APIRouter()


def _new_run_id() -> str:
    return f"run_{int(datetime.now(timezone.utc).timestamp())}_{uuid.uuid4().hex[:6]}"


@router.post("/regression-runs", response_model=RunAccepted, status_code=status.HTTP_202_ACCEPTED)
async def submit_run(
    payload: RunSubmit,
    background: BackgroundTasks,
    _token: str = Depends(require_bearer),
) -> RunAccepted:
    run_id = _new_run_id()
    row = {
        "run_id": run_id,
        "state": "queued",
        "target_url": payload.target_url,
        "suite_ref": payload.suite_ref,
        "commit_sha": payload.commit_sha,
        "baseline_target_sha": payload.baseline_target_sha,
        "source": payload.source,
        "source_url": payload.source_url,
        "started_at": now_iso(),
        "ended_at": None,
        "spend_usd": 0.0,
        "totals_json": json.dumps({}),
        "deltas_json": json.dumps({}),
        "gate_json": json.dumps({}),
    }
    db.insert_run(row)
    background.add_task(execute_run, run_id, payload.target_url, payload.suite_ref)
    return RunAccepted(
        run_id=run_id,
        state="queued",
        estimated_seconds=180,
        links={
            "self": f"/regression-runs/{run_id}",
            "dashboard": f"/runs/{run_id}",
        },
    )


@router.get("/regression-runs/{run_id}", response_model=RunStatus)
async def get_run_status(
    run_id: str,
    _token: str = Depends(require_bearer),
) -> RunStatus:
    row = db.get_run(run_id)
    if row is None:
        raise HTTPException(404, f"Run {run_id!r} not found")

    started = _parse_iso(row["started_at"])
    ended = _parse_iso(row["ended_at"]) if row.get("ended_at") else None
    duration_s = int((ended - started).total_seconds()) if ended else None

    totals_d = row.get("totals", {})
    totals = RunTotals(**{"pass": totals_d.get("pass", 0), **{k: v for k, v in totals_d.items() if k != "pass"}})

    deltas = RunDeltas(**row.get("deltas", {}))
    gate_d = row.get("gate", {})
    gate = RunGate(**gate_d) if gate_d else None

    progress = None
    if row["state"] == "running":
        attempts = db.list_attempts(run_id)
        progress = {"completed": len(attempts)}

    return RunStatus(
        run_id=run_id,
        state=row["state"],
        started_at=started,
        ended_at=ended,
        duration_s=duration_s,
        spend_usd=row.get("spend_usd", 0.0),
        target_url=row["target_url"],
        target_sha=row.get("commit_sha"),
        baseline_sha=row.get("baseline_target_sha"),
        totals=totals,
        deltas=deltas,
        gate=gate,
        progress=progress,
        links={
            "dashboard": f"/runs/{run_id}",
            "findings": f"/runs/{run_id}/findings",
        },
    )


@router.get("/regression-runs")
async def list_runs(
    target: str | None = None,
    _token: str = Depends(require_bearer),
) -> dict:
    rows = db.list_runs(target=target, limit=50)
    return {"runs": rows, "count": len(rows)}


@router.get("/regression-runs/{run_id}/attempts")
async def get_run_attempts(
    run_id: str,
    _token: str = Depends(require_bearer),
) -> dict:
    """Per-attack rows for a run — what the Run Detail UI page renders."""
    row = db.get_run(run_id)
    if row is None:
        raise HTTPException(404, f"Run {run_id!r} not found")
    attempts = db.list_attempts(run_id)
    return {"run_id": run_id, "attempts": attempts, "count": len(attempts)}


@router.post("/regression-runs/{run_id}/cancel")
async def cancel_run(
    run_id: str,
    _token: str = Depends(require_bearer),
) -> dict:
    row = db.get_run(run_id)
    if row is None:
        raise HTTPException(404, f"Run {run_id!r} not found")
    if row["state"] in ("completed", "failed", "cancelled"):
        raise HTTPException(409, f"Run is already {row['state']}")
    db.update_run(run_id, {"state": "cancelled", "ended_at": now_iso()})
    return {"run_id": run_id, "state": "cancelled"}


def _parse_iso(s: str | None) -> datetime:
    if s is None:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(s)
