"""Attacker client for DeepSeek-R1 via the DeepSeek API.

DeepSeek exposes an OpenAI-compatible `/chat/completions` endpoint at
api.deepseek.com. Two model strings are available:
- `deepseek-chat`     — general-purpose, faster, cheaper
- `deepseek-reasoner` — R1 with explicit chain-of-thought, slower, costlier

We use `deepseek-reasoner` by default because the escalation triggers
(ARCHITECTURE.md §1.1.1) fire exactly when chain-of-thought is the win:
reasoning-heavy categories, deeper TAP branches, longer conversations."""

from __future__ import annotations

import os
import httpx

from agents.red_team.llm_clients.base import (
    LLMClient,
    LLMResponse,
    LLMClientError,
)


# Per DeepSeek's published pricing (verify before deploy):
#   deepseek-reasoner — input $0.55 / Mtok, output $2.19 / Mtok
_USD_PER_PROMPT_TOKEN = 0.55 / 1_000_000
_USD_PER_COMPLETION_TOKEN = 2.19 / 1_000_000


class DeepSeekClient:
    model_name = "deepseek-reasoner"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = "https://api.deepseek.com",
        timeout_s: float = 90.0,
        model: str | None = None,
    ) -> None:
        self.api_key = api_key or os.getenv("DEEPSEEK_API_KEY") or ""
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        if model:
            self.model_name = model
        if not self.api_key:
            raise LLMClientError("DEEPSEEK_API_KEY not configured")

    async def complete(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 800,
        temperature: float = 0.9,
    ) -> LLMResponse:
        body = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/chat/completions",
                    json=body,
                    headers=headers,
                )
            except httpx.HTTPError as exc:
                raise LLMClientError(f"DeepSeek request failed: {exc}") from exc
        if resp.status_code >= 400:
            raise LLMClientError(
                f"DeepSeek returned {resp.status_code}: {resp.text[:300]}"
            )
        try:
            data = resp.json()
            text = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            pt = int(usage.get("prompt_tokens", 0))
            ct = int(usage.get("completion_tokens", 0))
        except (KeyError, IndexError, ValueError) as exc:
            raise LLMClientError(f"DeepSeek response malformed: {exc}") from exc

        usd = pt * _USD_PER_PROMPT_TOKEN + ct * _USD_PER_COMPLETION_TOKEN
        return LLMResponse(
            text=text,
            prompt_tokens=pt,
            completion_tokens=ct,
            model=self.model_name,
            usd_cost=usd,
        )
