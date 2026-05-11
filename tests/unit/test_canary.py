"""Unit tests for the canary loader + integrity check."""

from __future__ import annotations

import pytest
from pathlib import Path

from harness.canary import (
    CanaryCase,
    check_canary,
    load_canaries,
    run_all_canaries,
)


REAL_CANARY_FILE = Path("evals/canaries/judge_replays.yaml")


def test_canary_file_loads_and_has_both_flavors():
    cases = load_canaries(REAL_CANARY_FILE)
    assert len(cases) >= 8
    pass_canaries = [c for c in cases if c.expected_verdict == "pass"]
    fail_canaries = [c for c in cases if c.expected_verdict == "fail"]
    assert len(pass_canaries) >= 4, "Need a meaningful set of PASS canaries"
    assert len(fail_canaries) >= 4, "Need a meaningful set of FAIL canaries"


def test_every_canary_scores_as_expected():
    """The committed canary file MUST itself pass — if it doesn't, either
    the assertions are wrong or the canary's expected_verdict is wrong.

    Both bugs invalidate the integrity check, so this test guards them."""
    ok, results = run_all_canaries(REAL_CANARY_FILE)
    failures = [r for r in results if not r.passed]
    assert ok, "Canary mismatches:\n" + "\n".join(r.detail for r in failures)


def test_zero_width_char_unescape():
    """The PASS canary for zero-width-char obfuscation embeds literal
    \\u200b sequences in YAML for grep-ability. The loader must turn
    them into real zero-width characters or the canary fails for the
    wrong reason."""
    cases = load_canaries(REAL_CANARY_FILE)
    zwcj = next(c for c in cases if c.id == "canary-pass-002")
    assert "​" in zwcj.attack_payload, "Loader did not unescape zero-width spaces"


def test_check_canary_flags_a_mismatch():
    """Synthetic case: expected pass but assertion says fail → result must
    record passed=False with helpful detail."""
    bad = CanaryCase(
        id="synthetic-bad",
        label="synthetic",
        expected_verdict="pass",
        attack_payload="x",
        target_response="totally benign response, no PHI",
        assertions=[{"name": "no_phi_leaked"}],
    )
    result = check_canary(bad)
    assert result.passed is False
    assert result.expected == "pass"
    assert result.observed == "fail"
    assert "expected=pass" in result.detail and "got=fail" in result.detail


def test_load_canaries_returns_empty_for_missing_file(tmp_path):
    missing = tmp_path / "does-not-exist.yaml"
    assert load_canaries(missing) == []
