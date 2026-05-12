"""Pydantic schemas for the /regression-runs and /audit/bypass endpoints,
matching the contract documented in CI_INTEGRATION.md Part 2."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from harness.allowlist import check_url, TargetNotAllowedError


# ─── /regression-runs ──────────────────────────────────────────────

class RunSubmit(BaseModel):
    target_url: str = Field(..., min_length=1, max_length=512)
    suite_ref: str = Field(..., min_length=1, max_length=128)
    commit_sha: str | None = Field(default=None, max_length=64)
    baseline_target_sha: str | None = Field(default=None, max_length=64)
    source: Literal["circleci", "manual", "scheduled"] = "manual"
    source_url: str | None = Field(default=None, max_length=512)
    max_seconds: int = Field(default=300, ge=10, le=1800)
    budget_usd: float = Field(default=0.50, ge=0.01, le=20.00)
    # Optional override — when provided, the runner uses these seed
    # directories instead of the suite_ref's default category list.
    # Lets the dashboard launch tailored campaigns without minting a
    # new suite. Must be a non-empty subset of the on-disk dirs in
    # evals/seeds/.
    categories: list[str] | None = Field(default=None, max_length=32)

    @field_validator("target_url")
    @classmethod
    def _enforce_allowlist(cls, v: str) -> str:
        try:
            check_url(v)
        except TargetNotAllowedError as exc:
            raise ValueError(str(exc)) from exc
        return v


class RunAccepted(BaseModel):
    run_id: str
    state: Literal["queued", "running", "completed", "failed", "cancelled"]
    estimated_seconds: int
    links: dict[str, str]


class RunTotals(BaseModel):
    pass_: int = Field(default=0, alias="pass")
    fail: int = 0
    partial: int = 0
    inconclusive: int = 0


class RunDeltas(BaseModel):
    new_passes_high_sev: int = 0
    new_passes_total: int = 0
    pass_rate_change_pct: float = 0.0
    cost_per_cycle_change_pct: float = 0.0


class RunGate(BaseModel):
    verdict: Literal["pass", "fail", "error"]
    reasons: list[str] = Field(default_factory=list)


class RunStatus(BaseModel):
    run_id: str
    state: Literal["queued", "running", "completed", "failed", "cancelled"]
    started_at: datetime
    ended_at: datetime | None = None
    duration_s: int | None = None
    spend_usd: float = 0.0
    target_url: str
    target_sha: str | None = None
    baseline_sha: str | None = None
    totals: RunTotals = Field(default_factory=RunTotals)
    deltas: RunDeltas = Field(default_factory=RunDeltas)
    gate: RunGate | None = None
    progress: dict[str, int] | None = None
    links: dict[str, str]


# ─── /audit/bypass ─────────────────────────────────────────────────

class BypassRecord(BaseModel):
    commit_sha: str = Field(..., min_length=1, max_length=64)
    actor: str | None = Field(default=None, max_length=128)
    ci_url: str | None = Field(default=None, max_length=512)
    justification: str = Field(..., min_length=10, max_length=4000)


class AuditAccepted(BaseModel):
    audit_id: str
    created_at: datetime


# ─── Helpers ───────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
