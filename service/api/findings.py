"""GET /findings, GET /findings/{id}, PATCH /findings/{id}/status.

Findings are markdown files under findings/VULN-NNNN.md — the file IS
the source of truth for *content* (title, severity, body, repro,
metadata). The one mutable field is **status**: an SQLite override
table tracks any runtime changes so a finding can be moved through
open → in_progress → resolved without a redeploy. Markdown stays as
the baseline; the override layer just rewrites the served `status`
field and adds the change-history (changed_at, changed_by, commit_sha,
rationale).

Every mutation also writes an `audit_log` row so the full change
history is recoverable from the DB regardless of UI state.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from service import db
from service.auth import require_bearer


router = APIRouter()


FINDINGS_DIR = Path("findings")
_FILENAME_RE = re.compile(r"^VULN-\d+\.md$")
_FIELD_RE = re.compile(r"^\|\s*\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|$")
_SEVERITY_RE = re.compile(r"\*\*(Critical|High|Medium|Low)\*\*", re.IGNORECASE)
_VALID_STATUSES = {"open", "in_progress", "resolved", "draft"}


def _parse_finding(path: Path) -> dict[str, Any]:
    text = path.read_text()
    lines = text.splitlines()

    title_line = next((l for l in lines if l.startswith("# ")), "")
    title_match = re.match(r"#\s+VULN-\d+\s+—\s+(.+)$", title_line)
    title = title_match.group(1) if title_match else path.stem

    meta: dict[str, str] = {}
    for line in lines:
        m = _FIELD_RE.match(line)
        if m:
            key = m.group(1).strip().lower().replace(" ", "_")
            val = m.group(2).strip()
            meta[key] = val

    sev_raw = meta.get("severity", "")
    sev_match = _SEVERITY_RE.search(sev_raw)
    severity = sev_match.group(1).lower() if sev_match else "high"

    status_raw = meta.get("status", "").lower()
    if "open" in status_raw:
        status = "open"
    elif "resolved" in status_raw:
        status = "resolved"
    elif "progress" in status_raw:
        status = "in_progress"
    elif "draft" in status_raw:
        status = "draft"
    else:
        status = "open"

    desc_lines: list[str] = []
    in_desc = False
    for line in lines:
        if line.startswith("## Description"):
            in_desc = True
            continue
        if in_desc:
            if line.startswith("## "):
                break
            if line.strip():
                desc_lines.append(line.strip())
                if len(" ".join(desc_lines)) > 400:
                    break
    summary = " ".join(desc_lines)[:600]

    return {
        "id": path.stem,
        "title": title,
        "severity": severity,
        "status": status,
        "category": meta.get("category", "").split(" / ")[0].strip().lower().replace(" ", "_"),
        "subcategory": meta.get("category", "").split(" / ")[-1].strip().lower().replace(" ", "_"),
        "discovered": meta.get("discovered", ""),
        "target": meta.get("target", ""),
        "attack_id": meta.get("attack_id", "").strip("`").split()[0] if meta.get("attack_id") else "",
        "campaign_id": meta.get("campaign", ""),
        "threat_model_ref": meta.get("threat_model_ref", ""),
        "repro_summary": summary,
        "body_markdown": text,
    }


def _apply_override(finding: dict[str, Any], override: dict[str, Any] | None) -> dict[str, Any]:
    """Merge a status override into a parsed finding. The markdown stays
    intact (still available as body_markdown); only the served `status`
    field and a status_history block change."""
    if not override:
        return finding
    return {
        **finding,
        "status": override["status"],
        "status_history": {
            "changed_at": override["changed_at"],
            "changed_by": override.get("changed_by"),
            "commit_sha": override.get("commit_sha"),
            "rationale": override.get("rationale"),
        },
    }


# Category → default severity mapping. Used for auto-generated
# finding entries from the attempts table when no hand-authored
# VULN-NNNN.md exists yet. The hand-authored markdown wins when the
# Documentation Agent later "promotes" the auto-finding.
_CATEGORY_SEVERITY: dict[str, str] = {
    "data_exfiltration":          "critical",
    "identity_role_exploitation": "high",
    "prompt_injection":           "high",
    "state_corruption":           "high",
    "tool_misuse":                "medium",
    "denial_of_service":          "medium",
}


def _next_vuln_id(claimed: set[str]) -> str:
    """Allocate the next VULN-NNNN id not in `claimed`."""
    n = 1
    while f"VULN-{n:04d}" in claimed:
        n += 1
    return f"VULN-{n:04d}"


def _all_claimed_vuln_ids() -> set[str]:
    """Every VULN-NNNN id currently in use, across on-disk markdown
    files and DB-allocated rows. Used by allocators to avoid handing
    out a duplicate."""
    claimed: set[str] = set()
    if FINDINGS_DIR.exists():
        for p in FINDINGS_DIR.glob("VULN-*.md"):
            if _FILENAME_RE.match(p.name):
                claimed.add(p.stem)
    for doc in db.list_doc_agent_outputs().values():
        if doc.get("assigned_vuln_id"):
            claimed.add(doc["assigned_vuln_id"])
    return claimed


def allocate_vuln_id_for(attack_id: str) -> str:
    """Idempotent: return the existing assigned_vuln_id for an
    attack_id if one is already persisted; allocate + persist a new
    one otherwise. Used by both the /findings list endpoint (lazy
    allocation at read time) and the runner's Doc Agent step (eager
    allocation so the rendered markdown gets the right id baked in).

    The DocAgent body still gets written by the runner via
    upsert_doc_agent_output; this only handles the id reservation.
    """
    existing = db.get_doc_agent_output(attack_id)
    if existing and existing.get("assigned_vuln_id"):
        return existing["assigned_vuln_id"]
    vuln_id = _next_vuln_id(_all_claimed_vuln_ids())
    if existing:
        db.set_doc_agent_vuln_id(attack_id, vuln_id)
    else:
        # Reserve via a minimal stub row. The runner will upsert real
        # title/body/severity over this when (and if) the Doc Agent
        # generates a writeup.
        now_iso_str = datetime.now(timezone.utc).isoformat()
        db.upsert_doc_agent_output({
            "attack_id":        attack_id,
            "title":            f"Exploit on {attack_id}",
            "severity":         "high",
            "body_markdown":    "",
            "campaign_id":      "",
            "model":            "",
            "generated_at":     now_iso_str,
            "status":           "absent",
            "assigned_vuln_id": vuln_id,
        })
    return vuln_id


def _exploit_findings_from_db(claimed_ids: set[str]) -> list[dict[str, Any]]:
    """Surface every distinct seed_id with verdict='pass' as a finding,
    rendered under a stable VULN-NNNN identifier.

    ID allocation: each attack_id gets a VULN-NNNN number persisted to
    documentation_agent_outputs.assigned_vuln_id on first encounter.
    Subsequent requests return the same id even if the row is later
    updated by the Doc Agent. `claimed_ids` is the set of ids already
    used by hand-authored markdown or previously-allocated DB rows.

    Body sources, prefer-most-polished:
      1. Documentation Agent output (status='completed') — the
         Sonnet-generated VULN-NNNN-shape writeup
      2. In-progress / failed stubs — banner above the raw response
      3. Bare stub when no doc row exists yet
    """
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT
                seed_id,
                category,
                subcategory,
                MIN(started_at) AS first_seen,
                MAX(started_at) AS last_seen,
                COUNT(*)        AS hit_count
            FROM attempts
            WHERE verdict = 'pass'
            GROUP BY seed_id, category, subcategory
            """,
        ).fetchall()
    doc_outputs = db.list_doc_agent_outputs()
    out: list[dict[str, Any]] = []
    for r in rows:
        seed_id = r["seed_id"]
        # Fetch the most-recent passing attempt's run_id + response_text
        # + the owning run's target_url so the finding carries the env
        # it was discovered on (per-target filtering in the UI relies
        # on this).
        with db.get_conn() as conn:
            latest = conn.execute(
                """
                SELECT a.run_id, a.response_text, a.started_at,
                       rr.target_url AS target_url
                FROM attempts a
                LEFT JOIN regression_runs rr ON rr.run_id = a.run_id
                WHERE a.seed_id = ? AND a.verdict = 'pass'
                ORDER BY a.started_at DESC
                LIMIT 1
                """,
                (seed_id,),
            ).fetchone()
        resp_text = (latest["response_text"] if latest else "") or ""
        target_url = (latest["target_url"] if latest else "") or ""

        doc = doc_outputs.get(seed_id)
        doc_status = (doc or {}).get("status", "absent")  # absent / in_progress / completed / failed

        stub_body = (
            f"# AUTO — Confirmed exploit on seed `{seed_id}`\n\n"
            f"**Category:** {r['category']} / {r['subcategory']}  \n"
            f"**First seen:** {r['first_seen']}  \n"
            f"**Last seen:** {r['last_seen']}  \n"
            f"**Confirmations:** {r['hit_count']} attempt(s) "
            f"verdicted `pass` by the dual-Judge.  \n\n"
            f"## Target response (most recent passing attempt)\n\n"
            f"```\n{resp_text[:4000]}\n```\n"
        )

        if doc_status == "completed":
            title = doc["title"]
            severity = doc["severity"]
            body = doc["body_markdown"]
            repro = f"Documented by Sonnet · {r['hit_count']} confirming attempt(s)"
        elif doc_status == "in_progress":
            title = f"Auto: exploit confirmed on {seed_id} (writing…)"
            severity = _CATEGORY_SEVERITY.get(r["category"], "high")
            body = (
                "> 🔄 **Documentation Agent (Claude Sonnet 4.6) is writing "
                "this report.** The polished version will replace this stub "
                "as soon as the call returns. Refresh in ~30s.\n\n"
                + stub_body
            )
            repro = "Documentation Agent in progress; raw evidence below"
        elif doc_status == "failed":
            title = doc["title"]
            severity = doc["severity"]
            body = doc["body_markdown"]
            repro = "Documentation Agent failed — see body for details"
        else:
            title = f"Auto: exploit confirmed on {seed_id}"
            severity = _CATEGORY_SEVERITY.get(r["category"], "high")
            body = (
                stub_body
                + "\n_Documentation Agent has not run for this attack yet. "
                "This entry will be replaced with a polished writeup at the "
                "end of the next campaign that re-confirms it._\n"
            )
            repro = (
                f"Confirmed exploit on {r['hit_count']} attempt(s); "
                f"see {r['category']}/{r['subcategory']} seed."
            )

            # Allocate stable VULN-NNNN id for this attack_id (persisted
        # so it stays the same across requests).
        vuln_id = allocate_vuln_id_for(seed_id)
        claimed_ids.add(vuln_id)

        out.append({
            "id": vuln_id,
            "title": title,
            "severity": severity,
            "status": "open",
            "category": r["category"],
            "subcategory": r["subcategory"],
            "discovered": r["first_seen"],
            "target": target_url,
            "attack_id": seed_id,
            "campaign_id": latest["run_id"] if latest else "",
            "threat_model_ref": "",
            "repro_summary": repro,
            "body_markdown": body,
            # Surface the Doc Agent lifecycle so the UI can render
            # a pill/spinner. "absent" means no row in the table yet.
            "doc_agent_status": doc_status,
        })
    return out


