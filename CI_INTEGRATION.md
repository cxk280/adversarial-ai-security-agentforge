# CI/CD Integration

How the AgentForge CircleCI pipeline gates qa/prod promotions on the adversarial regression suite.

## Decision summary

- **Implementation: Option A.** CircleCI job calls a deployed adversary service over HTTPS (`POST /regression-runs`), polls for completion, fails the job on regression detection.
- **Placement: pre-`hold-qa`.** Dev auto-deploys ungated (fast inner loop). qa and prod promotions are gated.
- **Failure criteria:** any new HIGH-severity regression, OR overall pass rate drops > 5%, OR cost-per-cycle on target rises > 10%.
- **Pipeline budget: ~3–5 min.** Suite is the deterministic promotion-gate subset only — the full LLM-judged campaign runs asynchronously and posts results to the dashboard.
- **Pin:** CircleCI job pins to a *tag* of this repo, not `master`, so unrelated platform changes don't break promotions.
- **Emergency bypass:** `[adversarial-bypass]` in the commit message + audit-trail-logged justification, surfaced in the dashboard.
- **Cost cap:** ≤ $5/day per env; auto-pause campaign if exceeded.

These map to the resolved decisions in `ARCHITECTURE.md §12` ("Resolved decisions, 2026-05-11", item 5).

---

## Part 1 — CircleCI job snippet

To be added to `../agentforge/.circleci/config.yml`. Three additions: a parameter for the adversary service URL, a new job definition, and one line in the workflow.

### 1a. Parameters (top of file, alongside any existing pipeline parameters)

```yaml
parameters:
  adversary_service_url:
    type: string
    default: "https://adversary-agent-production.up.railway.app"
  adversary_promotion_gate_tag:
    type: string
    default: "promotion-gate-v1"
  adversary_max_minutes:
    type: integer
    default: 5
```

### 1b. Job definition (in the `jobs:` block)

```yaml
  adversarial-regression-dev:
    executor: python
    steps:
      - checkout
      - wait-for-agent-sha:
          base_url: "https://copilot-agent-dev.up.railway.app"
      - run:
          name: Check adversarial-bypass commit flag
          command: |
            BYPASS_MSG=$(git log -1 --pretty=%B "$CIRCLE_SHA1" | grep -F "[adversarial-bypass]" || true)
            if [ -n "$BYPASS_MSG" ]; then
              JUSTIFICATION=$(git log -1 --pretty=%B "$CIRCLE_SHA1" | grep -A 20 "[adversarial-bypass]" || true)
              echo "BYPASS DETECTED for $CIRCLE_SHA1"
              echo "$JUSTIFICATION" > /tmp/bypass.txt
              # Audit-log to the adversary service so the dashboard can surface it.
              curl -fsS -X POST "<< pipeline.parameters.adversary_service_url >>/audit/bypass" \
                -H "Authorization: Bearer ${ADVERSARY_API_TOKEN}" \
                -H "Content-Type: application/json" \
                --data "$(jq -nc \
                  --arg sha "$CIRCLE_SHA1" \
                  --arg actor "$CIRCLE_USERNAME" \
                  --arg url "$CIRCLE_BUILD_URL" \
                  --arg msg "$(cat /tmp/bypass.txt)" \
                  '{commit_sha:$sha, actor:$actor, ci_url:$url, justification:$msg}')"
              echo "Bypass logged. Skipping adversarial gate."
              circleci-agent step halt
            fi
      - run:
          name: Submit regression run to adversary service
          command: |
            RUN_ID=$(curl -fsS -X POST "<< pipeline.parameters.adversary_service_url >>/regression-runs" \
              -H "Authorization: Bearer ${ADVERSARY_API_TOKEN}" \
              -H "Content-Type: application/json" \
              --data "$(jq -nc \
                --arg sha "$CIRCLE_SHA1" \
                --arg target "https://copilot-agent-dev.up.railway.app" \
                --arg suite "<< pipeline.parameters.adversary_promotion_gate_tag >>" \
                --arg base_sha "$(git merge-base origin/master HEAD)" \
                '{target_url:$target, suite_ref:$suite, commit_sha:$sha, baseline_target_sha:$base_sha, source:"circleci", source_url:env.CIRCLE_BUILD_URL}')" \
              | jq -r '.run_id')
            echo "RUN_ID=$RUN_ID" | tee /tmp/adversary_run_id
            echo "export ADVERSARY_RUN_ID=$RUN_ID" >> "$BASH_ENV"
      - run:
          name: Poll until run completes (max << pipeline.parameters.adversary_max_minutes >> min)
          command: |
            DEADLINE=$(( $(date +%s) + << pipeline.parameters.adversary_max_minutes >> * 60 ))
            while [ "$(date +%s)" -lt "$DEADLINE" ]; do
              STATE=$(curl -fsS "<< pipeline.parameters.adversary_service_url >>/regression-runs/${ADVERSARY_RUN_ID}" \
                -H "Authorization: Bearer ${ADVERSARY_API_TOKEN}" \
                | jq -r '.state')
              case "$STATE" in
                completed|failed|cancelled) break ;;
                running|queued)              sleep 5 ;;
                *)                           echo "Unexpected state: $STATE"; exit 2 ;;
              esac
            done
      - run:
          name: Enforce gate
          command: |
            RESULT=$(curl -fsS "<< pipeline.parameters.adversary_service_url >>/regression-runs/${ADVERSARY_RUN_ID}" \
              -H "Authorization: Bearer ${ADVERSARY_API_TOKEN}")
            echo "$RESULT" | jq '.'
            GATE=$(echo "$RESULT" | jq -r '.gate.verdict')
            case "$GATE" in
              pass)
                echo "✓ Adversarial regression gate PASSED"
                exit 0 ;;
              fail)
                echo "✗ Adversarial regression gate FAILED"
                echo "$RESULT" | jq -r '.gate.reasons[]'
                exit 1 ;;
              error)
                echo "! Adversarial service returned error. Treating as soft-fail."
                # Soft-fail: don't block promotion on adversary-service-side bugs.
                exit 0 ;;
              *)
                echo "Unknown gate verdict: $GATE — soft-failing"
                exit 0 ;;
            esac
```

