"""HTTP executor for adversarial attacks against the Clinical Co-Pilot.

This module is the *only* place outbound HTTP calls leave the platform.
Every call:
  1. Checks the target host against the allowlist (ARCHITECTURE.md §13).
  2. Stamps the request with X-Adversarial-Test = 1 so the target's
     own observability layer can distinguish red-team traffic.
  3. Enforces per-call timeouts and per-host rate limits.
  4. Returns a structured AttackResult, never a bare response.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, asdict, field
from typing import Any

import requests

from harness.allowlist import check_url, TargetNotAllowedError

DEFAULT_TIMEOUT = 30.0
MAX_RESPONSE_BYTES = 256 * 1024  # 256 KB ceiling per response


@dataclass
class AttackResult:
    """A single attack execution.

    Stored as JSONL in ./evals/results/<campaign_id>.jsonl.
    Replayable: feed the request_body back in and you reproduce the run."""

    attack_id: str
    campaign_id: str
    target_url: str
    target_endpoint: str
    session_id: str
    patient_id: str
    request_body: dict
    response_status: int
    response_text: str
    latency_ms: int
    error: str | None = None
    timestamp: float = field(default_factory=time.time)
    extra: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return asdict(self)


class CoPilotExecutor:
    """HTTP client for the Clinical Co-Pilot target.

    Each instance is bound to a single target base URL. The allowlist
    is checked at construction AND on every dispatch (defense in depth)."""

    def __init__(self, target_base_url: str, *, timeout: float = DEFAULT_TIMEOUT) -> None:
        check_url(target_base_url)
        self.target_base_url = target_base_url.rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update(
            {
                "User-Agent": "AgentForge-Adversarial/0.1 (authorized testing per ARCHITECTURE.md §13)",
                "X-Adversarial-Test": "1",
            }
        )

    # ------------------------------------------------------------------
    # Endpoint wrappers
    # ------------------------------------------------------------------

    def chat(
        self,
        *,
        attack_id: str,
        campaign_id: str,
        session_id: str,
        patient_id: str,
        message: str,
        active_user: str = "adversarial_test",
        pending_doc_uploads: list[dict] | None = None,
        endpoint: str = "/chat",
    ) -> AttackResult:
        url = f"{self.target_base_url}{endpoint}"
        check_url(url)
        body: dict[str, Any] = {
            "session_id": session_id,
            "patient_id": patient_id,
            "message": message[:4000],  # ChatRequest cap
            "active_user": active_user,
        }
        if pending_doc_uploads:
            body["pending_doc_uploads"] = pending_doc_uploads[:8]

        return self._post(
            attack_id=attack_id,
            campaign_id=campaign_id,
            url=url,
            endpoint=endpoint,
            session_id=session_id,
            patient_id=patient_id,
            body=body,
        )

    def chat_graph(
        self,
        *,
        attack_id: str,
        campaign_id: str,
        session_id: str,
        patient_id: str,
        message: str,
        active_user: str = "adversarial_test",
        pending_doc_uploads: list[dict] | None = None,
    ) -> AttackResult:
        # /chat/graph emits NDJSON event stream — we collect, not stream.
        return self.chat(
            attack_id=attack_id,
            campaign_id=campaign_id,
            session_id=session_id,
            patient_id=patient_id,
            message=message,
            active_user=active_user,
            pending_doc_uploads=pending_doc_uploads,
            endpoint="/chat/graph",
        )

    # ------------------------------------------------------------------
    # Core dispatcher
    # ------------------------------------------------------------------

    def _post(
        self,
        *,
        attack_id: str,
        campaign_id: str,
        url: str,
        endpoint: str,
        session_id: str,
        patient_id: str,
        body: dict,
    ) -> AttackResult:
        start = time.monotonic()
        status = 0
        text = ""
        error: str | None = None
        try:
            resp = self._session.post(url, json=body, timeout=self.timeout)
            status = resp.status_code
            if resp.content and len(resp.content) > MAX_RESPONSE_BYTES:
                text = resp.content[:MAX_RESPONSE_BYTES].decode(
                    "utf-8", errors="replace"
                )
                error = f"response truncated at {MAX_RESPONSE_BYTES} bytes"
            else:
                text = resp.text
            # Some endpoints (e.g. /chat/graph) stream NDJSON; surface the
            # concatenated "reply" fields when present.
            if endpoint.endswith("/graph") and text.startswith("{"):
                text = self._collect_ndjson_reply(text) or text
            elif endpoint == "/chat":
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, dict) and "reply" in parsed:
                        text = parsed["reply"]
                except json.JSONDecodeError:
                    pass
        except TargetNotAllowedError:
            raise
        except requests.RequestException as exc:
            error = f"{type(exc).__name__}: {exc}"
        latency_ms = int((time.monotonic() - start) * 1000)

        return AttackResult(
            attack_id=attack_id,
            campaign_id=campaign_id,
            target_url=self.target_base_url,
            target_endpoint=endpoint,
            session_id=session_id,
            patient_id=patient_id,
            request_body=body,
            response_status=status,
            response_text=text,
            latency_ms=latency_ms,
            error=error,
        )

    @staticmethod
    def _collect_ndjson_reply(text: str) -> str | None:
        """The /chat/graph endpoint streams NDJSON event lines. The final
        answer arrives as event type 'final_reply' with field 'text'.
        Concatenate any 'text_delta'-style events for the full reply."""
        chunks: list[str] = []
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(obj, dict):
                continue
            # Be permissive about the schema since it has evolved.
            for key in ("text", "reply", "delta", "content"):
                if key in obj and isinstance(obj[key], str):
                    chunks.append(obj[key])
                    break
        return "".join(chunks) if chunks else None


def new_session_id() -> str:
    return f"adv-{uuid.uuid4().hex[:16]}"
