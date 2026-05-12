"""GET /findings and /findings/{id} — serve the markdown vulnerability
reports under findings/ as a structured API.

Reports are read from disk at request time (cached at module load with
mtime invalidation in a follow-up). This keeps the API authoritative
against the on-disk source of truth without a separate ingest step."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from service.auth import require_bearer


router = APIRouter()


FINDINGS_DIR = Path("findings")
_FILENAME_RE = re.compile(r"^VULN-\d+\.md$")
_FIELD_RE = re.compile(r"^\|\s*\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|$")
_SEVERITY_RE = re.compile(r"\*\*(Critical|High|Medium|Low)\*\*", re.IGNORECASE)


def _parse_finding(path: Path) -> dict[str, Any]:
    text = path.read_text()
    lines = text.splitlines()

    # Title is the first H1 line — "# VULN-NNNN — <title>"
    title_line = next((l for l in lines if l.startswith("# ")), "")
    title_match = re.match(r"#\s+VULN-\d+\s+—\s+(.+)$", title_line)
    title = title_match.group(1) if title_match else path.stem

    # Pull metadata table (lines like "| **Severity** | **Critical** … |")
    meta: dict[str, str] = {}
    for line in lines:
        m = _FIELD_RE.match(line)
        if m:
            key = m.group(1).strip().lower().replace(" ", "_")
            val = m.group(2).strip()
            meta[key] = val

    # Extract severity tier from the Severity row even when it's wrapped
    # in extra formatting like "**Critical** (CVSS-style 9.0)"
    sev_raw = meta.get("severity", "")
    sev_match = _SEVERITY_RE.search(sev_raw)
    severity = sev_match.group(1).lower() if sev_match else "high"

    # Status is "Open — fix pending" → "open"
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

    # Extract the Description section (first paragraph under ## Description)
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


def _all_findings() -> list[dict[str, Any]]:
    if not FINDINGS_DIR.exists():
        return []
    items = []
    for p in sorted(FINDINGS_DIR.glob("VULN-*.md")):
        if not _FILENAME_RE.match(p.name):
            continue
        try:
            items.append(_parse_finding(p))
        except Exception as exc:
            # Don't 500 the whole endpoint on one bad file.
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
    # Return summaries (no full body_markdown to keep payloads small)
    summaries = [{k: v for k, v in f.items() if k != "body_markdown"} for f in findings]
    return {"findings": summaries, "count": len(summaries)}


@router.get("/findings/{finding_id}")
async def get_finding(finding_id: str, _token: str = Depends(require_bearer)) -> dict:
    """Get one finding by its VULN-NNNN id."""
    path = FINDINGS_DIR / f"{finding_id}.md"
    if not path.exists() or not _FILENAME_RE.match(path.name):
        raise HTTPException(404, f"Finding {finding_id!r} not found")
    return _parse_finding(path)
