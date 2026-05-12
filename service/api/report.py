"""GET /report.csv — aggregate compliance export.

Emits a single CSV with three sections (findings, runs, audit_log)
separated by blank rows and section-marker rows. Designed to drop
into Excel / Google Sheets unchanged. Includes a metadata header
with report-generated-at, target host scope, and authorization-window
references for audit purposes.

Bearer-token gated like every other mutating-or-sensitive endpoint.
"""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from service import db
from service.api.findings import _all_findings
from service.auth import require_bearer


router = APIRouter()


# Static reference values mirrored from ARCHITECTURE.md §13. Keeping
# them here (vs querying somewhere) means the report stays self-
# contained and auditable.
AUTH_WINDOW_START = "2026-05-11"
AUTH_WINDOW_END = "2026-05-22"
TARGET_HOST_ALLOWLIST = [
    "copilot-agent-dev.up.railway.app",
    "copilot-agent-qa.up.railway.app",
    "copilot-agent-production-41de.up.railway.app",
]


def _generate_csv() -> str:
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")

    now = datetime.now(timezone.utc).isoformat()

    # ── Header / metadata ──────────────────────────────────────────
    w.writerow(["AgentForge Adversarial AI Security — Compliance Report"])
    w.writerow(["generated_at", now])
    w.writerow(["authorization_window_start", AUTH_WINDOW_START])
    w.writerow(["authorization_window_end", AUTH_WINDOW_END])
    w.writerow(["target_host_allowlist", "; ".join(TARGET_HOST_ALLOWLIST)])
    w.writerow(["spec_reference", "ARCHITECTURE.md §13"])
    w.writerow([])

    # ── Findings ───────────────────────────────────────────────────
    w.writerow(["=== FINDINGS ==="])
    w.writerow([
        "id",
        "title",
        "severity",
        "status",
        "category",
        "subcategory",
        "discovered",
        "target",
        "attack_id",
        "campaign_id",
        "repro_summary",
    ])
    for f in _all_findings():
        w.writerow([
            f.get("id", ""),
            f.get("title", ""),
            f.get("severity", ""),
            f.get("status", ""),
            f.get("category", ""),
            f.get("subcategory", ""),
            f.get("discovered", ""),
            f.get("target", ""),
            f.get("attack_id", ""),
            f.get("campaign_id", ""),
            (f.get("repro_summary", "") or "").replace("\n", " "),
        ])
    w.writerow([])

    # ── Run history ────────────────────────────────────────────────
    w.writerow(["=== RUN HISTORY ==="])
    w.writerow([
        "run_id",
        "state",
        "source",
        "target_url",
        "started_at",
        "ended_at",
        "duration_s",
        "attacks_total",
        "exploits_pass",
        "holds_fail",
        "partial",
        "inconclusive",
        "spend_usd",
        "gate_verdict",
        "gate_reasons",
        "commit_sha",
    ])
    runs = db.list_runs(limit=500)
    for r in runs:
        totals = r.get("totals") or {}
        gate = r.get("gate") or {}
        pass_ = totals.get("pass", 0) or 0
        fail = totals.get("fail", 0) or 0
        partial = totals.get("partial", 0) or 0
        inconclusive = totals.get("inconclusive", 0) or 0
        # duration_s isn't stored directly — compute from started_at/ended_at
        duration_s = ""
        if r.get("started_at") and r.get("ended_at"):
            try:
                s = datetime.fromisoformat(r["started_at"].replace("Z", "+00:00"))
                e = datetime.fromisoformat(r["ended_at"].replace("Z", "+00:00"))
                duration_s = str(int((e - s).total_seconds()))
            except Exception:
                duration_s = ""
        w.writerow([
            r.get("run_id", ""),
            r.get("state", ""),
            r.get("source", ""),
            r.get("target_url", ""),
            r.get("started_at", ""),
            r.get("ended_at", "") or "",
            duration_s,
            pass_ + fail + partial + inconclusive,
            pass_,
            fail,
            partial,
            inconclusive,
            f"{r.get('spend_usd', 0):.6f}",
            gate.get("verdict", "") if isinstance(gate, dict) else "",
            "; ".join(gate.get("reasons", []) or []) if isinstance(gate, dict) else "",
            r.get("commit_sha", "") or "",
        ])
    w.writerow([])

    # ── Audit log ──────────────────────────────────────────────────
    w.writerow(["=== AUDIT LOG ==="])
    w.writerow([
        "audit_id",
        "kind",
        "actor",
        "commit_sha",
        "ci_url",
        "detail_json",
        "created_at",
    ])
    with db.get_conn() as conn:
        audit_rows = conn.execute(
            "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 1000",
        ).fetchall()
    for a in audit_rows:
        # Compress detail_json onto a single line for CSV readability
        detail = a["detail_json"] or ""
        try:
            detail = json.dumps(json.loads(detail), separators=(",", ":"))
        except Exception:
            pass
        w.writerow([
            a["audit_id"],
            a["kind"],
            a["actor"] or "",
            a["commit_sha"] or "",
            a["ci_url"] or "",
            detail,
            a["created_at"],
        ])

    return buf.getvalue()


@router.get("/report.csv")
async def compliance_report(_token: str = Depends(require_bearer)):
    csv_text = _generate_csv()
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"adversary-compliance-report-{ts}.csv"
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
