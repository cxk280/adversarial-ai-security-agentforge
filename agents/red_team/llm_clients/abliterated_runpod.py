"""Attacker client for `huihui-ai/Llama-3.3-70B-Instruct-abliterated`
hosted on RunPod serverless GPU behind an OpenAI-compatible API.

RunPod's vLLM template exposes `/v1/chat/completions` matching the
OpenAI request/response shape. Auth is a bearer token on the
RunPod endpoint URL itself (per-endpoint, not account-wide)."""

from __future__ import annotations

import os
import httpx

from agents.red_team.llm_clients.base import (
    LLMClient,
    LLMResponse,
    LLMClientError,
)


# Pricing assumes our own RunPod-hosted endpoint. We pay per GPU-hour
# while the worker is warm, not per token, so per-call USD cost in
# steady-state is ~$0. We carry a tiny non-zero number for budget
# tracking to avoid div-by-zero downstream and to surface accidental
# token-spend regressions.
_USD_PER_PROMPT_TOKEN = 0.0
_USD_PER_COMPLETION_TOKEN = 0.0


class AbliteratedRunPodClient:
    model_name = "huihui-ai/Llama-3.3-70B-Instruct-abliterated"

    def __init__(
        self,
        *,
        endpoint_url: str | None = None,
        api_key: str | None = None,
        timeout_s: float = 60.0,
    ) -> None:
        self.endpoint_url = (endpoint_url or os.getenv("RUNPOD_ENDPOINT") or "").rstrip("/")
        self.api_key = api_key or os.getenv("RUNPOD_API_KEY") or ""
        self.timeout_s = timeout_s
        if not self.endpoint_url:
            raise LLMClientError(
                "RUNPOD_ENDPOINT not configured — set it to the deployed worker URL"
            )
        if not self.api_key:
            raise LLMClientError("RUNPOD_API_KEY not configured")

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
                    f"{self.endpoint_url}/v1/chat/completions",
                    json=body,
                    headers=headers,
                )
            except httpx.HTTPError as exc:
                raise LLMClientError(f"RunPod request failed: {exc}") from exc
        if resp.status_code >= 400:
            raise LLMClientError(
                f"RunPod returned {resp.status_code}: {resp.text[:300]}"
            )
        try:
            data = resp.json()
            text = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            pt = int(usage.get("prompt_tokens", 0))
            ct = int(usage.get("completion_tokens", 0))
        except (KeyError, IndexError, ValueError) as exc:
            raise LLMClientError(f"RunPod response malformed: {exc}") from exc

        usd = pt * _USD_PER_PROMPT_TOKEN + ct * _USD_PER_COMPLETION_TOKEN
        return LLMResponse(
            text=text,
            prompt_tokens=pt,
            completion_tokens=ct,
            model=self.model_name,
            usd_cost=usd,
        )
