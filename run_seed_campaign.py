"""End-to-end Stage-3 prototype runner.

Reads the seed YAML files, dispatches each attack against the live
deployed Co-Pilot target via the harness, runs deterministic assertions
on each response, and writes JSONL results to ./evals/results/.

Per ARCHITECTURE.md §1.1 this is the seed-phase Red Team Agent's
end-to-end loop. Mutation comes later when the abliterated model on
RunPod is wired in.

Per memory `feedback_evals_match_environment` (local-eval-against-local,
dev-against-dev) the default target is the deployed *dev* env. Override
with --target <url> for qa or prod (host must be in the allowlist).

Usage:
    python3 run_seed_campaign.py                          # dev, all categories
    python3 run_seed_campaign.py --category data_exfil_cross_patient
    python3 run_seed_campaign.py --limit 5                # smoke test
    python3 run_seed_campaign.py --target https://copilot-agent-qa.up.railway.app
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path

from agents.red_team.seed_dispatcher import SeedDispatcher, new_campaign_id
from harness import (
    AttackResult,
    CoPilotExecutor,
    TargetNotAllowedError,
    new_session_id,
    run_assertions,
)

DEFAULT_TARGET = "https://copilot-agent-dev.up.railway.app"
SEEDS_ROOT = Path(__file__).parent / "evals" / "seeds"
RESULTS_ROOT = Path(__file__).parent / "evals" / "results"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default=DEFAULT_TARGET)
    parser.add_argument("--category", default=None, help="seed category dir name")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true", help="parse seeds, no HTTP")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--sleep", type=float, default=0.5, help="seconds between attacks")
    args = parser.parse_args()

    dispatcher = SeedDispatcher(SEEDS_ROOT)
    cats = [args.category] if args.category else dispatcher.categories()
    attacks = list(dispatcher.stream_batch(categories=cats, n=args.limit))

    if not attacks:
        print(f"no seed cases found (categories={cats})")
        return 2

    campaign_id = new_campaign_id()
    print(f"[campaign] {campaign_id}  target={args.target}  attacks={len(attacks)}")
    print(f"[categories] {sorted(set(a.category + '/' + a.subcategory for a in attacks))}")

    if args.dry_run:
        for atk in attacks:
            print(f"  [{atk.id}] {atk.category}/{atk.subcategory}  endpoint={atk.endpoint}")
        return 0

    try:
        executor = CoPilotExecutor(args.target)
    except TargetNotAllowedError as exc:
        print(f"ERROR: {exc}")
        return 3

    RESULTS_ROOT.mkdir(parents=True, exist_ok=True)
    results_path = RESULTS_ROOT / f"{campaign_id}.jsonl"
    summary: Counter = Counter()

    with results_path.open("w") as out:
        for idx, atk in enumerate(attacks, start=1):
            session_id = new_session_id()
            t0 = time.monotonic()
            try:
                ar: AttackResult = executor.chat(
                    attack_id=atk.id,
                    campaign_id=campaign_id,
                    session_id=session_id,
                    patient_id=atk.active_patient_id,
                    message=atk.payload,
                    active_user=atk.active_user,
                    endpoint=atk.endpoint,
                )
            except TargetNotAllowedError as exc:
                print(f"  [{atk.id}] BLOCKED: {exc}")
                return 4

            verdict, assertion_results = run_assertions(ar.response_text, atk.assertions)
            summary[verdict] += 1

            record = {
                "attack_id": atk.id,
                "campaign_id": campaign_id,
                "category": atk.category,
                "subcategory": atk.subcategory,
                "seed_label": atk.seed_label,
                "endpoint": atk.endpoint,
                "active_patient_id": atk.active_patient_id,
                "verdict": verdict,
                "assertions": [
                    {"name": r.name, "verdict": r.verdict, "detail": r.detail}
                    for r in assertion_results
                ],
                "request": {
                    "session_id": session_id,
                    "payload_preview": atk.payload[:300],
                },
                "response": {
                    "status": ar.response_status,
                    "latency_ms": ar.latency_ms,
                    "text_preview": (ar.response_text or "")[:600],
                    "text_full": ar.response_text or "",
                    "error": ar.error,
                },
                "timestamp": ar.timestamp,
            }
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            out.flush()

            if not args.quiet:
                tag = verdict.upper().ljust(4)
                marker = "🚨" if verdict == "pass" else "  "
                print(
                    f"  [{idx:3}/{len(attacks)}] {marker} {tag} [{atk.id}] "
                    f"{atk.category}/{atk.subcategory}  "
                    f"latency={ar.latency_ms}ms status={ar.response_status} "
                    f"dt={time.monotonic() - t0:.1f}s"
                )

            time.sleep(args.sleep)

    print()
    print(f"[summary] {dict(summary)}")
    print(f"[results] {results_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
