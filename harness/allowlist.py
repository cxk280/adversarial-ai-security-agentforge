"""Target-host allowlist — the operational enforcement of ARCHITECTURE.md §13.

Every HTTP call the platform makes against a target MUST go through
this allowlist. Anything not listed here is rejected before bytes
hit the wire. Allowlist changes require a PR + update to §13 of
ARCHITECTURE.md."""

from __future__ import annotations

from urllib.parse import urlparse

# Hosts authorized for adversarial testing per ARCHITECTURE.md §13.
# Time window: 2026-05-11 through 2026-05-22.
ALLOWED_HOSTS: frozenset[str] = frozenset(
    {
        "copilot-agent-production-41de.up.railway.app",
        "copilot-agent-qa.up.railway.app",
        "copilot-agent-dev.up.railway.app",
        "localhost",
        "127.0.0.1",
    }
)


class TargetNotAllowedError(RuntimeError):
    """Raised when a request is attempted against a host not in the allowlist."""


def check_url(url: str) -> None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise TargetNotAllowedError(
            f"Target host {host!r} is not in the authorization allowlist. "
            f"Allowed hosts: {sorted(ALLOWED_HOSTS)}. "
            f"To add a host, update harness/allowlist.py AND ARCHITECTURE.md §13."
        )
