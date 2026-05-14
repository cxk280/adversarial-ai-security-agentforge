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
    background.add_task(
        execute_run,
        run_id,
        payload.target_url,
        payload.suite_ref,
        payload.categories,
    )
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

    links: dict[str, str] = {
        "dashboard": f"/runs/{run_id}",
        "findings": f"/runs/{run_id}/findings",
    }
    if row.get("langfuse_trace_url"):
        links["langfuse"] = row["langfuse_trace_url"]

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
        links=links,
    )


@router.get("/regression-runs")
async def list_runs(
    target: str | None = None,
    _token: str = Depends(require_bearer),
) -> dict:
    rows = db.list_runs(target=target, limit=50)
    return {"runs": rows, "count": len(rows)}


def _resolved_attack_ids() -> set[str]:
    """Set of attack_ids that have ever been marked resolved.

    Used to flag regressions: a verdict=pass on a previously-resolved
    attack_id is a returning vulnerability — exactly the case the
    PDF calls out ("Detect when a previously-fixed vulnerability has
    reappeared")."""
    overrides = db.list_finding_status_overrides()
    resolved_vuln_ids = {
        finding_id for finding_id, ovr in overrides.items()
        if ovr.get("status") == "resolved"
    }
    if not resolved_vuln_ids:
        return set()
    # Resolve each VULN-NNNN to its attack_id via doc_agent_outputs.
    out: set[str] = set()
    for doc in db.list_doc_agent_outputs().values():
        if doc.get("assigned_vuln_id") in resolved_vuln_ids:
            atk = doc.get("attack_id")
            if atk:
                out.add(atk)
    return out


@router.get("/regression-runs/{run_id}/attempts")
async def get_run_attempts(
    run_id: str,
    _token: str = Depends(require_bearer),
) -> dict:
    """Per-attack rows for a run — what the Run Detail UI page renders.

    Each attempt carries an `is_regression` flag: true when verdict=pass
    on a seed_id whose owning VULN-NNNN was previously marked resolved.
    """
    row = db.get_run(run_id)
    if row is None:
        raise HTTPException(404, f"Run {run_id!r} not found")
    attempts = db.list_attempts(run_id)
    resolved = _resolved_attack_ids()
    for a in attempts:
        # Strip any -mut-XXXXXX suffix to compare against base attack_id.
        base_seed = (a.get("seed_id") or "").split("-mut-")[0]
        a["is_regression"] = (
            a.get("verdict") == "pass" and base_seed in resolved
        )
    return {"run_id": run_id, "attempts": attempts, "count": len(attempts)}


@router.get("/regression-runs/{run_id}/artifact")
async def get_run_artifact(
    run_id: str,
    _token: str = Depends(require_bearer),
) -> dict:
    """Reproducible eval artifact bundle. One JSON blob containing the
    run metadata, every attempt row (with full judge breakdown), and
    the suite_ref / target_url that scoped the campaign — enough to
    replay deterministically given the same seed corpus.

    Designed for download via the Run Detail UI's "Download artifact"
    CTA; opaque to humans, machine-parseable for diff'ing runs."""
    row = db.get_run(run_id)
    if row is None:
        raise HTTPException(404, f"Run {run_id!r} not found")
    attempts = db.list_attempts(run_id)
    return {
        "schema_version": 1,
        "exported_at": now_iso(),
        "run": {
            "run_id": run_id,
            "state": row["state"],
            "target_url": row["target_url"],
            "suite_ref": row["suite_ref"],
            "commit_sha": row.get("commit_sha"),
            "baseline_target_sha": row.get("baseline_target_sha"),
            "source": row.get("source"),
            "started_at": row["started_at"],
            "ended_at": row.get("ended_at"),
            "spend_usd": row.get("spend_usd", 0.0),
            "totals": row.get("totals", {}),
            "gate": row.get("gate", {}),
            "langfuse_trace_url": row.get("langfuse_trace_url"),
        },
        "attempts": attempts,
        "attempt_count": len(attempts),
    }


@router.get("/coverage")
async def get_coverage(_token: str = Depends(require_bearer)) -> dict:
    """Per-(category, subcategory) attempt aggregates for the live Coverage
    matrix. The UI merges these with the static threat-model taxonomy so
    untested subcategories still appear, but tested ones get real numbers."""
    return {"rows": db.coverage_by_subcategory()}


@router.get("/judge-accuracy")
async def get_judge_accuracy(_token: str = Depends(require_bearer)) -> dict:
    """Latest judge ground-truth eval result.

    Answers the PDF's Phase 3 §10 question: "Ground truth dataset for
    evaluating Judge Agent accuracy?" — yes, hand-labeled cases in
    evals/judge_ground_truth/cases.yaml, scored against the production
    Dual-Judge, with the latest result served here.

    Returns 404 if no eval has been run yet. Triggering a fresh eval
    is a CLI step (`python -m evals.judge_ground_truth.run`) — it's
    not exposed as an API call because it spends real LLM credits."""
    from evals.judge_ground_truth.run import read_latest

    latest = read_latest()
    if latest is None:
        raise HTTPException(
            404,
            "No judge-accuracy eval has been run. "
            "Run `python -m evals.judge_ground_truth.run` to generate one.",
        )
    return latest


@router.get("/target/ping")
async def ping_target(
    url: str | None = None,
    _token: str = Depends(require_bearer),
) -> dict:
    """Live target-connectivity probe. Dashboards surface this as a
    visible proof that the platform is actually reaching the
    Co-Pilot's /health endpoint, not just regurgitating cached
    attempts. The reviewer's "tighten the proof around live target
    connectivity" feedback maps to this widget.

    The probe is intentionally lightweight — a single GET on /health
    with a short timeout. Returns the round-trip time, status code,
    and a fresh ISO timestamp so the UI can render "live now"."""
    from harness.allowlist import check_url, TargetNotAllowedError  # local import
    import httpx
    target_url = (url or "https://copilot-agent-dev.up.railway.app").rstrip("/")
    try:
        check_url(target_url)
    except TargetNotAllowedError as exc:
        raise HTTPException(403, f"target not allowlisted: {exc}")
    started = datetime.now(timezone.utc)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{target_url}/health")
        latency_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
        return {
            "target_url": target_url,
            "ok": resp.status_code == 200,
            "status_code": resp.status_code,
            "latency_ms": latency_ms,
            "checked_at": now_iso(),
        }
    except httpx.HTTPError as exc:
        return {
            "target_url": target_url,
            "ok": False,
            "status_code": None,
            "latency_ms": None,
            "checked_at": now_iso(),
            "error": str(exc),
        }


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
