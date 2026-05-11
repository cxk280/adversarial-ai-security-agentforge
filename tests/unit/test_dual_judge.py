"""Unit tests for the DualJudge decision protocol.

Both judges and the arbitrator are stubbed — no real API calls. The
tests focus on the verdict-combination matrix in ARCHITECTURE.md §1.2.1."""

from __future__ import annotations

from dataclasses import dataclass
import pytest

from agents.judge.base import JudgeVerdict
from agents.judge.dual import DualJudge


@dataclass
class StubJudge:
    model_name: str
    verdict: str
    rationale: str = "stub rationale"
    cost: float = 0.005

    async def score(self, *, attack, target_response, rubric, category, subcategory):
        return JudgeVerdict(
            verdict=self.verdict,
            rationale=self.rationale,
            model=self.model_name,
            prompt_tokens=100,
            completion_tokens=20,
            usd_cost=self.cost,
        )


@dataclass
class StubArbitrator:
    model_name: str = "stub-arb"
    verdict: str = "pass"
    rationale: str = "stub arb rationale"
    cost: float = 0.02
    call_count: int = 0

    async def arbitrate(self, *, attack, target_response, rubric, category, subcategory, primary, secondary):
        self.call_count += 1
        return JudgeVerdict(
            verdict=self.verdict,
            rationale=self.rationale,
            model=self.model_name,
            prompt_tokens=200,
            completion_tokens=40,
            usd_cost=self.cost,
        )


_CASE_KWARGS = dict(
    attack="test attack",
    target_response="test response",
    rubric="test rubric",
    category="test_category",
    subcategory="test_subcategory",
)


# ─── Both judges agree → high confidence, no arbitrator call ──────────────

@pytest.mark.asyncio
async def test_both_pass_yields_high_confidence_pass():
    p = StubJudge("haiku", "pass")
    s = StubJudge("gpt", "pass")
    arb = StubArbitrator()
    dj = DualJudge(primary=p, secondary=s, arbitrator=arb)
    fv = await dj.score(**_CASE_KWARGS)
    assert fv.verdict == "pass"
    assert fv.confidence == "high"
    assert fv.agreed is True
    assert fv.arbitrator is None
    assert arb.call_count == 0
    assert fv.reason_code == "both_pass"


@pytest.mark.asyncio
async def test_both_fail_yields_high_confidence_fail():
    dj = DualJudge(primary=StubJudge("haiku", "fail"), secondary=StubJudge("gpt", "fail"))
    fv = await dj.score(**_CASE_KWARGS)
    assert fv.verdict == "fail"
    assert fv.confidence == "high"
    assert fv.agreed is True


@pytest.mark.asyncio
async def test_both_partial_yields_medium_confidence_partial():
    dj = DualJudge(primary=StubJudge("haiku", "partial"), secondary=StubJudge("gpt", "partial"))
    fv = await dj.score(**_CASE_KWARGS)
    assert fv.verdict == "partial"
    assert fv.confidence == "medium"
    assert fv.agreed is True


# ─── Disagreement → arbitrator decides ─────────────────────────────────

@pytest.mark.asyncio
async def test_disagreement_fires_arbitrator_and_yields_medium_confidence():
    arb = StubArbitrator(verdict="pass")
    dj = DualJudge(
        primary=StubJudge("haiku", "pass"),
        secondary=StubJudge("gpt", "fail"),
        arbitrator=arb,
    )
    fv = await dj.score(**_CASE_KWARGS)
    assert arb.call_count == 1
    assert fv.verdict == "pass"
    assert fv.confidence == "medium"
    assert fv.arbitrator is not None
    assert fv.arbitrator.model == "stub-arb"
    assert fv.agreed is False
    assert fv.reason_code == "arbitrator_pass"


@pytest.mark.asyncio
async def test_disagreement_without_arbitrator_yields_inconclusive():
    dj = DualJudge(
        primary=StubJudge("haiku", "pass"),
        secondary=StubJudge("gpt", "fail"),
        arbitrator=None,
    )
    fv = await dj.score(**_CASE_KWARGS)
    assert fv.verdict == "inconclusive"
    assert fv.confidence == "low"
    assert fv.arbitrator is None
    assert "no arbitrator configured" in fv.rationale


# ─── Inconclusive short-circuits everything ────────────────────────────

@pytest.mark.asyncio
async def test_either_inconclusive_yields_inconclusive_low_confidence():
    arb = StubArbitrator()
    dj = DualJudge(
        primary=StubJudge("haiku", "inconclusive"),
        secondary=StubJudge("gpt", "pass"),
        arbitrator=arb,
    )
    fv = await dj.score(**_CASE_KWARGS)
    assert fv.verdict == "inconclusive"
    assert fv.confidence == "low"
    assert arb.call_count == 0, "Arbitrator must not fire when either judge is inconclusive"


# ─── Cost accumulation ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_total_usd_sums_judges_only_on_agreement():
    dj = DualJudge(
        primary=StubJudge("haiku", "pass", cost=0.005),
        secondary=StubJudge("gpt", "pass", cost=0.0018),
    )
    fv = await dj.score(**_CASE_KWARGS)
    assert fv.total_usd == pytest.approx(0.005 + 0.0018)


@pytest.mark.asyncio
async def test_total_usd_includes_arbitrator_on_disagreement():
    arb = StubArbitrator(verdict="fail", cost=0.020)
    dj = DualJudge(
        primary=StubJudge("haiku", "pass", cost=0.005),
        secondary=StubJudge("gpt", "fail", cost=0.0018),
        arbitrator=arb,
    )
    fv = await dj.score(**_CASE_KWARGS)
    assert fv.total_usd == pytest.approx(0.005 + 0.0018 + 0.020)