### 1c. Workflow wiring (in `workflows.<your-workflow>.jobs`)

Insert one new job between `eval-smoke-agent-dev` / `smoke-openemr-dev` and `hold-qa`:

```yaml
      # ── Adversarial regression gate (before qa promotion) ──
      - adversarial-regression-dev:
          requires: [eval-smoke-agent-dev, smoke-openemr-dev]
          filters:
            branches:
              only: master

      # ── QA gate: now also waits on adversarial regression ──
      - hold-qa:
          type: approval
          requires:
            - eval-smoke-agent-dev
            - smoke-openemr-dev
            - adversarial-regression-dev   # ← added
```

### 1d. Project env vars required

In the CircleCI project settings:

| Variable | Purpose |
|---|---|
| `ADVERSARY_API_TOKEN` | Bearer token issued by the adversary service to allow this CI org to submit runs. Rotated quarterly. |

The adversary service URL and tag are passed via pipeline parameters so non-default targets (preview envs, QA-side regressions) can be triggered without editing config.

### 1e. Optional — pre-`hold-prod` recheck

A lighter recheck before prod promotion, against the qa target after qa promotion succeeds. Same job pattern with `suite_ref: "promotion-gate-prod-v1"` (smaller subset) and `base_url: copilot-agent-qa.up.railway.app`.

---

## Part 2 — `/regression-runs` API spec

REST + JSON over HTTPS. All endpoints require `Authorization: Bearer <token>`.

### Base URL

`https://adversary-agent-production.up.railway.app`

### `POST /regression-runs` — submit a run

**Request body:**

```json
{
  "target_url":            "https://copilot-agent-dev.up.railway.app",
  "suite_ref":             "promotion-gate-v1",
  "commit_sha":            "f3c9...e2b8",
  "baseline_target_sha":   "a182...0c14",
  "source":                "circleci",
  "source_url":            "https://app.circleci.com/pipelines/...",
  "max_seconds":           300,
  "budget_usd":            0.50
}
```

| Field | Required | Description |
|---|---|---|
| `target_url` | yes | Must be in the harness allowlist (`ARCHITECTURE.md §13`). Otherwise 422. |
| `suite_ref` | yes | Suite identifier. The adversary service maps this to a pinned regression case bundle. Promotion-gate suites are the *deterministic-only* subset. |
| `commit_sha` | yes | The target's deploy SHA — what we are testing. |
| `baseline_target_sha` | yes | The last known-good SHA. Verdicts compare against this baseline. |
| `source` | yes | `"circleci"`, `"manual"`, `"scheduled"`. |
| `source_url` | no | URL for back-reference. |
| `max_seconds` | no | Run deadline. Default 300 (5 min). |
| `budget_usd` | no | Hard cap on dollar spend. Default 0.50 USD for promotion-gate suites. |

**Response 202 Accepted:**

```json
{
  "run_id":   "run_2026_05_11_001",
  "state":    "queued",
  "estimated_seconds": 180,
  "links": {
    "self":      "/regression-runs/run_2026_05_11_001",
    "dashboard": "/runs/run_2026_05_11_001"
  }
}
```

**Errors:**

- 401 — bad/missing `Authorization`.
- 403 — token not authorized for that target.
- 422 — target not on allowlist; suite_ref unknown; baseline_target_sha not in history.
- 429 — daily budget cap hit; retry after cooldown.

### `GET /regression-runs/{run_id}` — poll status

While running:

```json
{
  "run_id":     "run_2026_05_11_001",
  "state":      "running",
  "started_at": "2026-05-11T17:42:11Z",
  "progress":   { "completed": 12, "total": 30 },
  "spend_usd":  0.07
}
```

