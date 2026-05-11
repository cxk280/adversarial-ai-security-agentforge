"""Unit tests for the 7-trigger escalation policy (ARCHITECTURE.md §1.1.1)."""

from __future__ import annotations

import pytest

from agents.red_team.escalation import (
    CampaignState,
    TriggerToggles,
    decide,
    REASONING_HEAVY_CATEGORIES,
)


def test_no_triggers_means_no_escalation():
    decision = decide(CampaignState())
    assert decision.should_escalate is False
    assert decision.triggers_fired == []


# ─── Trigger 1: refusal rate

def test_t1_fires_above_threshold():
    state = CampaignState(refusal_count_last_10=4)
    decision = decide(state)
    assert decision.should_escalate is True
    assert decision.triggers_fired == ["1_refusal_rate"]
    assert "Trigger 1" in decision.reason


def test_t1_does_not_fire_at_threshold():
    # 3 refusals = exactly 30% — boundary case; threshold is "> 30%".
    state = CampaignState(refusal_count_last_10=3)
    assert decide(state).should_escalate is False


def test_t1_can_be_toggled_off():
    state = CampaignState(refusal_count_last_10=10)
    toggles = TriggerToggles(t1_refusal_rate=False)
    assert decide(state, toggles).should_escalate is False


# ─── Trigger 2: TAP depth without Judge-pass

def test_t2_fires_when_stuck_at_depth():
    state = CampaignState(tap_max_depth_so_far=4, tap_judge_passes_at_max_depth=0)
    decision = decide(state)
    assert decision.should_escalate is True
    assert decision.triggers_fired == ["2_tap_depth"]


def test_t2_does_not_fire_if_passes_exist_at_depth():
    state = CampaignState(tap_max_depth_so_far=5, tap_judge_passes_at_max_depth=1)
    assert decide(state).should_escalate is False


def test_t2_does_not_fire_at_shallow_depth():
    state = CampaignState(tap_max_depth_so_far=3, tap_judge_passes_at_max_depth=0)
    assert decide(state).should_escalate is False


# ─── Trigger 3: reasoning-heavy category

@pytest.mark.parametrize(
    "category,subcategory",
    [
        ("prompt_injection", "multi_turn_crescendo"),
        ("prompt_injection", "indirect_reasoning_required"),
        ("identity_role_exploitation", "trust_boundary"),
    ],
)
def test_t3_fires_for_each_reasoning_heavy_subcategory(category, subcategory):
    state = CampaignState(category=category, subcategory=subcategory)
    decision = decide(state)
    assert decision.should_escalate is True
    assert decision.triggers_fired == ["3_reasoning_heavy"]


def test_t3_does_not_fire_for_unrelated_category():
    state = CampaignState(category="prompt_injection", subcategory="direct")
    assert decide(state).should_escalate is False


def test_t3_membership_set_is_documented():
    # If we add categories to the set, ARCHITECTURE.md §1.1.1 must list them.
    # This guards against silent drift.
    assert REASONING_HEAVY_CATEGORIES == frozenset(
        {
            "prompt_injection/multi_turn_crescendo",
            "prompt_injection/indirect_reasoning_required",
            "identity_role_exploitation/trust_boundary",
        }
    )


# ─── Trigger 4: conversation depth

def test_t4_fires_above_4_turns():
    assert decide(CampaignState(conversation_turn_depth=5)).should_escalate is True


def test_t4_does_not_fire_at_or_below_4_turns():
    assert decide(CampaignState(conversation_turn_depth=4)).should_escalate is False
    assert decide(CampaignState(conversation_turn_depth=1)).should_escalate is False


# ─── Trigger 5: high-sev + zero-coverage

def test_t5_fires_for_sev9_zero_coverage():
    state = CampaignState(severity=9, cases_run_in_subcat=0)
    decision = decide(state)
    assert decision.should_escalate is True
    assert decision.triggers_fired == ["5_high_sev_uncovered"]


def test_t5_does_not_fire_when_coverage_exists():
    state = CampaignState(severity=10, cases_run_in_subcat=1)
    assert decide(state).should_escalate is False


def test_t5_does_not_fire_below_sev_9():
    state = CampaignState(severity=8, cases_run_in_subcat=0)
    assert decide(state).should_escalate is False


# ─── Trigger 6: manual override

def test_t6_manual_override():
    assert decide(CampaignState(manual_override=True)).should_escalate is True


# ─── Trigger 7: A/B sample (off by default)

def test_t7_off_by_default_even_when_state_says_ab():
    assert decide(CampaignState(is_ab_sample=True)).should_escalate is False


def test_t7_fires_when_toggled_on():
    state = CampaignState(is_ab_sample=True)
    toggles = TriggerToggles(t7_ab_sample=True)
    decision = decide(state, toggles)
    assert decision.should_escalate is True
    assert decision.triggers_fired == ["7_ab_sample"]


# ─── Short-circuit ordering: trigger 1 wins over later triggers ───

def test_first_matching_trigger_wins():
    # All triggers would fire; we expect trigger 1 to be reported.
    state = CampaignState(
        refusal_count_last_10=10,         # T1
        tap_max_depth_so_far=10,           # T2
        tap_judge_passes_at_max_depth=0,
        category="prompt_injection",       # T3
        subcategory="multi_turn_crescendo",
        conversation_turn_depth=20,        # T4
        severity=10,                       # T5
        cases_run_in_subcat=0,
        manual_override=True,              # T6
        is_ab_sample=True,                 # T7 (toggled off)
    )
    decision = decide(state)
    assert decision.triggers_fired == ["1_refusal_rate"]
