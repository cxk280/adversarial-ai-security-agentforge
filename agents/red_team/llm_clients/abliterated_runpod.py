"""Attacker client for huihui-ai's abliterated Llama variants hosted on
RunPod serverless GPU.

The default `model_name` below targets the 3B-finetuned variant — small
enough to fit a 24GB RunPod worker comfortably (~6 GB fp16 + KV cache)
and fast enough that workers come ready in 2–4 min. Architecturally
this is the same primitive as the 70B; we keep the 70B as the documented
production target in ARCHITECTURE.md and swap up when GPU capacity
allows. The Red Team interface is model-agnostic — change `model_name`
or pass `endpoint_url` to point at a different RunPod endpoint and the
rest of the pipeline is unaffected.

Wire-protocol note: we use RunPod's native `/runsync` endpoint rather
than the `/openai/v1/chat/completions` proxy. Empirically the OpenAI
proxy on our endpoint returns 500s while `/runsync` works end-to-end.
The native protocol is also strictly less work for the worker — no
OpenAI-compat translation layer in the hot path. The response shape
is `{output: [{choices: [{tokens: [...]}], usage: {input, output}}]}`.
Auth is a bearer token on the RunPod endpoint URL itself (per-endpoint,
not account-wide)."""

from __future__ import annotations

import os
import httpx

from agents.red_team.llm_clients.base import (
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
    model_name = "huihui-ai/Llama-3.2-3B-Instruct-abliterated-finetuned"

    def __init__(
        self,
        *,
        endpoint_url: str | None = None,
        api_key: str | None = None,
        timeout_s: float = 60.0,
    ) -> None:
        # RUNPOD_ENDPOINT used to point at `.../openai/v1` for the proxy;
        # we now want the bare endpoint root so we can hit `/runsync`.
        # Tolerate either shape: strip any `/openai/v1` suffix.
        raw = (endpoint_url or os.getenv("RUNPOD_ENDPOINT") or "").rstrip("/")
        if raw.endswith("/openai/v1"):
            raw = raw[: -len("/openai/v1")]
        self.endpoint_url = raw
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
            "input": {
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            try:
                resp = await client.post(
                    f"{self.endpoint_url}/runsync",
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
            # RunPod's worker-vllm runsync output shape:
            #   {"output": [{"choices": [{"tokens": [...]}], "usage": {"input": N, "output": M}}], ...}
            out = data.get("output")
            if not out or not isinstance(out, list):
                raise LLMClientError(f"RunPod returned no output: {data!r}")
            first = out[0]
            choices = first.get("choices") or []
            if not choices:
                raise LLMClientError(f"RunPod output has no choices: {first!r}")
            tokens = choices[0].get("tokens") or [""]
            text = tokens[0] if isinstance(tokens[0], str) else "".join(tokens)
            usage = first.get("usage", {})
            pt = int(usage.get("input", 0))
            ct = int(usage.get("output", 0))
        except (KeyError, IndexError, ValueError, TypeError) as exc:
            raise LLMClientError(f"RunPod response malformed: {exc}") from exc

        usd = pt * _USD_PER_PROMPT_TOKEN + ct * _USD_PER_COMPLETION_TOKEN
        return LLMResponse(
            text=text,
            prompt_tokens=pt,
            completion_tokens=ct,
            model=self.model_name,
            usd_cost=usd,
        )
