"""Secondary Judge — OpenAI GPT-4.1-mini.

Different model family from Claude — the load-bearing property of the
dual-Judge design. ~$0.40 / $1.60 per Mtok.

We use OpenAI's `response_format = {"type": "json_object"}` to force
structured output and avoid parser fragility."""

from __future__ import annotations

import json
import os
import re
from typing import Any

from agents.judge.base import JudgeVerdict, JudgeError


_USD_PER_PROMPT_TOKEN = 0.40 / 1_000_000
_USD_PER_COMPLETION_TOKEN = 1.60 / 1_000_000


# Reuse the Primary's system prompt verbatim. The point of the dual-Judge
# is family independence — different prompts would muddy the signal.
from agents.judge.primary_haiku import _JUDGE_SYSTEM_PROMPT, _build_user_prompt


class GPT41MiniJudge:
    model_name = "gpt-4.1-mini"

    def __init__(self, *, api_key: str | None = None) -> None:
        try:
            from openai import AsyncOpenAI  # type: ignore[import-not-found]
        except ImportError as exc:
            raise JudgeError(
                "openai SDK not installed; pip install openai"
            ) from exc

        key = api_key or os.getenv("OPENAI_API_KEY")
        if not key:
            raise JudgeError("OPENAI_API_KEY not configured")
        self._client = AsyncOpenAI(api_key=key)

    async def score(
        self,
        *,
        attack: str,
        target_response: str,
        rubric: str,
        category: str,
        subcategory: str,
    ) -> JudgeVerdict:
        user_prompt = _build_user_prompt(
            attack=attack,
            target_response=target_response,
            rubric=rubric,
            category=category,
            subcategory=subcategory,
        )
        try:
            resp = await self._client.chat.completions.create(
                model=self.model_name,
                temperature=0.0,
                max_tokens=400,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": _JUDGE_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )
        except Exception as exc:
            raise JudgeError(f"GPT-4.1-mini judge call failed: {exc}") from exc

        text = resp.choices[0].message.content or ""
        verdict, rationale = _parse_verdict(text)

        usage = resp.usage
        pt = usage.prompt_tokens if usage else 0
        ct = usage.completion_tokens if usage else 0

        return JudgeVerdict(
            verdict=verdict,
            rationale=rationale,
            model=self.model_name,
            prompt_tokens=pt,
            completion_tokens=ct,
            usd_cost=pt * _USD_PER_PROMPT_TOKEN + ct * _USD_PER_COMPLETION_TOKEN,
        )


_JSON_BLOCK_RE = re.compile(r"\{[\s\S]*\}")


def _parse_verdict(text: str) -> tuple[str, str]:
    match = _JSON_BLOCK_RE.search(text)
    if not match:
        raise JudgeError(f"Judge did not emit JSON: {text[:200]!r}")
    try:
        obj: Any = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise JudgeError(f"Judge JSON unparseable: {exc}") from exc
    v = obj.get("verdict")
    if v not in ("pass", "fail", "partial", "inconclusive"):
        raise JudgeError(f"Unknown verdict {v!r} from judge")
    return v, str(obj.get("rationale", ""))