def _all_findings() -> list[dict[str, Any]]:
    overrides = db.list_finding_status_overrides()
    items: list[dict[str, Any]] = []
    claimed_attack_ids: set[str] = set()
    claimed_ids: set[str] = set()  # all VULN-NNNN strings in use

    # 1. Hand-authored markdown findings (source of truth).
    if FINDINGS_DIR.exists():
        for p in sorted(FINDINGS_DIR.glob("VULN-*.md")):
            if not _FILENAME_RE.match(p.name):
                continue
            try:
                parsed = _parse_finding(p)
                items.append(_apply_override(parsed, overrides.get(parsed["id"])))
                claimed_ids.add(parsed["id"])
                if parsed.get("attack_id"):
                    claimed_attack_ids.add(parsed["attack_id"].strip("`").strip())
            except Exception as exc:
                items.append({
                    "id": p.stem,
                    "title": p.stem,
                    "severity": "high",
                    "status": "open",
                    "_parse_error": str(exc),
                })
                claimed_ids.add(p.stem)

    # Pre-claim any VULN ids already allocated to doc_agent_outputs
    # rows so we don't accidentally hand the same number to a new
    # exploit on this request.
    for doc in db.list_doc_agent_outputs().values():
        if doc.get("assigned_vuln_id"):
            claimed_ids.add(doc["assigned_vuln_id"])

    # 2. DB-derived findings — every exploit gets a VULN-NNNN id
    # allocated on first encounter and persisted. Any seed_id already
    # covered by a hand-authored markdown is shadowed.
    for auto in _exploit_findings_from_db(claimed_ids):
        if auto["attack_id"].strip("`").strip() in claimed_attack_ids:
            continue
        items.append(_apply_override(auto, overrides.get(auto["id"])))

    return items


