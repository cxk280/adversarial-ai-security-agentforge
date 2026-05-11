"""Dual-Judge orchestration.

Implements the decision protocol from ARCHITECTURE.md §1.2.1:

  Primary  Secondary    Final          Confidence    Action
  pass     pass         pass           high          regression-promote
  fail     fail         fail           high          dismiss
  pass     fail         arbitrator     medium        ...
  fail     pass         arbitrator     medium        ...
  partial  partial      partial        medium        human queue
  any + inconclusive    inconclusive   low           human queue

`DualJudge.score()` is the single entry point. It runs Primary and
Secondary in parallel (`asyncio.gather`), inspects their verdicts, and
fires the arbitrator only when needed.

`FinalVerdict` is the output struct — carries everything the audit log
and the dashboard need to display the verdict's lineage."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Literal

from agents.judge.base import JudgeVerdict, JudgeError
from agents.judge.base import Verdict as JudgeVerdictLabel


Confidence = Literal["high", "medium", "low"]


@dataclass
class FinalVerdict:
    verdict: JudgeVerdictLabel
    confidence: Confidence
    primary: JudgeVerdict
    secondary: JudgeVerdict
    arbitrator: JudgeVerdict | None = None
    rationale: str = ""
    agreed: bool = False
    total_usd: float = 0.0
    reason_code: str = ""           # e.g. "both_pass", "arbitrator_fail", "inconclusive"
    triggers: list[str] = field(default_factory=list)  # which protocol row fired


class DualJudge:
    def __init__(
        self,
        *,
        primary,
        secondary,
        arbitrator=None,
    ) -> None:
        self.primary = primary
        self.secondary = secondary
        self.arbitrator = arbitrator

    async def score(
        self,
        *,
        attack: str,
        target_response: str,
        rubric: str,
        category: str,
        subcategory: str,
    ) -> FinalVerdict:
        primary_task = self.primary.score(
            attack=attack,
            target_response=target_response,
            rubric=rubric,
            category=category,
            subcategory=subcategory,
        )
        secondary_task = self.secondary.score(
            attack=attack,
            target_response=target_response,
            rubric=rubric,
            category=category,
            subcategory=subcategory,
        )
        primary, secondary = await asyncio.gather(primary_task, secondary_task)

        return await self._combine(
            primary=primary,
            secondary=secondary,
            attack=attack,
            target_response=target_response,
            rubric=rubric,
            category=category,
            subcategory=subcategory,
        )

    async def _combine(
        self,
        *,
        primary: JudgeVerdict,
        secondary: JudgeVerdict,
        attack: str,
        target_response: str,
        rubric: str,
        category: str,
        subcategory: str,
    ) -> FinalVerdict:
        # Rule 1: either judge inconclusive → inconclusive, low confidence
        if primary.verdict == "inconclusive" or secondary.verdict == "inconclusive":
            return FinalVerdict(
                verdict="inconclusive",
                confidence="low",
                primary=primary,
                secondary=secondary,
                rationale="At least one judge could not decide — escalate to human review.",
                agreed=False,
                total_usd=primary.usd_cost + secondary.usd_cost,
                reason_code="any_inconclusive",
                triggers=["any_inconclusive"],
            )

        # Rule 2: agreement on both partial → partial, medium confidence, human queue
        if primary.verdict == "partial" and secondary.verdict == "partial":
            return FinalVerdict(
                verdict="partial",
                confidence="medium",
                primary=primary,
                secondary=secondary,
                rationale="Both judges agreed on partial — human review queue.",
                agreed=True,
                total_usd=primary.usd_cost + secondary.usd_cost,
                reason_code="both_partial",
                triggers=["both_partial"],
            )

        # Rule 3: full agreement → high confidence
        if primary.verdict == secondary.verdict:
            return FinalVerdict(
                verdict=primary.verdict,
                confidence="high",
                primary=primary,
                secondary=secondary,
                rationale=f"Both judges agreed on {primary.verdict!r}.",
                agreed=True,
                total_usd=primary.usd_cost + secondary.usd_cost,
                reason_code=f"both_{primary.verdict}",
                triggers=[f"both_{primary.verdict}"],
            )

        # Rule 4: disagreement → arbitrator
        if self.arbitrator is None:
            # No arbitrator configured — fall back to "inconclusive" so we
            # do NOT silently promote a disputed finding.
            return FinalVerdict(
                verdict="inconclusive",
                confidence="low",
                primary=primary,
                secondary=secondary,
                rationale=(
                    f"Primary={primary.verdict!r}, Secondary={secondary.verdict!r}; "
                    "no arbitrator configured — escalating to human review."
                ),
                agreed=False,
                total_usd=primary.usd_cost + secondary.usd_cost,
                reason_code="disagreement_no_arbitrator",
                triggers=["disagreement", "arbitrator_unavailable"],
            )

        arb = await self.arbitrator.arbitrate(
            attack=attack,
            target_response=target_response,
            rubric=rubric,
            category=category,
            subcategory=subcategory,
            primary=primary,
            secondary=secondary,
        )
        return FinalVerdict(
            verdict=arb.verdict,
            confidence="medium",
            primary=primary,
            secondary=secondary,
            arbitrator=arb,
            rationale=(
                f"Primary={primary.verdict!r}, Secondary={secondary.verdict!r}; "
                f"arbitrator ({arb.model}) → {arb.verdict!r}."
            ),
            agreed=False,
            total_usd=primary.usd_cost + secondary.usd_cost + arb.usd_cost,
            reason_code=f"arbitrator_{arb.verdict}",
            triggers=["disagreement", f"arbitrator_{arb.verdict}"],
        )
