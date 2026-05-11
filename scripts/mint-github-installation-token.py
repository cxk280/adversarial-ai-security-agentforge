#!/usr/bin/env python3
"""Mint a short-lived GitHub App installation token for CI promotion pushes.

Why this script exists: the bot-only push isolation step (see
project_bot_only_push_isolation memory) replaces the user-scoped
GITHUB_DEPLOY_TOKEN with a GitHub App's installation token. The App is
the ONLY identity allowed to push to the qa/prod branches once branch
protection is updated, which closes the remaining workstation-push
hole left by the 2026-05-08 lockdown.

Flow:
    1. Sign a JWT (RS256) with the App's private key. Claims: iss=APP_ID,
       iat=now-60s (clock skew), exp=now+540s (well under GitHub's 600s
       max).
    2. POST that JWT to /app/installations/<INSTALLATION_ID>/access_tokens.
       GitHub returns a token valid for ~1 hour, scoped to the
       permissions the App was granted on the installation.
    3. Print the token to stdout. CI captures it and uses it as
       `https://x-access-token:<token>@github.com/...` in the git push.

Env vars (CircleCI project settings):
    GITHUB_APP_ID                — numeric App ID (from App settings page)
    GITHUB_APP_PRIVATE_KEY       — full PEM contents (BEGIN/END lines + body)
    GITHUB_APP_INSTALLATION_ID   — installation ID for cxk280/agentforge
                                   (visible at https://github.com/settings/installations)

Single hard dep: PyJWT[crypto]. Installed in CI's run step.
"""

from __future__ import annotations

import os
import sys
import time
import urllib.request
import urllib.error
import json


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        print(f"✗ env var {name} is required but not set", file=sys.stderr)
        sys.exit(1)
    return value


def main() -> int:
    app_id = _require_env("GITHUB_APP_ID")
    installation_id = _require_env("GITHUB_APP_INSTALLATION_ID")
    private_key = _require_env("GITHUB_APP_PRIVATE_KEY")

    try:
        import jwt  # PyJWT
    except ImportError:
        print("✗ PyJWT not installed; `pip install 'PyJWT[crypto]'`", file=sys.stderr)
        return 1

    now = int(time.time())
    # iat=-60s for clock skew; exp=+9min (GitHub allows up to 10 min).
    payload = {"iat": now - 60, "exp": now + 540, "iss": app_id}
    jwt_token = jwt.encode(payload, private_key, algorithm="RS256")

    req = urllib.request.Request(
        f"https://api.github.com/app/installations/{installation_id}/access_tokens",
        method="POST",
        headers={
            "Authorization": f"Bearer {jwt_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        # Surface GitHub's error body to the CI log so misconfigurations
        # (wrong installation_id, expired App key, missing permissions)
        # surface as readable diagnostics rather than a bare 401.
        print(
            f"✗ GitHub returned {exc.code}: {exc.read().decode(errors='replace')}",
            file=sys.stderr,
        )
        return 1

    token = body.get("token")
    if not token:
        print(f"✗ response had no token field: {body}", file=sys.stderr)
        return 1

    print(token)
    return 0


if __name__ == "__main__":
    sys.exit(main())
