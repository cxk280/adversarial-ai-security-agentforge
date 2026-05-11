"""POST /audit/bypass — CI records when a force-promote past adversarial
regression happens via [adversarial-bypass] commit message."""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, status

from service import db
from service.auth import require_bearer
from service.models import AuditAccepted, BypassRecord, now_iso


router = APIRouter()


@router.post("/audit/bypass", response_model=AuditAccepted, status_code=status.HTTP_201_CREATED)
async def record_bypass(
    payload: BypassRecord,
    _token: str = Depends(require_bearer),
) -> AuditAccepted:
    audit_id = uuid.uuid4().hex
    created_at = now_iso()
    db.insert_audit(
        {
            "audit_id": audit_id,
            "kind": "adversarial_bypass",
            "actor": payload.actor,
            "commit_sha": payload.commit_sha,
            "ci_url": payload.ci_url,
            "detail_json": json.dumps({"justification": payload.justification}),
            "created_at": created_at,
        }
    )
    return AuditAccepted(audit_id=audit_id, created_at=created_at)
