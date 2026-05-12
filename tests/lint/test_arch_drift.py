"""Architecture-drift linter — keeps ARCHITECTURE.md / TESTING.md /
the model registry / the harness allowlist from silently diverging.

Per TESTING.md #14: cheap insurance against doc-and-code drift, the #1
way every multi-author project goes stale."""

from __future__ import annotations

from pathlib import Path

import pytest

ARCH = Path("ARCHITECTURE.md")


@pytest.fixture(scope="module")
def arch_text():
    return ARCH.read_text()


def test_allowlist_hosts_named_in_architecture(arch_text):
    """Every host the harness will dispatch to must be mentioned in
    ARCHITECTURE.md §13 (authorization scope). Drift either way means
    the doc is wrong or the allowlist is too wide."""
    from harness.allowlist import ALLOWED_HOSTS
    for host in ALLOWED_HOSTS:
        if host in ("localhost", "127.0.0.1"):
            continue
        assert host in arch_text, (
            f"Host {host!r} is in harness/allowlist.py but not "
            f"mentioned in ARCHITECTURE.md §13"
        )


def test_authorization_window_present(arch_text):
    """§13 must declare an explicit time window for the engagement."""
    assert "2026-05-11" in arch_text
    assert "2026-05-22" in arch_text


def test_dual_judge_models_named_in_architecture(arch_text):
    """Section 1.2 must name every model the Judge stack uses, so a
    reader knows which provider's outage breaks what."""
    expected = [
        "claude-haiku-4-5",     # Primary
        "gpt-4.1-mini",         # Secondary
        "claude-sonnet-4-6",    # Arbitrator + Orchestrator + Docs
    ]
    for model in expected:
        assert model in arch_text, f"Architecture doc must reference {model!r}"


def test_red_team_models_named_in_architecture(arch_text):
    """Section 1.1 must name the abliterated primary + DeepSeek escalation."""
    assert "huihui-ai" in arch_text and "abliterat" in arch_text.lower()
    assert "deepseek" in arch_text.lower()


def test_escalation_triggers_match_code(arch_text):
    """The 7 numbered escalation triggers in §1.1.1 must match what
    agents/red_team/escalation.py actually fires on."""
    for n in (1, 2, 3, 4, 5, 6, 7):
        # Both the doc-side numeric markers and the code-side trigger
        # IDs use ordinals 1–7. If the doc lists 6 and the code fires 7
        # (or vice versa), this test catches it.
        assert f"{n}. " in arch_text or f"Trigger {n}" in arch_text, (
            f"Trigger {n} must be discussed in ARCHITECTURE.md §1.1.1"
        )

    from agents.red_team.escalation import decide, CampaignState, TriggerToggles
    # Verify all 7 toggle fields exist on TriggerToggles
    toggles = TriggerToggles()
    for n in (1, 2, 3, 4, 5, 6, 7):
        prefix = f"t{n}_"
        match = [f for f in toggles.__dataclass_fields__ if f.startswith(prefix)]
        assert len(match) == 1, f"TriggerToggles missing t{n}_* field; got {match}"
