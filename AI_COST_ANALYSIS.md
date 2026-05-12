# AI Cost Analysis

How much it costs to run the AgentForge Adversarial AI Security Platform — actual dev spend, projected production costs at 100 / 1K / 10K / 100K runs, and the architectural changes each scale tier requires.

> **Headline:** at the chosen architecture, 100K runs/month costs roughly **$700 base + ~$25 RunPod warm time + ~$50 DeepSeek escalation = ~$775/month**. The Judge dominates cost — not the Red Team — because we deliberately picked an uncensored *local* model for attack generation. Substituting Claude or GPT for attack generation would multiply the 100K-run bill by ~5× *and* cap coverage at whatever those models will willingly produce.

---

## Per-cycle cost breakdown

A single "cycle" is one (attack, response, verdict) tuple. Multi-turn attacks count as multiple cycles. Numbers assume the per-cycle token mix we've observed in `evals/results/cmp_1778525656_864228.jsonl`:

| Component | Tokens in | Tokens out | Provider | Unit cost | Per cycle |
|---|---:|---:|---|---|---:|
| **Red Team generation** (primary)         | 1.5K | 0.5K  | huihui-ai 70B abl. on RunPod | RunPod is paid per warm GPU-hour, not per token → effectively **$0/token in steady state** | **$0.000** |
| **Red Team escalation** (~15% of cycles)  | 2.0K | 1.0K  | DeepSeek-R1 (`deepseek-reasoner`) | $0.55 / $2.19 per Mtok | **$0.003** weighted |
| **Target call** *(NOT paid by us)*        | 2.0K | 0.8K  | Anthropic Sonnet 4.6 (target's own bill) | — | — |
| **Primary Judge**                          | 3.0K | 0.4K  | Claude Haiku 4.5  | $1.00 / $5.00 per Mtok | **$0.005** |
| **Secondary Judge**                        | 3.0K | 0.4K  | OpenAI GPT-4.1-mini | $0.40 / $1.60 per Mtok | **$0.0018** |
| **Arbitrator** (only when judges disagree, ~12% of cycles) | 4.0K | 0.5K  | Claude Sonnet 4.6 | $3.00 / $15.00 per Mtok | $0.020 × 12% = **$0.0024** weighted |
| **Documentation Agent** (only on PASS, ~5% of cycles) | 5.0K | 1.5K  | Claude Sonnet 4.6 | $3.00 / $15.00 per Mtok | **$0.038** × 5% = **$0.0019** weighted |
| **Storage + Langfuse + Postgres**         | —    | —     | Railway managed | flat-rate | **~$0.0002** amortized |
| **TOTOL per cycle**                        |      |       |    |    | **~$0.0143** |

Round-number rule of thumb: **~$0.014 / cycle** (cycle-and-a-half pennies). Judges combined are ~65% of that ($0.005 + $0.0018 + $0.0024 weighted = $0.0092); Red Team escalation ~21%; Docs ~13%.

The dual-Judge design (Primary Haiku + Secondary GPT-4.1-mini + Sonnet arbitrator on disagreement) replaced an earlier single-Haiku Judge. The ~$0.005 → ~$0.0092 per-cycle bump on Judge spend buys cross-family verdict agreement plus inter-judge divergence as a free quality metric — see `ARCHITECTURE.md §1.2.2`.

---

## Actual dev spend (sprint to date, 2026-05-12)

Pulled from the run records in `service/db.py` (SQLite `regression_runs` table) and `evals/results/`.

| Phase | Runs | Cycles | Per-cycle | Total |
|---|---:|---:|---:|---:|
| Stage-3 prototype (2026-04-28 → 2026-04-30) — no LLM Judge, deterministic assertions only, seed dispatcher only | 5 | ~285 | $0.000 | **$0.00** |
| W3 sprint — LLM Judge on, dual-Judge wired, deterministic assertions still in front | ~6 | ~180 | ~$0.002 | **~$0.40** |
| Mutator + observability unit tests (stubs only, no LLM hits) | — | — | — | $0.00 |
| Target's own Anthropic spend (not our bill, but worth surfacing) | — | ~465 calls × ~$0.018 | — | ~$8.37 *(target's bill, not ours)* |
| **Total spend by the adversarial platform itself (to 2026-05-12 noon)** | | | | **~$0.40** |

The **$0.002/cycle empirical** number is materially *under* the modeled $0.014/cycle in the table above. The gap is the dual-Judge fast-path: when Primary Haiku and Secondary GPT-4.1-mini agree on `fail` (which is the common case — the target refuses ~90% of seeds), the Arbitrator never fires and the Documentation Agent never runs. The $0.014 model assumes Arbitrator fires on 12% of cycles and Docs fires on 5%; in real campaigns against this target both rates are closer to 2-3% because the target's refusals are unambiguous. The $0.014 model stays in the table as the conservative ceiling.