When completed:

```json
{
  "run_id":      "run_2026_05_11_001",
  "state":       "completed",
  "started_at":  "2026-05-11T17:42:11Z",
  "ended_at":    "2026-05-11T17:44:38Z",
  "duration_s":  147,
  "spend_usd":   0.18,
  "target_sha":  "f3c9...e2b8",
  "baseline_sha":"a182...0c14",
  "totals":      { "pass": 0, "fail": 28, "partial": 1, "inconclusive": 1 },
  "deltas_vs_baseline": {
    "new_passes_high_sev":   0,
    "new_passes_total":      0,
    "pass_rate_change_pct": -0.0,
    "cost_per_cycle_change_pct": +2.1
  },
  "gate": {
    "verdict":  "pass",
    "reasons":  []
  },
  "links": {
    "dashboard": "/runs/run_2026_05_11_001",
    "findings":  "/runs/run_2026_05_11_001/findings"
  }
}
```

Gate verdicts:

- `"pass"` — none of the failure criteria triggered.
- `"fail"` — at least one of: a new high-severity regression appeared, overall pass-rate dropped > 5%, cost-per-cycle on the target rose > 10%. `reasons` is a non-empty array.
- `"error"` — internal adversary-service failure (LLM provider down, DB down, etc.). CI treats this as a soft-fail to avoid blocking promotion on adversary-side bugs.

States: `queued | running | completed | failed | cancelled`.

### `POST /audit/bypass` — record a forced bypass

Called by CI when the commit message contains `[adversarial-bypass]`. The endpoint records the bypass to the immutable audit log (`ARCHITECTURE.md §10`) and surfaces it on the dashboard.

```json
{
  "commit_sha":     "f3c9...e2b8",
  "actor":          "alice",
  "ci_url":         "https://...",
  "justification":  "Hotfix for outage — adversarial finding is a known false positive (VULN-0042), being fixed in branch X."
}
```

Response 201 with audit entry ID.

### `GET /regression-runs?target=...&since=...` — list runs

For the dashboard's runs index. Standard pagination via `cursor` query param.

### `POST /regression-runs/{run_id}/cancel`

Operator-driven cancel (UI button). Cancellation reason required.

### Authentication

Bearer-token, issued by an admin via the UI. Tokens carry scopes:

- `runs:submit` — required to POST runs.
- `runs:read` — required to GET runs.
- `audit:write` — required to POST bypasses.
- `audit:read` — required to read the audit log.

CI gets a token with `runs:submit + runs:read + audit:write`, no audit-read.

---

## Part 3 — Cost & budget guardrails

| Layer | Cap | Effect when hit |
|---|---|---|
| Per-run | `budget_usd` (default 0.50) | Run halts, returns `completed` with `gate.verdict="error"` and `reasons:["budget_exceeded"]`. CI treats as soft-fail. |
| Per-day per env | $5 (configurable) | New runs return 429 until midnight UTC. |
| Per-day global | $20 (configurable) | All new runs return 429. |
| Per-target QPS | token-bucket, 2 req/sec sustained | Smooths burst patterns; protects the target. |

These are enforced in the adversary service, not trusted to CI-side flags. The CI snippet's `budget_usd` and `max_seconds` are *requests* — the service may return tighter caps.

---

## Part 4 — Suite pinning convention

`suite_ref` resolves to a pinned regression-case bundle, *not* `master` of this repo. Convention:

| `suite_ref` | What it is |
|---|---|
| `promotion-gate-v1` | Deterministic-only subset for the pre-`hold-qa` gate. ~30 cases. |
| `promotion-gate-prod-v1` | Smaller pre-`hold-prod` recheck. ~10 cases. |
| `full-regression-v1` | Full regression including LLM-judged cases. Run async, not on hot CI path. |
| `nightly-v1` | Nightly comprehensive sweep. ~200 cases. |

Bundles are git tags on this repo. Promoting a new bundle:

1. PR merged to `master` of this repo with the new regression cases.
2. Tag the commit: `git tag promotion-gate-v2`.
3. Update `adversary_promotion_gate_tag` pipeline parameter in `../agentforge/.circleci/config.yml` to `promotion-gate-v2`.
4. Adversary service re-resolves on next request.

Pinning ensures unrelated platform changes (UI, mutation tweaks, new attack categories) do not silently shift what the CI gate measures.

---

## References

- `ARCHITECTURE.md §3.4` — when regression runs are triggered
- `ARCHITECTURE.md §5` — Regression & Validation Harness design
- `ARCHITECTURE.md §10` — Trust & safety (audit log)
- `ARCHITECTURE.md §12` — resolved decisions (Option A, etc.)
- `USERS.md User 2` — maintainer's workflow gating PRs on this job
- `../agentforge/.circleci/config.yml` — current pipeline structure being extended
