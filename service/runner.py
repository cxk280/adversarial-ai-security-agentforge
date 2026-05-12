"""Background runner: takes an accepted regression-run row and dispatches
it through the full multi-agent stack.

Pipeline per attack:
    1. Seed (or mutated variant) → CoPilotExecutor → target
    2. Deterministic Judge — always-on, cheap
    3. DualJudge (LLM) — opt-in via ENABLE_LLM_JUDGE=1, requires both
       ANTHROPIC_API_KEY and OPENAI_API_KEY. Falls back to deterministic
       if either is missing or any judge errors.
    4. Optional mutation pass — opt-in via ENABLE_MUTATIONS=1, requires
       RUNPOD_API_KEY+RUNPOD_ENDPOINT (and optionally DEEPSEEK_API_KEY).
       For each seed, ask the Mutator for N variants and dispatch each
       through (1)+(2)+(3) too.

Env flags are read at run-construct time so an operator can toggle them
per-deploy without code changes."""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

from agents.documentation.sonnet_writer import (
    DocAgentError,
    DocumentationAgent,
    ExploitContext,
)
from service.api.findings import allocate_vuln_id_for
from agents.red_team.escalation import CampaignState
from agents.red_team.seed_dispatcher import Attack, SeedDispatcher
from harness import CoPilotExecutor, new_session_id, run_assertions
from harness.allowlist import TargetNotAllowedError
from service import db
from service.models import now_iso
from service.observability import (
    current_trace_url,
    log_judge_verdict,
    trace_attack,
    trace_run,
)


SEEDS_ROOT = "evals/seeds"
RUBRICS_ROOT = Path("agents/judge/rubrics/v1")


# Map suite_ref → category dirs to include. Convention from
# CI_INTEGRATION.md Part 4. Promotion-gate suites are deterministic-only.
SUITE_REGISTRY: dict[str, dict[str, Any]] = {
    "promotion-gate-v1": {
        # Covers all 17 subcategories from THREAT_MODEL.md. Order is
        # priority-ranked: highest-impact attack surfaces first so a
        # truncated run still gets the most useful coverage.
        "categories": [
            "data_exfil_authorization_bypass",
            "data_exfil_cross_patient",
            "prompt_injection_indirect",
            "prompt_injection_multi_turn",
            "state_corruption_history_manipulation",
            "data_exfil_phi_leakage",
            "identity_role_persona_hijack",
            "tool_misuse_parameter_tampering",
            "identity_role_privilege_escalation",
            "state_corruption_context_poisoning",
            "identity_role_trust_boundary_violation",
            "prompt_injection_direct",
            "denial_of_service_token_exhaustion",
            "denial_of_service_cost_amplification",
            "tool_misuse_unintended_invocation",
            "tool_misuse_recursive_tool_calls",
            "denial_of_service_infinite_loops",
        ],
        "limit": 60,
    },
    "promotion-gate-prod-v1": {
        # Prod gate is tighter — only the highest-priority subcategories
        # to keep wall-clock under 2 min and per-cycle spend predictable.
        "categories": [
            "data_exfil_authorization_bypass",
            "data_exfil_cross_patient",
            "data_exfil_phi_leakage",
        ],
        "limit": 15,
    },
    "full-regression-v1": {
        "categories": None,  # all 17
        "limit": None,
    },
    "nightly-v1": {
        "categories": None,
        "limit": None,
    },
}


@lru_cache(maxsize=8)
def _rubric_for(category: str) -> str:
    """Look up the rubric for an attack category. Falls back to default."""
    p = RUBRICS_ROOT / f"{category}.md"
    if p.exists():
        return p.read_text()
    return (RUBRICS_ROOT / "default.md").read_text()


