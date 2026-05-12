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
configured (per `feedback_no_local_langfuse`).

Targets Langfuse SDK v4 (OpenTelemetry-based). The v2/v3 `client.trace()`
shape was removed; v4 uses `start_as_current_observation(name, as_type=...)`
for context-managed spans and `update_current_trace()` for trace-level
metadata. We thread a child OTEL context manually because we yield the
span across async/sync boundaries in the runner."""

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
        from langfuse import get_client  # type: ignore[import-not-found]
    except ImportError:
        _client = _DISABLED
        return None
    try:
        _client = get_client()
        return _client
    except Exception as exc:
        print(f"[observability] Langfuse init failed: {exc}")
        _client = _DISABLED
        return None


@contextmanager
def trace_run(run_id: str, target_url: str, suite_ref: str):
    """Top-level Langfuse span for one regression run."""
    client = _client_or_none()
    if client is None:
        yield None
        return
    try:
        with client.start_as_current_observation(
            name=f"regression_run:{run_id}",
            as_type="span",
            input={"target_url": target_url, "suite_ref": suite_ref},
            metadata={"target": target_url, "run_id": run_id},
        ) as span:
            try:
                client.update_current_trace(
                    name=f"regression_run:{run_id}",
                    tags=["adversary-agent", suite_ref],
                    metadata={"target": target_url, "run_id": run_id},
                )
            except Exception:
                pass
            try:
                yield span
            finally:
                try:
                    client.flush()
                except Exception:
                    pass
    except Exception as exc:
        print(f"[observability] trace_run failed: {exc}")
        yield None


@contextmanager
def trace_attack(run_trace, *, attack_id: str, category: str, subcategory: str, source: str):
    """Per-attack span nested under a regression-run trace.

    In v4, observation nesting is driven by OTEL context. As long as we
    open this span inside the `with trace_run(...)` block in the runner,
    Langfuse threads it under the parent automatically."""
    if run_trace is None:
        yield None
        return
    client = _client_or_none()
    if client is None:
        yield None
        return
    try:
        with client.start_as_current_observation(
            name=f"attack:{category}/{subcategory}",
            as_type="span",
            input={"attack_id": attack_id, "source": source},
            metadata={"category": category, "subcategory": subcategory},
        ) as span:
            yield span
    except Exception as exc:
        print(f"[observability] trace_attack failed: {exc}")
        yield None


def log_judge_verdict(span, *, model: str, verdict: str, rationale: str, usd_cost: float) -> None:
    """Attach a Judge verdict as a generation observation under the
    currently active OTEL context (the attack span)."""
    if span is None:
        return
    client = _client_or_none()
    if client is None:
        return
    try:
        with client.start_as_current_observation(
            name=f"judge:{model}",
            as_type="generation",
            model=model,
            output={"verdict": verdict, "rationale": rationale},
            metadata={"usd_cost": usd_cost},
        ):
            pass
    except Exception:
        pass
