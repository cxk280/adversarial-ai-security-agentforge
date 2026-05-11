# Deploy

How to deploy the adversary-agent FastAPI service to Railway. This is the service the CircleCI pre-`hold-qa` job in `../agentforge` calls via the contract in `CI_INTEGRATION.md`.

## Architecture target

| Service | Image | Purpose |
|---|---|---|
| `adversary-agent` | this repo's `Dockerfile` | FastAPI service; `/regression-runs` + `/audit/bypass` + canary integrity checks |
| `adversary-db` | Postgres (Railway template) | Pending — currently SQLite in-container. Move when we promote to qa/prod. |
| `adversary-ui` | `./ui/` Next.js build | Pending — see task #16 (remaining UI pages) |

## Prerequisites

```bash
# Railway CLI installed and authenticated:
brew install railway
railway login

# Linked to the existing AgentForge Railway project (id 9311cca7-06ba-4c87-93c4-a9c62cee58c6
# per the project_railway_deploy_2026-04-30 memory):
railway link
```

## Environment variables (set per-service in Railway dashboard or via CLI)

| Variable | Required | Notes |
|---|:---:|---|
| `ADVERSARY_API_TOKEN`   | yes | Bearer token CI uses on `Authorization` header. Rotate quarterly. |
| `ANTHROPIC_API_KEY`     | yes | Primary Judge (Haiku) + Arbitrator (Sonnet) + Documentation Agent |
| `OPENAI_API_KEY`        | yes | Secondary Judge (GPT-4.1-mini) |
| `DEEPSEEK_API_KEY`      | yes | Red Team escalation model |
| `RUNPOD_API_KEY`        | yes | Auth for the abliterated Llama endpoint |
| `RUNPOD_ENDPOINT`       | yes | URL of the deployed RunPod vLLM worker |
| `LANGFUSE_PUBLIC_KEY`   | no  | Observability (defaults to no-op per `feedback_no_local_langfuse`) |
| `LANGFUSE_SECRET_KEY`   | no  | " |
| `LANGFUSE_HOST`         | no  | " |
| `ADVERSARY_DB_PATH`     | no  | Defaults to `/app/adversary.sqlite` inside the container |

Set them on Railway with:

```bash
railway variables \
  --service adversary-agent \
  --set ADVERSARY_API_TOKEN=<token> \
  --set ANTHROPIC_API_KEY=<key> \
  --set OPENAI_API_KEY=<key> \
  --set DEEPSEEK_API_KEY=<key> \
  --set RUNPOD_API_KEY=<key> \
  --set RUNPOD_ENDPOINT=<url>
```

## First deploy — dev environment

```bash
# From the repo root.
railway up --service adversary-agent --detach

# Watch the build:
railway logs --service adversary-agent

# Once the deploy is live, smoke-test:
ADVERSARY_BASE_URL="https://adversary-agent-dev.up.railway.app"
curl -fsS "$ADVERSARY_BASE_URL/health"          # → {"status":"ok"}
curl -fsS "$ADVERSARY_BASE_URL/version" | jq    # → service, version, git_commit_sha
```

Then submit a run end-to-end against the deployed Co-Pilot dev target:

```bash
curl -fsS -X POST "$ADVERSARY_BASE_URL/regression-runs" \
  -H "Authorization: Bearer $ADVERSARY_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "target_url": "https://copilot-agent-dev.up.railway.app",
    "suite_ref":  "promotion-gate-v1",
    "source":     "manual"
  }' | jq

# Poll the resulting run until it completes:
RUN_ID="run_xxx"  # from the response above
watch -n 5 "curl -fsS \"$ADVERSARY_BASE_URL/regression-runs/$RUN_ID\" \
            -H \"Authorization: Bearer $ADVERSARY_API_TOKEN\" | jq '.state, .totals, .gate'"
```

## Promotion to qa / prod

Wired identically to the W2 pattern (`project_env_branches_to_tags`):

```bash
# QA promotion = push HEAD onto the qa branch (Railway watches qa
# and auto-deploys).
git push origin master:qa

# Prod promotion is gated by CircleCI's hold-prod step (see
# .circleci/config.yml).
```

After promotion, the CI's `e2e-qa` / `e2e-prod` jobs (`.circleci/config.yml`) run the wait-for-adversary-sha command, poll `/version` until `git_commit_sha == $CIRCLE_SHA1`, then exercise the API.

## Authorization scope

Reminder from `ARCHITECTURE.md §13`: the deployed adversary-agent is allowed to test ONLY the targets in the allowlist (`harness/allowlist.py`):

- `copilot-agent-production-41de.up.railway.app`
- `copilot-agent-qa.up.railway.app`
- `copilot-agent-dev.up.railway.app`
- `localhost` (for local dev)

Any `target_url` outside this list is rejected with 422 before the run starts. The allowlist is enforced server-side; the deploy environment cannot loosen it via env var.

## Rollback

```bash
# Find the previous promotion tag:
git tag -l 'qa-*' --sort=-creatordate | head -3

# Move qa back to the previous tag's SHA:
git push -f origin <previous-sha>:qa
```

Railway redeploys automatically once the branch tip moves. The platform's own audit log captures the rollback.