def _maybe_build_judge():
    """Construct DualJudge if both required keys are present and
    ENABLE_LLM_JUDGE=1. Returns None to fall back to deterministic."""
    if os.getenv("ENABLE_LLM_JUDGE") != "1":
        return None
    if not (os.getenv("ANTHROPIC_API_KEY") and os.getenv("OPENAI_API_KEY")):
        return None
    try:
        from agents.judge import DualJudge
        from agents.judge.primary_haiku import HaikuJudge
        from agents.judge.secondary_openai import GPT41MiniJudge
        from agents.judge.arbitrator_sonnet import SonnetArbitrator
        return DualJudge(
            primary=HaikuJudge(),
            secondary=GPT41MiniJudge(),
            arbitrator=SonnetArbitrator(),
        )
    except Exception as exc:
        print(f"[runner] LLM Judge unavailable: {exc}")
        return None


def _maybe_build_mutator():
    """Construct Mutator if RunPod is configured and ENABLE_MUTATIONS=1."""
    if os.getenv("ENABLE_MUTATIONS") != "1":
        return None
    if not (os.getenv("RUNPOD_API_KEY") and os.getenv("RUNPOD_ENDPOINT")):
        return None
    try:
        from agents.red_team.llm_clients.abliterated_runpod import (
            AbliteratedRunPodClient,
        )
        from agents.red_team.mutator import Mutator
        primary = AbliteratedRunPodClient()
        escalation = None
        if os.getenv("DEEPSEEK_API_KEY"):
            try:
                from agents.red_team.llm_clients.deepseek import DeepSeekClient
                escalation = DeepSeekClient()
            except Exception:
                escalation = None
        return Mutator(primary=primary, escalation=escalation)
    except Exception as exc:
        print(f"[runner] Mutator unavailable: {exc}")
        return None


# ────────────────────────────────────────────────────────────────────


