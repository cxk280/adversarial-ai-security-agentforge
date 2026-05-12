"""End-to-end against a deployed adversary-agent. Configured via
ADVERSARY_BASE_URL env var. Skipped cleanly if missing.

Per .circleci/config.yml `e2e-against-deployed` job — runs against
each env (dev/qa/prod) after that env's promotion."""

from __future__ import annotations

import os
import time

import pytest
import requests


def _base() -> str | None:
    return os.getenv("ADVERSARY_BASE_URL")


def _token() -> str | None:
    return os.getenv("ADVERSARY_API_TOKEN")


@pytest.mark.skipif(not _base(), reason="ADVERSARY_BASE_URL not set")
def test_health_responds():
    r = requests.get(f"{_base()}/health", timeout=10)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


@pytest.mark.skipif(not _base(), reason="ADVERSARY_BASE_URL not set")
def test_version_returns_service_envelope():
    r = requests.get(f"{_base()}/version", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body.get("service") == "adversary-agent"
    assert "version" in body
    # git_commit_sha is "unknown" on direct railway up; with CircleCI-driven
    # promotions it should match $CIRCLE_SHA1.
    assert "git_commit_sha" in body


@pytest.mark.skipif(
    not (_base() and _token()),
    reason="ADVERSARY_BASE_URL / ADVERSARY_API_TOKEN not both set",
)
def test_submit_smoke_run_and_poll_to_completion():
    """Submit a 5-attack promotion-gate-prod-v1 run against the env this
    test is targeting (which equals what the env's adversary-agent has
    on its harness allowlist), then poll to completion. Fails if the
    run errors or exceeds 5 minutes."""
    base = _base()
    headers = {
        "Authorization": f"Bearer {_token()}",
        "Content-Type": "application/json",
    }

    # Determine target_url from the base URL — same env (dev runs against
    # dev's Co-Pilot, qa runs against qa's, etc.)
    if "dev" in base:
        target = "https://copilot-agent-dev.up.railway.app"
    elif "qa" in base:
        target = "https://copilot-agent-qa.up.railway.app"
    else:
        target = "https://copilot-agent-production-41de.up.railway.app"

    r = requests.post(
        f"{base}/regression-runs",
        headers=headers,
        json={
            "target_url": target,
            "suite_ref": "promotion-gate-prod-v1",
            "source": "circleci",
        },
        timeout=15,
    )
    assert r.status_code == 202, f"submit failed: {r.status_code} {r.text[:200]}"
    run_id = r.json()["run_id"]

    deadline = time.time() + 300  # 5 min
    while time.time() < deadline:
        s = requests.get(
            f"{base}/regression-runs/{run_id}", headers=headers, timeout=10
        ).json()
        state = s["state"]
        if state in ("completed", "failed"):
            assert state == "completed", (
                f"Run failed: state={state} gate={s.get('gate')}"
            )
            # Smoke: we expect SOME totals (even all-fail is fine)
            t = s["totals"]
            n = t["pass"] + t["fail"] + t["partial"] + t["inconclusive"]
            assert n >= 1, f"Run completed with zero attempts: {t}"
            return
        time.sleep(8)

    pytest.fail(f"Run {run_id} did not complete in 5 minutes")
