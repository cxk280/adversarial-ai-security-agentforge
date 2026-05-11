"""Canary integrity checks.

A canary is a frozen (attack, response, expected_verdict) tuple whose
correct verdict is well-known. On every campaign run, the harness scores
each canary and asserts the score matches expectation. Any miss flags
the run as JUDGE_INTEGRITY_FAIL — no findings from that run are promoted.

For the MVP, "Judge" means the deterministic Judge in
harness/assertions.py. When the LLM Judge lands, each canary will be
scored by Primary AND Secondary, and we'll require BOTH to match.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from harness.assertions import Verdict, run_assertions

CANARY_FILE = Path("evals/canaries/judge_replays.yaml")
ZW_RE = re.compile(r"\\u200[bcd]")


@dataclass
class CanaryCase:
    id: str
    label: str
    expected_verdict: Verdict
    attack_payload: str
    target_response: str
    assertions: list[dict]


@dataclass
class CanaryResult:
    case_id: str
    expected: Verdict
    observed: Verdict
    passed: bool
    detail: str


def load_canaries(path: Path = CANARY_FILE) -> list[CanaryCase]:
    """Load replay canaries from disk. Returns [] if the file is missing
    so tests that don't set up the canary file don't crash."""
    if not path.exists():
        return []
    with path.open() as f:
        raw = yaml.safe_load(f) or {}
    defaults = raw.get("defaults", {})
    cases: list[CanaryCase] = []
    for c in raw.get("cases", []) or []:
        merged = {**defaults, **c}
        cases.append(
            CanaryCase(
                id=merged["id"],
                label=merged.get("label", merged["id"]),
                expected_verdict=merged["expected_verdict"],
                attack_payload=merged["attack_payload"],
                target_response=_unescape_unicode(merged["target_response"]),
                assertions=merged.get("assertions", []),
            )
        )
    return cases


def check_canary(case: CanaryCase) -> CanaryResult:
    """Score a single canary against the current deterministic Judge."""
    observed_verdict, results = run_assertions(case.target_response, case.assertions)
    passed = observed_verdict == case.expected_verdict
    detail = (
        f"{case.id}: expected={case.expected_verdict}, got={observed_verdict}"
        + (
            ""
            if passed
            else " — first assertion detail: "
            + (results[0].detail if results else "(none)")
        )
    )
    return CanaryResult(
        case_id=case.id,
        expected=case.expected_verdict,
        observed=observed_verdict,
        passed=passed,
        detail=detail,
    )


def run_all_canaries(path: Path = CANARY_FILE) -> tuple[bool, list[CanaryResult]]:
    """Returns (all_passed, results). all_passed=False means the Judge cannot
    be trusted for this run; the orchestrator must flag JUDGE_INTEGRITY_FAIL
    and refuse to promote any findings."""
    cases = load_canaries(path)
    results = [check_canary(c) for c in cases]
    return all(r.passed for r in results), results


def _unescape_unicode(text: str) -> str:
    """The YAML file uses literal \\u200b sequences for zero-width chars
    so the file is grep-friendly. Convert them to actual characters at
    load time."""
    def _sub(match: re.Match) -> str:
        return bytes(match.group(0), "ascii").decode("unicode_escape")

    return ZW_RE.sub(_sub, text)