@router.get("/findings")
async def list_findings(_token: str = Depends(require_bearer)) -> dict:
    """List all confirmed vulnerability reports."""
    findings = _all_findings()
    summaries = [{k: v for k, v in f.items() if k != "body_markdown"} for f in findings]
    return {"findings": summaries, "count": len(summaries)}


@router.get("/findings/{finding_id}")
async def get_finding(finding_id: str, _token: str = Depends(require_bearer)) -> dict:
    """Get one finding by id. Resolves first against hand-authored
    VULN-NNNN.md files on disk, then against DB-allocated VULN-NNNN
    ids in the documentation_agent_outputs table."""
    override = db.get_finding_status_override(finding_id)

    # 1. On-disk markdown.
    path = FINDINGS_DIR / f"{finding_id}.md"
    if path.exists() and _FILENAME_RE.match(path.name):
        parsed = _parse_finding(path)
        return _apply_override(parsed, override)

    # 2. DB-allocated VULN-NNNN.
    doc_row = db.get_doc_agent_output_by_vuln_id(finding_id)
    if doc_row:
        # Resolve through _all_findings so the body/title/severity
        # rendering stays consistent with the list endpoint.
        for f in _all_findings():
            if f["id"] == finding_id:
                return _apply_override(f, override)

    raise HTTPException(404, f"Finding {finding_id!r} not found")