async def execute_run(
    run_id: str,
    target_url: str,
    suite_ref: str,
    categories_override: list[str] | None = None,
) -> None:
    """Run the suite asynchronously. Writes per-attempt rows + the final
    totals/gate back to SQLite.

    `categories_override`, when provided, replaces the suite's
    default category list — used by the dashboard's Ad Hoc Run page
    so the user-checked categories actually drive what runs.
    """
    db.update_run(run_id, {"state": "running"})

    suite = SUITE_REGISTRY.get(suite_ref)
    if suite is None:
        db.update_run(
            run_id,
            {
                "state": "failed",
                "ended_at": now_iso(),
                "gate_json": json.dumps(
                    {"verdict": "error", "reasons": [f"Unknown suite_ref {suite_ref!r}"]}
                ),
            },
        )
        return

    try:
        executor = CoPilotExecutor(target_url)
    except TargetNotAllowedError as exc:
        db.update_run(
            run_id,
            {
                "state": "failed",
                "ended_at": now_iso(),
                "gate_json": json.dumps(
                    {"verdict": "error", "reasons": [f"target not allowlisted: {exc}"]}
                ),
            },
        )
        return

    judge = _maybe_build_judge()
    mutator = _maybe_build_mutator()
    n_mutations = int(os.getenv("N_MUTATIONS", "2") or "2")

    dispatcher = SeedDispatcher(SEEDS_ROOT)
    # User-supplied category override takes precedence over the suite's
    # default category list, but the suite's seed cap still applies.
    effective_categories = (
        categories_override if categories_override else suite["categories"]
    )
    seeds = list(
        dispatcher.stream_batch(categories=effective_categories, n=suite["limit"])
    )

    totals = {"pass": 0, "fail": 0, "partial": 0, "inconclusive": 0}
    total_spend = 0.0
    high_sev_passes = 0
    t0 = time.monotonic()
    cancelled = False

    def _is_cancelled() -> bool:
        """Cooperative cancellation probe. The /regression-runs/{id}/cancel
        endpoint flips state → 'cancelled' in the DB; this check makes the
        runner notice and stop dispatching further attacks. Cheap enough
        to do once per attack."""
        row = db.get_run(run_id)
        return bool(row and row.get("state") == "cancelled")

    with trace_run(run_id, target_url, suite_ref) as run_tr:
        # Capture the Langfuse trace URL right after the trace starts
        # so the run-detail UI can deep-link to it even if the run
        # crashes mid-flight.
        trace_url = current_trace_url()
        if trace_url:
            db.update_run(run_id, {"langfuse_trace_url": trace_url})
        for atk in seeds:
            if _is_cancelled():
                cancelled = True
                break
            spend, verdict = await _run_one(atk, executor, judge, run_id, run_tr)
            if spend < 0:
                return  # hard-stopped mid-run
            total_spend += spend
            totals[verdict] = totals.get(verdict, 0) + 1
            if verdict == "pass" and _is_high_sev(atk):
                high_sev_passes += 1

            # Mutation pass — only on seeds, not on existing mutations
            if mutator is not None and atk.source == "seed":
                try:
                    variants = await mutator.mutate(
                        atk,
                        n=n_mutations,
                        state=CampaignState(
                            category=atk.category,
                            subcategory=atk.subcategory,
                        ),
                    )
                except Exception as exc:
                    print(f"[runner] mutate({atk.id}) failed: {exc}")
                    variants = []
                for v in variants:
                    if _is_cancelled():
                        cancelled = True
                        break
                    vspend, vverdict = await _run_one(v, executor, judge, run_id, run_tr)
                    if vspend < 0:
                        return
                    total_spend += vspend
                    total_spend += float(v.metadata.get("usd_cost", 0.0))
                    totals[vverdict] = totals.get(vverdict, 0) + 1
                    if vverdict == "pass" and _is_high_sev(v):
                        high_sev_passes += 1
                if cancelled:
                    break

    duration_s = int(time.monotonic() - t0) if seeds else 0
    total_attacks = sum(totals.values())
    gate_verdict = "fail" if high_sev_passes > 0 else "pass"
    gate_reasons: list[str] = []
    if high_sev_passes > 0:
        gate_reasons.append(
            f"{high_sev_passes} new high-severity exploit(s) detected"
        )
    if cancelled:
        gate_reasons.append(
            f"run cancelled before completion ({total_attacks}/{len(seeds)} attacks executed)"
        )

    # Re-read state right before the final write to honour any cancel
    # that landed during the last attack. Otherwise the natural-
    # completion path would clobber state='cancelled' with 'completed'.
    final_state = "cancelled" if cancelled or _is_cancelled() else "completed"

    db.update_run(
        run_id,
        {
            "state": final_state,
            "ended_at": now_iso(),
            "spend_usd": total_spend,
            "totals_json": json.dumps(totals),
            "gate_json": json.dumps({"verdict": gate_verdict, "reasons": gate_reasons}),
        },
    )

    # Documentation Agent — run after the campaign settles, over any
    # exploits we just confirmed that don't already have a writeup.
    # Failures degrade to no-op so the campaign result is unaffected.
    await _run_documentation_agent(
        run_id=run_id,
        target_url=target_url,
        capped=5,
    )


