"""Bearer-token auth for the adversary-agent API.

Per CI_INTEGRATION.md, every endpoint except `/health` and `/version`
requires `Authorization: Bearer <token>`. Tokens carry scopes:

  - runs:submit   — can POST /regression-runs
  - runs:read     — can GET /regression-runs/...
  - audit:write   — can POST /audit/bypass
  - audit:read    — can read /audit/...

For MVP we use a single shared bearer token via env (ADVERSARY_API_TOKEN)
with a wildcard scope. Per-token scope tables land in a follow-up.
"""

from __future__ import annotations

import os

from fastapi import HTTPException, Request, status


# Env var name matches CI's expectation (see CI_INTEGRATION.md Part 1d).
_TOKEN_ENV = "ADVERSARY_API_TOKEN"
_AUTH_BYPASS_ENV = "ADVERSARY_DISABLE_AUTH"  # ONLY for local dev / tests


class AuthError(HTTPException):
    def __init__(self, detail: str, status_code: int = status.HTTP_401_UNAUTHORIZED):
        super().__init__(status_code=status_code, detail=detail)


def require_bearer(request: Request) -> str:
    """FastAPI dependency. Returns the validated bearer token (opaque)."""
    if os.getenv(_AUTH_BYPASS_ENV) == "1":
        return "auth-disabled-dev"

    configured = os.getenv(_TOKEN_ENV, "")
    if not configured:
        raise AuthError(
            "Server is misconfigured: ADVERSARY_API_TOKEN not set",
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise AuthError("Missing or malformed Authorization header")

    presented = header.split(" ", 1)[1].strip()
    if not _constant_time_eq(presented, configured):
        raise AuthError("Invalid bearer token", status_code=status.HTTP_403_FORBIDDEN)

    return presented


def _constant_time_eq(a: str, b: str) -> bool:
    """Length-independent constant-time comparison."""
    if len(a) != len(b):
        return False
    result = 0
    for x, y in zip(a, b):
        result |= ord(x) ^ ord(y)
    return result == 0
