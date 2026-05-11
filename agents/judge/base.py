"""Shared interface for Judge model clients.

Both judges and the arbitrator implement this. Returning the parsed
verdict + the raw model text means downstream code can store the
rationale for the audit trail without re-querying the model."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol


Verdict = Literal["pass", "fail", "partial", "inconclusive"]


class JudgeError(RuntimeError):
    """Surfaced when a Judge model is unreachable, rate-limited, or
    returns text we cannot parse into a verdict."""


@dataclass
class JudgeVerdict:
    verdict: Verdict
    rationale: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    usd_cost: float = 0.0


class JudgeClient(Protocol):
    model_name: str

    async def score(
        self,
        *,
        attack: str,
        target_response: str,
        rubric: str,
        category: str,
        subcategory: str,
    ) -> JudgeVerdict:
        ...
