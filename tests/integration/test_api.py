"""Integration tests for the adversary-agent FastAPI service.

Uses a TestClient — no network, no real LLMs. The runner is stubbed so
we don't hit RunPod or DeepSeek. The HTTP-call layer in the runner is
also stubbed out to avoid hitting the real Co-Pilot target during tests."""

from __future__ import annotations

import os
import tempfile
import pytest

# Disable auth + use a temp DB for the duration of the test module.
@pytest.fixture(autouse=True)
def _isolated_db(monkeypatch, tmp_path):
    db_path = tmp_path / "test.sqlite"
    monkeypatch.setenv("ADVERSARY_DB_PATH", str(db_path))
    monkeypatch.setenv("ADVERSARY_DISABLE_AUTH", "1")
    # Reset the cached _DB_PATH module-level constant.
    import importlib
    from service import db as db_mod
    importlib.reload(db_mod)
    from service.api import runs as runs_mod, audit as audit_mod
    importlib.reload(runs_mod)
    importlib.reload(audit_mod)
    from service import main as main_mod
    importlib.reload(main_mod)
    db_mod.init_db()
    yield


@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient
    from service.main import app

    # Stub the runner so submitted runs don't dispatch real HTTP.
    from service.api import runs as runs_mod

    async def _fake_executor(run_id, target_url, suite_ref):
        from service import db
        db.update_run(
            run_id,
            {"state": "completed", "ended_at": "2026-05-11T18:00:00+00:00"},
        )

    monkeypatch.setattr(runs_mod, "execute_run", _fake_executor)
    return TestClient(app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_version_shape(client):
    r = client.get("/version")
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "adversary-agent"
    assert "version" in body
    assert "git_commit_sha" in body


def test_submit_run_returns_202_with_run_id_and_links(client):
    r = client.post(
        "/regression-runs",
        json={
            "target_url": "https://copilot-agent-dev.up.railway.app",
            "suite_ref": "promotion-gate-v1",
            "source": "manual",
        },
    )
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["run_id"].startswith("run_")
    assert body["state"] == "queued"
    assert body["links"]["self"].startswith("/regression-runs/run_")


def test_submit_run_rejects_non_allowlisted_target(client):
    r = client.post(
        "/regression-runs",
        json={
            "target_url": "https://evil.example.com",
            "suite_ref": "promotion-gate-v1",
        },
    )
    assert r.status_code == 422
    assert "allowlist" in r.text.lower() or "authorization" in r.text.lower()


def test_get_run_status_returns_404_for_unknown_id(client):
    r = client.get("/regression-runs/run_does_not_exist")
    assert r.status_code == 404


def test_full_submit_then_poll_lifecycle(client):
    sub = client.post(
        "/regression-runs",
        json={
            "target_url": "https://copilot-agent-dev.up.railway.app",
            "suite_ref": "promotion-gate-v1",
        },
    )
    assert sub.status_code == 202
    run_id = sub.json()["run_id"]

    poll = client.get(f"/regression-runs/{run_id}")
    assert poll.status_code == 200
    body = poll.json()
    assert body["run_id"] == run_id
    assert body["target_url"] == "https://copilot-agent-dev.up.railway.app"


def test_audit_bypass_records_to_audit_log(client):
    r = client.post(
        "/audit/bypass",
        json={
            "commit_sha": "deadbeef1234",
            "actor": "alice",
            "ci_url": "https://app.circleci.com/pipelines/xxx",
            "justification": "Hotfix for outage — adversarial finding is a known false positive (VULN-9999), being fixed separately.",
        },
    )
    assert r.status_code == 201
    assert "audit_id" in r.json()


def test_audit_bypass_rejects_short_justification(client):
    r = client.post(
        "/audit/bypass",
        json={"commit_sha": "abc", "justification": "no"},
    )
    assert r.status_code == 422


def test_cancel_run_idempotency(client):
    sub = client.post(
        "/regression-runs",
        json={
            "target_url": "https://copilot-agent-dev.up.railway.app",
            "suite_ref": "promotion-gate-v1",
        },
    )
    run_id = sub.json()["run_id"]

    c1 = client.post(f"/regression-runs/{run_id}/cancel")
    # The fake executor already marked it completed; cancel of a completed run should 409.
    assert c1.status_code == 409


def test_list_runs_with_target_filter(client):
    client.post(
        "/regression-runs",
        json={
            "target_url": "https://copilot-agent-dev.up.railway.app",
            "suite_ref": "promotion-gate-v1",
        },
    )
    client.post(
        "/regression-runs",
        json={
            "target_url": "https://copilot-agent-qa.up.railway.app",
            "suite_ref": "promotion-gate-v1",
        },
    )

    all_runs = client.get("/regression-runs").json()
    assert all_runs["count"] >= 2

    dev_only = client.get(
        "/regression-runs?target=https://copilot-agent-dev.up.railway.app"
    ).json()
    assert dev_only["count"] >= 1
    assert all(
        r["target_url"] == "https://copilot-agent-dev.up.railway.app"
        for r in dev_only["runs"]
    )
