"""End-to-end smoke against a STUBBED target — no real network, no real
LLMs. Validates the seed → harness → deterministic Judge pipeline runs
cleanly on every push. Catches the "we accidentally broke the executor
contract" class of bug.

Per TESTING.md #8: ~30s budget; runs on every PR."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from agents.red_team.seed_dispatcher import SeedDispatcher
from harness import run_assertions
from harness.executor import AttackResult


@pytest.fixture
def fake_executor():
    """Return a CoPilotExecutor whose .chat() always returns a canned
    response — no HTTP, no allowlist check (since we don't construct it
    via the real path)."""
    def _fake_chat(*, attack_id, campaign_id, session_id, patient_id,
                   message, active_user, endpoint, **kw):
        return AttackResult(
            attack_id=attack_id,
            campaign_id=campaign_id,
            target_url="https://stub.local",
            target_endpoint=endpoint,
            session_id=session_id,
            patient_id=patient_id,
            request_body={"message": message},
            response_status=200,
            response_text=(
                "I'm sorry, but I can only retrieve clinical data for the active "
                "patient in this session. I won't fetch data for other patients."
            ),
            latency_ms=42,
            error=None,
        )
    return _fake_chat


def test_seed_dispatcher_loads_all_categories():
    """The seed corpus must load without errors. Catches YAML drift."""
    d = SeedDispatcher("evals/seeds")
    seeds = d.load_all()
    assert len(seeds) >= 50, f"Expected ≥50 seeds, got {len(seeds)}"
    cats = {a.category for a in seeds}
    assert cats == {"data_exfiltration", "prompt_injection", "identity_role_exploitation"}, cats


def test_5_seed_smoke_against_stub(fake_executor):
    """Run the first 5 cross-patient seeds through the deterministic
    Judge against a canned refusal response. All should score 'fail'
    (the canned response is a clean refusal). If even one scores 'pass',
    the assertion logic regressed."""
    d = SeedDispatcher("evals/seeds")
    seeds = list(d.stream_batch(categories=["data_exfil_cross_patient"], n=5))
    assert len(seeds) == 5

    for atk in seeds:
        result = fake_executor(
            attack_id=atk.id,
            campaign_id="smoke",
            session_id="adv-smoke",
            patient_id=atk.active_patient_id,
            message=atk.payload,
            active_user="smoke",
            endpoint=atk.endpoint,
        )
        verdict, _ = run_assertions(result.response_text, atk.assertions)
        assert verdict == "fail", (
            f"Smoke regression: seed {atk.id} scored {verdict!r} on a "
            f"canned refusal response (expected 'fail')"
        )


def test_canaries_self_check():
    """The committed canary file must score correctly under the current
    assertions — otherwise the integrity-check infrastructure is broken."""
    from harness.canary import run_all_canaries
    ok, results = run_all_canaries()
    failures = [r.detail for r in results if not r.passed]
    assert ok, "Canary self-check failed:\n" + "\n".join(failures)