async def _run_documentation_agent(
    *, run_id: str, target_url: str, capped: int
) -> None:
    """End-of-campaign step: ask Sonnet to write a polished
    VULN-NNNN-shape markdown for every NEW exploit this campaign
    found. Cap-bounded per campaign (default 5) to keep the per-run
    cost predictable. Skips any attack_id that already has a writeup
    (idempotent across re-runs of the same seeds)."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        return  # Doc Agent disabled when key is missing — quiet no-op

    # Collect unique attack_ids confirmed as exploits in this campaign.
    attempts = db.list_attempts(run_id)
    confirmed: dict[str, dict[str, Any]] = {}
    for a in attempts:
        if a.get("verdict") != "pass":
            continue
        sid = a["seed_id"]
        if sid in confirmed:
            continue
        confirmed[sid] = a
    if not confirmed:
        return

    # Skip anything already documented.
    existing_outputs = db.list_doc_agent_outputs()
    new_attack_ids = [sid for sid in confirmed if sid not in existing_outputs]
    if not new_attack_ids:
        return

    try:
        agent = DocumentationAgent()
    except DocAgentError as exc:
        print(f"[doc-agent] init failed: {exc}")
        return

    # Mark every new attack_id as "in_progress" upfront so the UI can
    # render a "writing…" indicator immediately, before the first
    # Sonnet call returns. Capped so a campaign with many exploits
    # doesn't burn unbounded Sonnet spend.
    targets = new_attack_ids[:capped]
    # Eagerly allocate the VULN-NNNN id for each target so the Doc
    # Agent's rendered markdown can bake in the real id, not a
    # placeholder. The allocator is idempotent — already-assigned ids
    # are returned as-is.
    vuln_ids = {sid: allocate_vuln_id_for(sid) for sid in targets}
    for sid in targets:
        db.upsert_doc_agent_output({
            "attack_id":        sid,
            "title":            f"Documentation Agent writing… ({vuln_ids[sid]})",
            "severity":         "high",  # placeholder until Sonnet assesses
            "body_markdown":    "",
            "campaign_id":      run_id,
            "model":            DocumentationAgent.model_name,
            "generated_at":     now_iso(),
            "status":           "in_progress",
            "assigned_vuln_id": vuln_ids[sid],
        })

    for sid in targets:
        att = confirmed[sid]
        vuln_id = vuln_ids[sid]
        ctx = ExploitContext(
            attack_id=sid,
            vuln_id=vuln_id,
            category=att.get("category", ""),
            subcategory=att.get("subcategory", ""),
            target_url=target_url,
            campaign_id=run_id,
            discovered=att.get("started_at", now_iso()),
            attack_payload=_seed_payload_for(sid) or "(payload not recovered)",
            response_text=att.get("response_text", ""),
        )
        try:
            # The Anthropic SDK call is blocking — run in a thread so
            # we don't pin the event loop.
            body = await asyncio.to_thread(agent.write, ctx)
        except DocAgentError as exc:
            print(f"[doc-agent] write({sid}) failed: {exc}")
            db.upsert_doc_agent_output({
                "attack_id":        sid,
                "title":            f"Documentation Agent failed ({vuln_id})",
                "severity":         "high",
                "body_markdown": (
                    f"_The Documentation Agent (Claude Sonnet 4.6) failed to "
                    f"generate a writeup for this exploit. Error: {exc}\n\n"
                    f"The exploit itself is still confirmed; the failure is "
                    f"in the doc-generation step. Re-trigger by re-running "
                    f"the campaign that found seed `{sid}`._\n"
                ),
                "campaign_id":      run_id,
                "model":            DocumentationAgent.model_name,
                "generated_at":     now_iso(),
                "status":           "failed",
                "assigned_vuln_id": vuln_id,
            })
            continue
        # Extract a one-line title from the first H1.
        title = _extract_title(body) or f"Exploit on {sid}"
        severity = _extract_severity(body) or "high"
        db.upsert_doc_agent_output({
            "attack_id":        sid,
            "title":            title,
            "severity":         severity,
            "body_markdown":    body,
            "campaign_id":      run_id,
            "model":            agent.model_name,
            "generated_at":     now_iso(),
            "status":           "completed",
            "assigned_vuln_id": vuln_id,
        })
        print(f"[doc-agent] wrote {vuln_id} (severity={severity})")


@lru_cache(maxsize=512)
def _seed_payload_for(seed_id: str) -> str | None:
    """Best-effort lookup of the raw attack payload that corresponds
    to a seed_id. Cheap because seeds are static on disk; cached at
    process scope."""
    try:
        dispatcher = SeedDispatcher(SEEDS_ROOT)
        for atk in dispatcher.load_all():
            if atk.id == seed_id:
                return atk.payload
    except Exception:
        return None
    return None


def _extract_title(markdown: str) -> str | None:
    """Pull the `# AUTO-xxx — Title` line's title part."""
    for line in markdown.splitlines():
        if line.startswith("# "):
            # `# AUTO-xxx — Title here`  →  `Title here`
            if "—" in line:
                return line.split("—", 1)[1].strip()
            return line[2:].strip()
    return None


