# CircleCI environment variables

Set these on the project at https://app.circleci.com/settings/project/github/cxk280/adversarial-ai-security-agentforge/environment-variables.

## Required for any job

| Variable | Where it's used | Source |
|---|---|---|
| `ANTHROPIC_API_KEY` | `judge-golden-set` job (real Haiku calls) | https://console.anthropic.com/settings/keys |
| `OPENAI_API_KEY`    | `judge-golden-set` job (real GPT-4.1-mini calls) | https://platform.openai.com/api-keys |
| `RUNPOD_API_KEY`    | `red-team-smoke` job (real abliterated-Llama calls) | https://www.runpod.io/console/user/settings |
| `RUNPOD_ENDPOINT`   | `red-team-smoke` — URL of the deployed RunPod worker | RunPod worker dashboard |
| `DEEPSEEK_API_KEY`  | `red-team-smoke` escalation path | https://platform.deepseek.com/api_keys |

## Required for promotion (qa / prod)

These mirror the W2 agentforge repo verbatim. Same GitHub App, same installation, same key — the App has permission to push to qa/prod on BOTH repos via its installation grants.

| Variable | Notes |
|---|---|
| `GITHUB_APP_ID`              | Same App used by the W2 pipeline (memory: `project_bot_only_push_isolation`) |
| `GITHUB_APP_PRIVATE_KEY`     | PEM-encoded private key for the same App |
| `GITHUB_APP_INSTALLATION_ID` | **Must be the literal env var name** — `scripts/mint-github-installation-token.py` reads it directly. Setting `INSTALLATION_ID` instead silently fails. |

## Required for end-to-end tests against deployed adversary-agent

| Variable | Notes |
|---|---|
| `ADVERSARY_API_TOKEN` | The bearer token CI uses to authenticate against the deployed adversary service. Must match what's set on the Railway `adversary-agent` service. Rotate quarterly. |

## Optional — observability

| Variable | Notes |
|---|---|
| `LANGFUSE_PUBLIC_KEY`   | Per-env public key. Leave unset to no-op. |
| `LANGFUSE_SECRET_KEY`   | " |
| `LANGFUSE_HOST`         | URL of self-hosted Langfuse |

## Branch-scoped vs unscoped

CircleCI lets you scope an env var to specific branches via *Context*. Recommended:

- **Context `prod-only`**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RUNPOD_API_KEY`, `DEEPSEEK_API_KEY` *if* you keep separate keys per environment. (We don't today — a single set of keys works for dev/qa/prod since usage is metered per call, and rotation is easier with one key set.)
- **Unscoped (any branch)**: `GITHUB_APP_*`, `ADVERSARY_API_TOKEN` (per-env tokens recommended once we go multi-env)

## Quick verification

After setting all the variables, push any commit to master and the `python-unit-test` + `api-integration-test` + `authz-test` + `smoke-campaign` + `ui-unit-test` + `arch-drift-lint` jobs should all run and pass without paid LLM calls. Real-LLM jobs (`red-team-smoke`, `judge-golden-set`) require the keys above and will fail with a clear "env var missing" message if they're not configured.
