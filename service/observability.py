"""Langfuse observability — lazy, env-driven, never required.

Per ARCHITECTURE.md §8 we trace every campaign, every attack, and every
Judge call as Langfuse spans tagged by agent_role / campaign_id /
attack_category. The instance is the same self-hosted Langfuse that
the W2 Co-Pilot uses (memory: `project_railway_deploy_2026-04-30`);
this app lives in a separate *project* inside it for clean isolation.

Configuration:
    LANGFUSE_HOST          (e.g. https://langfuse-web-production-368f.up.railway.app)
    LANGFUSE_PUBLIC_KEY    (project-scoped pk-…)
    LANGFUSE_SECRET_KEY    (project-scoped sk-…)

If any of the three is missing, every helper here is a silent no-op,
so the runner doesn't error in environments without observability
configured (per `feedback_no_local_langfuse`)."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any


_DISABLED = "lf_disabled"
_client: Any = None
_initialized = False


def _client_or_none() -> Any | None:
    global _client, _initialized
    if _initialized:
        return None if _client == _DISABLED else _client
    _initialized = True

    host = os.getenv("LANGFUSE_HOST")
    pk = os.getenv("LANGFUSE_PUBLIC_KEY")
    sk = os.getenv("LANGFUSE_SECRET_KEY")
    if not (host and pk and sk):
        _client = _DISABLED
        return None
    try:
        from langfuse import Langfuse  # type: ignore[import-not-found]
    except ImportError:
        _client = _DISABLED
        return None
    try:
        _client = Langfuse(host=host, public_key=pk, secret_key=sk)
        return _client
    except Exception as exc:
        print(f"[observability] Langfuse init failed: {exc}")
        _client = _DISABLED
        return None


@contextmanager
def trace_run(run_id: str, target_url: str, suite_ref: str):
    """Top-level Langfuse trace for one regression run."""
    client = _client_or_none()
    trace = None
    if client is not None:
        try:
            trace = client.trace(
                name="regression_run",
                id=run_id,
                input={"target_url": target_url, "suite_ref": suite_ref},
                tags=["adversary-agent", suite_ref],
                metadata={"target": target_url},
            )
        except Exception as exc:
            print(f"[observability] trace_run failed: {exc}")
            trace = None
    try:
        yield trace
    finally:
        if client is not None:
            try:
                client.flush()
            except Exception:
                pass


@contextmanager
def trace_attack(run_trace, *, attack_id: str, category: str, subcategory: str, source: str):
    """Per-attack span nested under a regression-run trace."""
    span = None
    if run_trace is not None:
        try:
            span = run_trace.span(
                name="attack",
                input={"attack_id": attack_id, "source": source},
                metadata={"category": category, "subcategory": subcategory},
            )
        except Exception:
            span = None
    try:
        yield span
    finally:
        if span is not None:
            try:
                span.end()
            except Exception:
                pass


def log_judge_verdict(span, *, model: str, verdict: str, rationale: str, usd_cost: float) -> None:
    """Attach a Judge verdict as a generation on the attack span."""
    if span is None:
        return
    try:
        span.generation(
            name=f"judge:{model}",
            model=model,
            output={"verdict": verdict, "rationale": rationale},
            metadata={"usd_cost": usd_cost},
        )
    except Exception:
        pass