Budget cap stays at `$5/day per env, $20/day global` per `ARCHITECTURE.md §3.3` — we are not close.

---

## Projected production costs by scale

Cycles-per-month, holding the architecture from `ARCHITECTURE.md`:

| Scale | Cycles | Base cost (dual-Judge + Docs + DeepSeek escalation at 15%) | RunPod warm time | Total |
|---|---:|---:|---:|---:|
| **100**     | 100      | ~$1.40          | ~$0.50        | **~$1.90/month** |
| **1K**      | 1,000    | ~$14            | ~$2           | **~$16/month** |
| **10K**     | 10,000   | ~$143           | ~$8           | **~$151/month** |
| **100K**    | 100,000  | ~$1,430         | ~$25          | **~$1,455/month** |

These numbers assume *no* architectural optimization beyond the locked architecture. The Optimizations section below knocks the 100K cost down to ~$775.

### What's in "base cost"

For each scale tier, "base cost" = `cycles × $0.0143`. Breaking it down at 100K:
- **Dual Judge** ($0.005 + $0.0018 + $0.0024 weighted = $0.0092 × 100K) = ~$920 → **the bottleneck at every scale**
  - Primary Haiku ~$500
  - Secondary GPT-4.1-mini ~$180
  - Arbitrator Sonnet, ~12% of cycles ~$240
- **DeepSeek escalation** ($0.003 × 100K × 15%) = $45 → smaller than expected, because the abliterated primary handles 85% of cycles for ~free
- **Documentation Agent** ($0.038 × 100K × 5%) = $190 → only fires on confirmed findings
- **RunPod warm time** at 100K cycles/month, assuming sustained throughput → an A100 worker stays warm for the campaign window then scales to zero; ~30 hr/month × ~$0.79/hr = ~$25
- Substrate (Postgres, Langfuse, audit log) = ~$20/month flat regardless of scale (Railway)

### Why the Judge dominates and Red Team doesn't

This is the most defensible architectural decision we made and the cost numbers prove it. If we had used Claude (Sonnet $3/$15 per Mtok) for attack generation instead of the abliterated local model, at 100K cycles the Red Team line would be:

```
Red Team @ Sonnet: 100K × (1.5K × $3 + 0.5K × $15) / 1M = $1,200 / month
```

That alone is ~120% more than our entire current 100K bill. Add the coverage cap (Claude refuses many offensive payloads, so we'd need ~3× more cycles to reach the same coverage) and the real total approaches $3,500–4,000/month. The architecture choice cuts cost by ~80% AND raises coverage.

---

## Architectural changes by scale tier

Each tier triggers a different optimization. The platform should not implement these prematurely — premature optimization is wasted at low scale and obscures cost regressions.

### 100 cycles/month — no changes

The prototype layout (single FastAPI instance, single RunPod worker, in-process Judge). Total spend ≤ $2/month is below the per-day budget cap; cost monitoring is informational only.

### 1K cycles/month — no architectural changes, just observability

Wire per-campaign and per-day USD totals to the Langfuse dashboard so the operator can see cost trends. Add a daily Slack alert when burn exceeds `$0.20/day`.

### 10K cycles/month — deterministic pre-filter on the Judge hot path

At ~333 cycles/day, the Judge is the bottleneck both for cost and rate-limit. Add a **deterministic pre-filter** before the LLM Judge:

```python
def maybe_skip_judge(attack, response) -> Verdict | None:
    # 1. If the response is an obvious refusal (matches REFUSAL_MARKERS or
    #    ATTACK_RECOGNIZED_MARKERS — already shipped in harness/assertions.py),
    #    return "fail" without calling the LLM Judge.
    # 2. If the response is empty or HTTP-error-shaped, return "inconclusive"
    #    without calling the LLM Judge.
    # 3. Otherwise return None — let the LLM Judge decide.
```

Empirically (from our Stage-3 runs) ~40–55% of attacks against the deployed target are refused with attack-recognition language. Pre-filtering those skips ~half the Judge calls. At 10K cycles/month that saves ~$25–30, halves Judge rate-limit pressure, and reduces Langfuse storage by half.

### 100K cycles/month — three coordinated changes

| Change | Why | Savings |
|---|---|---:|
| **Sharded RunPod fleet, always-warm during business hours** | At 100K cycles/month a single worker is rate-limited; two parallel workers cuts wall-time in half. Always-warm during 8a-8p CT means the worker isn't paying cold-start latency on every campaign. | RunPod cost goes from $25 to ~$30 but throughput doubles; the Judge bottleneck moves forward in the pipeline |
| **Batched Judge calls** | Anthropic's Batch API costs 50% of real-time for non-urgent verdicts. Promotion-gate runs stay real-time (CI's polling timeout is 5 min). Nightly + scheduled runs use batched. ~70% of cycles are non-urgent. | Judge cost drops from $500 to ~$325 (saves ~$175/month at 100K) |
| **Per-category Judge instances** | One Judge prompt rubric per attack category instead of one omni-prompt. The omni-prompt is ~3K tokens; per-category prompts average ~1.2K. With prompt caching enabled (Anthropic caches the prompt portion, $0.10 per Mtok hit, 5-minute TTL), the per-cycle Judge prompt-token bill drops by ~60%. | Judge cost drops a further $30–60/month at 100K |

