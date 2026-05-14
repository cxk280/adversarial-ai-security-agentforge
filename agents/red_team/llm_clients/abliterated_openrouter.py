"""Attacker client for refusal-removed / abliterated Llama variants
hosted on OpenRouter behind an OpenAI-compatible API.

This is the demo-time stand-in for the RunPod self-hosted client
(huihui-ai/Llama-3.2-3B-Instruct-abliterated-finetuned). OpenRouter
hosts model-equivalent variants from the cognitivecomputations
"Dolphin" family and Nous Research "Hermes" family — same
"instruction-tuned, refusal-aligned" architectural class as huihui's
abliterated finetune. The mutator pipeline doesn't care which
specific variant is on the other side of the wire as long as it
declines to refuse adversarial prompts.

Production-bound deployment still targets RunPod / Modal (see
ARCHITECTURE.md §2.1). OpenRouter is the demo path because (a) no GPU
debugging, (b) flat token pricing for predictable cost, (c) <10 min
to swap in.

The Red Team interface is model-agnostic — change `model_name` or
construct with a different model + endpoint to point at any
OpenAI-compatible host with refusal-removed Llama / Hermes variants."""

from __future__ import annotations

import os
import httpx

from agents.red_team.llm_clients.base import (
    LLMResponse,
    LLMClientError,
)


# OpenRouter pricing for cognitivecomputations/dolphin-mixtral-8x7b
# is roughly $0.60/M input, $0.60/M output as of 2026-05-14. A
# 30-attempt mutation campaign with ~1k tokens each costs ~$0.03.
# We keep precise per-call accounting so the spend rollup in the
# campaign reflects actual cost, not a fudge.
_USD_PER_PROMPT_TOKEN = 0.6 / 1_000_000
_USD_PER_COMPLETION_TOKEN = 0.6 / 1_000_000


class AbliteratedOpenRouterClient:
    """OpenRouter-hosted attacker model. Chosen variant: a Hermes-3
    Llama variant which is uncensored / refusal-removed by design,
    matching huihui-ai's abliterated architecture class."""

    model_name = "cognitivecomputations/dolphin-mixtral-8x22b"

    def __init__(
        self,
        *,
        endpoint_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        timeout_s: float = 60.0,
    ) -> None:
        self.endpoint_url = (
            endpoint_url
            or os.getenv("OPENROUTER_ENDPOINT")
            or "https://openrouter.ai/api/v1"
        ).rstrip("/")
        self.api_key = api_key or os.getenv("OPENROUTER_API_KEY") or ""
        if model:
            self.model_name = model
        elif os.getenv("OPENROUTER_MODEL"):
            self.model_name = os.environ["OPENROUTER_MODEL"]
        self.timeout_s = timeout_s
        if not self.api_key:
            raise LLMClientError("OPENROUTER_API_KEY not configured")

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
            # OpenRouter requires HTTP-Referer for analytics; setting
            # it explicitly lets them attribute the call to the
            # AgentForge Adversarial Platform rather than mark the
            # call as anonymous.
            "HTTP-Referer": "https://adversary-ui-dev.up.railway.app",
            "X-Title": "AgentForge Adversarial Platform",
        }
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            try:
                resp = await client.post(
                    f"{self.endpoint_url}/chat/completions",
                    json=body,
                    headers=headers,
                )
            except httpx.HTTPError as exc:
                raise LLMClientError(f"OpenRouter request failed: {exc}") from exc
        if resp.status_code >= 400:
            raise LLMClientError(
                f"OpenRouter returned {resp.status_code}: {resp.text[:300]}"
            )
        try:
            data = resp.json()
            text = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            pt = int(usage.get("prompt_tokens", 0))
            ct = int(usage.get("completion_tokens", 0))
        except (KeyError, IndexError, ValueError) as exc:
            raise LLMClientError(f"OpenRouter response malformed: {exc}") from exc

        usd = pt * _USD_PER_PROMPT_TOKEN + ct * _USD_PER_COMPLETION_TOKEN
        return LLMResponse(
            text=text,
            prompt_tokens=pt,
            completion_tokens=ct,
            model=self.model_name,
            usd_cost=usd,
        )