def _extract_severity(markdown: str) -> str | None:
    """Pull the severity tier (critical/high/medium/low) from the
    metadata table's Severity row."""
    import re
    m = re.search(r"\*\*Severity\*\*[^|]*\|\s*\*\*(Critical|High|Medium|Low)\*\*", markdown)
    return m.group(1).lower() if m else None


async def _run_one(atk: Attack, executor, judge, run_id: str, run_tr=None):
    """Dispatch one attack and write its attempt row. Returns
    (spend_usd, verdict). Returns (-1, '') if the run must hard-stop
    (e.g., allowlist violation mid-run)."""
    session_id = new_session_id()
    with trace_attack(
        run_tr,
        attack_id=atk.id,
        category=atk.category,
        subcategory=atk.subcategory,
        source=atk.source,
    ) as att_span:
        try:
            result = await asyncio.to_thread(
                executor.chat,
                attack_id=atk.id,
                campaign_id=run_id,
                session_id=session_id,
                patient_id=atk.active_patient_id,
                message=atk.payload,
                active_user=atk.active_user,
                endpoint=atk.endpoint,
            )
        except TargetNotAllowedError:
            db.update_run(
                run_id,
                {
                    "state": "failed",
                    "ended_at": now_iso(),
                    "gate_json": json.dumps(
                        {
                            "verdict": "error",
                            "reasons": ["target became non-allowlisted mid-run"],
                        }
                    ),
                },
            )
            return -1.0, ""

        # Deterministic Judge — always
        det_verdict, _ = run_assertions(result.response_text, atk.assertions)
        verdict = det_verdict
        spend = 0.0
        rationale = ""

        # LLM Judge — if configured
        if judge is not None:
            try:
                final = await judge.score(
                    attack=atk.payload,
                    target_response=result.response_text or "",
                    rubric=_rubric_for(atk.category),
                    category=atk.category,
                    subcategory=atk.subcategory,
                )
                verdict = final.verdict
                spend = final.total_usd
                rationale = final.rationale
                log_judge_verdict(att_span, model=final.primary.model,
                                  verdict=final.primary.verdict,
                                  rationale=final.primary.rationale,
                                  usd_cost=final.primary.usd_cost)
                log_judge_verdict(att_span, model=final.secondary.model,
                                  verdict=final.secondary.verdict,
                                  rationale=final.secondary.rationale,
                                  usd_cost=final.secondary.usd_cost)
                if final.arbitrator is not None:
                    log_judge_verdict(att_span, model=final.arbitrator.model,
                                      verdict=final.arbitrator.verdict,
                                      rationale=final.arbitrator.rationale,
                                      usd_cost=final.arbitrator.usd_cost)
            except Exception as exc:
                print(f"[runner] LLM Judge failed for {atk.id}: {exc}; using deterministic verdict")
                verdict = det_verdict

        db.insert_attempt(
            {
                "attempt_id": uuid.uuid4().hex,
                "run_id": run_id,
                "seed_id": atk.id,
                "category": atk.category,
                "subcategory": atk.subcategory,
                "verdict": verdict,
                "response_text": (result.response_text or "")[:8000],
                "latency_ms": result.latency_ms,
                "spend_usd": spend,
                "started_at": now_iso(),
            }
        )
        return spend, verdict


def _is_high_sev(attack) -> bool:
    high_sev_subcats = {
        "cross_patient_leakage",
        "phi_leakage",
        "authorization_bypass",
        "indirect",
        "persona_hijack_clinical_authority",
    }
    return attack.subcategory in high_sev_subcats