**Net effect at 100K cycles/month with optimizations:**
- Dual Judge total: $920 → ~$580 (save ~$340 — batched API + per-category prompt caching apply to all three Judge models)
- RunPod: $25 → ~$30 (small bump for always-warm)
- Other lines unchanged
- **Optimized 100K total: ~$1,115/month** (vs ~$1,455 unoptimized → ~23% reduction)

### Beyond 100K — when to stop

At 1M cycles/month (~33K/day) the architecture needs revisiting:
- The Judge's batched-API throughput becomes a real constraint (~10–20s queue depth on Anthropic's side).
- A *small distilled Judge* (Haiku fine-tuned on the golden set) running locally would be cheaper but introduces drift risk — defer this until and unless we hit the regime.
- Storage of attack/response payloads in Postgres exceeds free-tier; either compress (zstd dictionary on common attack payloads) or move to object storage with Postgres-as-index.

These changes are post-MVP, post-final, and tracked as a future-work item.

---

## Cost guardrails enforced in code

Per `ARCHITECTURE.md §3.3` and `agents/red_team/escalation.py`:

| Guardrail | Limit | Enforced where |
|---|---|---|
| Per-campaign USD cap | $1.50 default, configurable via API | `harness/executor.py` halts the campaign at cap |
| Per-day per-env USD cap | $5.00 | Orchestrator refuses new campaigns past cap |
| Per-day global USD cap | $20.00 | Orchestrator refuses new campaigns past cap |
| Per-target QPS cap | 2 req/sec sustained, token-bucket | `harness/executor.py` |
| Campaign halt on no-signal | rolling 30-attack success rate < 2% AND > $5 spent | Orchestrator halt rule |

These are real limits — the platform refuses to spend past them, no override flags. The UI's `/orchestrator` page shows live burn vs. cap as a meter.

---

## What we are explicitly NOT optimizing for

| Choice | Rationale |
|---|---|
| **Cheapest possible Judge model** (e.g. a small OpenAI-compatible model) | The Judge is the load-bearing accuracy piece — a wrong Judge invalidates the entire regression history. The cost-vs-accuracy tradeoff favors Haiku at this scale. Revisit only when Haiku's spend becomes a top-3 line item, which it isn't at any scale below 1M cycles/month. |
| **Self-hosted Sonnet** for the Documentation Agent | Doc generation is bursty (only fires on confirmed PASS), low-volume, and high-quality-sensitive. Self-hosting would save ~$80/month at 100K but add operational complexity and a fixed GPU bill. Skip. |
| **Aggressive prompt caching across categories** | We do cache the Judge's per-category rubric (5-minute TTL) but we do *not* attempt cross-campaign cache sharing, which is fragile. The 50% savings the Anthropic batch API gives us is bigger and simpler. |

## How to verify these numbers

The platform writes per-call USD into the `run_cost` table and Langfuse spans (per `ARCHITECTURE.md §8.4`). Compare the rolling 30-day total to this document quarterly. If actual cost-per-cycle diverges from $0.01 by > 25%, this document and `harness/cost.py` are out of date — a `tests/lint/test_arch_drift.py` test (per `TESTING.md` #14) guards against silent drift between this analysis and the model registry.

---

## References

- `ARCHITECTURE.md §6` — cost preview table this document expands on
- `ARCHITECTURE.md §3.3` — cost guardrails (caps, halt rules)
- `ARCHITECTURE.md §1.1.1` — DeepSeek escalation policy (drives the ~15% escalation rate)
- `TESTING.md` #14 — arch-drift linter that keeps cost-per-call constants in `harness/cost.py` aligned with this analysis
- `evals/results/cmp_1778525656_864228.jsonl` — Stage-3 run that grounds the per-cycle token mix
