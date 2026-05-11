"""Shared interface for attacker LLM clients.

The Red Team Agent talks to whichever attacker model the Orchestrator
picked (abliterated Llama on RunPod, or DeepSeek-R1 via API) through
this small interface. Adding a new attacker model = subclass + register;
no changes to the mutator or seed dispatcher."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class LLMClientError(RuntimeError):
    """Surfaced when an attacker model is unreachable, rate-limited, or returns
    an unparseable response. Caught by the Orchestrator's halt logic."""


@dataclass
class LLMResponse:
    text: str
    prompt_tokens: int
    completion_tokens: int
    model: str
    usd_cost: float


class LLMClient(Protocol):
    """Both attacker clients must implement this. Async to match FastAPI's
    request-handling model — we'll fire many of these in parallel from the
    Orchestrator."""

    model_name: str  # e.g. "huihui-ai/Llama-3.3-70B-Instruct-abliterated"

    async def complete(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 800,
        temperature: float = 0.9,
    ) -> LLMResponse:
        ...
