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


def _all_findings() -> list[dict[str, Any]]:
    if not FINDINGS_DIR.exists():
        return []
    overrides = db.list_finding_status_overrides()
    items = []
    for p in sorted(FINDINGS_DIR.glob("VULN-*.md")):
        if not _FILENAME_RE.match(p.name):
            continue
        try:
            parsed = _parse_finding(p)
            items.append(_apply_override(parsed, overrides.get(parsed["id"])))
        except Exception as exc:
            items.append({
                "id": p.stem,
                "title": p.stem,
                "severity": "high",
                "status": "open",
                "_parse_error": str(exc),
            })
    return items


@router.get("/findings")
async def list_findings(_token: str = Depends(require_bearer)) -> dict:
    """List all confirmed vulnerability reports."""
    findings = _all_findings()
    summaries = [{k: v for k, v in f.items() if k != "body_markdown"} for f in findings]
    return {"findings": summaries, "count": len(summaries)}


@router.get("/findings/{finding_id}")
async def get_finding(finding_id: str, _token: str = Depends(require_bearer)) -> dict:
    """Get one finding by its VULN-NNNN id."""
    path = FINDINGS_DIR / f"{finding_id}.md"
    if not path.exists() or not _FILENAME_RE.match(path.name):
        raise HTTPException(404, f"Finding {finding_id!r} not found")
    parsed = _parse_finding(path)
    override = db.get_finding_status_override(finding_id)
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
    path = FINDINGS_DIR / f"{finding_id}.md"
    if not path.exists() or not _FILENAME_RE.match(path.name):
        raise HTTPException(404, f"Finding {finding_id!r} not found")

    now = datetime.now(timezone.utc).isoformat()
    parsed = _parse_finding(path)
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
