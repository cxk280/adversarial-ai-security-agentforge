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


def _exploit_findings_from_db() -> list[dict[str, Any]]:
    """Surface every distinct seed_id with verdict='pass' as a finding.

    Acts as the immediate-visibility fallback for the Documentation
    Agent path (ARCHITECTURE §1.3) — when the Judges confirm an
    exploit, the corresponding attempt row gets summarised here as a
    AUTO-<seed_id> finding entry. Hand-authored VULN-NNNN.md files
    take precedence (matched by attack_id), so the polished version
    shadows the auto entry once it's been written.

    Body content comes from the most recent passing attempt's
    response_text — gives the reviewer the exact evidence the Judges
    flagged, without waiting on the markdown writer.
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
    out: list[dict[str, Any]] = []
    for r in rows:
        # Fetch the most-recent passing attempt's run_id + response_text
        with db.get_conn() as conn:
            latest = conn.execute(
                """
                SELECT run_id, response_text, started_at
                FROM attempts
                WHERE seed_id = ? AND verdict = 'pass'
                ORDER BY started_at DESC
                LIMIT 1
                """,
                (r["seed_id"],),
            ).fetchone()
        resp_text = (latest["response_text"] if latest else "") or ""
        body = (
            f"# AUTO — Confirmed exploit on seed `{r['seed_id']}`\n\n"
            f"**Category:** {r['category']} / {r['subcategory']}  \n"
            f"**First seen:** {r['first_seen']}  \n"
            f"**Last seen:** {r['last_seen']}  \n"
            f"**Confirmations:** {r['hit_count']} attempt(s) "
            f"verdicted `pass` by the dual-Judge.  \n\n"
            f"## Target response (most recent passing attempt)\n\n"
            f"```\n{resp_text[:4000]}\n```\n\n"
            f"_This is an auto-generated finding from the attempts table. "
            f"A hand-authored `VULN-NNNN.md` will supersede this entry once "
            f"the Documentation Agent promotes it (currently a manual step)._\n"
        )
        out.append({
            "id": f"AUTO-{r['seed_id']}",
            "title": f"Auto: exploit confirmed on {r['seed_id']}",
            "severity": _CATEGORY_SEVERITY.get(r["category"], "high"),
            "status": "open",
            "category": r["category"],
            "subcategory": r["subcategory"],
            "discovered": r["first_seen"],
            "target": "",
            "attack_id": r["seed_id"],
            "campaign_id": latest["run_id"] if latest else "",
            "threat_model_ref": "",
            "repro_summary": (
                f"Confirmed exploit on {r['hit_count']} attempt(s); "
                f"see {r['category']}/{r['subcategory']} seed."
            ),
            "body_markdown": body,
        })
    return out


def _all_findings() -> list[dict[str, Any]]:
    overrides = db.list_finding_status_overrides()
    items: list[dict[str, Any]] = []
    claimed_attack_ids: set[str] = set()

    # 1. Hand-authored markdown findings (source of truth).
    if FINDINGS_DIR.exists():
        for p in sorted(FINDINGS_DIR.glob("VULN-*.md")):
            if not _FILENAME_RE.match(p.name):
                continue
            try:
                parsed = _parse_finding(p)
                items.append(_apply_override(parsed, overrides.get(parsed["id"])))
                if parsed.get("attack_id"):
                    # The parser sometimes leaves stray backticks on the
                    # attack_id (legacy markdown formatting). Normalise
                    # so the auto-finding dedupe lines up.
                    claimed_attack_ids.add(parsed["attack_id"].strip("`").strip())
            except Exception as exc:
                items.append({
                    "id": p.stem,
                    "title": p.stem,
                    "severity": "high",
                    "status": "open",
                    "_parse_error": str(exc),
                })

    # 2. Auto-generated findings from the attempts table. Any
    # seed_id already covered by a hand-authored markdown is skipped.
    for auto in _exploit_findings_from_db():
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
    """Get one finding by id. Supports both hand-authored VULN-NNNN
    markdown files and auto-generated AUTO-<seed_id> entries derived
    from the attempts table."""
    override = db.get_finding_status_override(finding_id)
    if finding_id.startswith("AUTO-"):
        # Reconstruct from the attempts table on demand.
        for auto in _exploit_findings_from_db():
            if auto["id"] == finding_id:
                return _apply_override(auto, override)
        raise HTTPException(404, f"Finding {finding_id!r} not found")
    path = FINDINGS_DIR / f"{finding_id}.md"
    if not path.exists() or not _FILENAME_RE.match(path.name):
        raise HTTPException(404, f"Finding {finding_id!r} not found")
    parsed = _parse_finding(path)
    return _apply_override(parsed, override)


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

    # AUTO-<seed_id> entries don't have a markdown file — resolve them
    # from the attempts table instead.
    parsed: dict[str, Any] | None = None
    if finding_id.startswith("AUTO-"):
        for auto in _exploit_findings_from_db():
            if auto["id"] == finding_id:
                parsed = auto
                break
        if parsed is None:
            raise HTTPException(404, f"Finding {finding_id!r} not found")
    else:
        path = FINDINGS_DIR / f"{finding_id}.md"
        if not path.exists() or not _FILENAME_RE.match(path.name):
            raise HTTPException(404, f"Finding {finding_id!r} not found")
        parsed = _parse_finding(path)

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