class StatusPatch(BaseModel):
    status: str = Field(..., description="open | in_progress | resolved")
    commit_sha: str | None = Field(None, description="SHA of the fix commit, if known")
    rationale: str | None = Field(None, description="Free-text justification for the status change")


@router.patch("/findings/{finding_id}/status")
async def update_finding_status(
    finding_id: str,
    payload: StatusPatch,
    _token: str = Depends(require_bearer),
) -> dict:
    """Move a finding through open → in_progress → resolved (or back).

    The on-disk markdown stays untouched; this writes an override row
    that the GET endpoints merge in. Every mutation also writes an
    audit_log row so the change history is recoverable.
    """
    if payload.status not in _VALID_STATUSES:
        raise HTTPException(
            422,
            f"status must be one of {sorted(_VALID_STATUSES)}, got {payload.status!r}",
        )

    # Resolve the finding — on-disk markdown first, then any
    # DB-allocated VULN-NNNN entry.
    parsed: dict[str, Any] | None = None
    path = FINDINGS_DIR / f"{finding_id}.md"
    if path.exists() and _FILENAME_RE.match(path.name):
        parsed = _parse_finding(path)
    elif db.get_doc_agent_output_by_vuln_id(finding_id):
        for f in _all_findings():
            if f["id"] == finding_id:
                parsed = f
                break
    if parsed is None:
        raise HTTPException(404, f"Finding {finding_id!r} not found")

    now = datetime.now(timezone.utc).isoformat()
    prior = db.get_finding_status_override(finding_id)
    prior_status = prior["status"] if prior else parsed["status"]

    db.upsert_finding_status_override({
        "finding_id": finding_id,
        "status": payload.status,
        "changed_at": now,
        "changed_by": "api",
        "commit_sha": payload.commit_sha,
        "rationale": payload.rationale,
    })

    db.insert_audit({
        "audit_id": uuid.uuid4().hex,
        "kind": "finding_status_change",
        "actor": "api",
        "commit_sha": payload.commit_sha,
        "ci_url": None,
        "detail_json": json.dumps({
            "finding_id": finding_id,
            "from": prior_status,
            "to": payload.status,
            "rationale": payload.rationale,
        }),
        "created_at": now,
    })

    return _apply_override(parsed, db.get_finding_status_override(finding_id))
