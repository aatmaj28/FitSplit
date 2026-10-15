"""Text-only JSON completions with the overnight budget rules:
Groq "openai/gpt-oss-120b" (free) -> Gemini -> Claude "claude-sonnet-5-5" (paid, capped).

A 429 is retried with backoff on the same provider (honouring Retry-After); a long Retry-After
(daily quota gone), any other error, or output that `parse` rejects twice moves on to the next
provider. Every request goes through usage.track, so it is counted and Claude obeys its cap.
"""
from __future__ import annotations

import json
import os
import random
import time
from dataclasses import dataclass, field
from typing import Callable, Optional, TypeVar

from pydantic import ValidationError

from . import usage

T = TypeVar("T")

TEXT_ORDER = ["groq", "gemini", "claude"]
TEXT_MODELS = {
    "groq": os.getenv("GROQ_TEXT_MODEL", "openai/gpt-oss-120b"),
    "gemini": os.getenv("GEMINI_TEXT_MODEL", "gemini-flash-latest"),
    "claude": os.getenv("CLAUDE_TEXT_MODEL", "claude-sonnet-5-5"),
}
KEYS = {"groq": "GROQ_API_KEY", "gemini": "GEMINI_API_KEY", "claude": "ANTHROPIC_API_KEY"}
TIMEOUT_S = float(os.getenv("TEXT_TIMEOUT_S", "60"))
MAX_RATE_RETRIES = 3
MAX_WAIT_S = 45.0  # a longer Retry-After means "come back much later": use the next provider


class TextError(RuntimeError):
    def __init__(self, message: str, attempts: list[dict]):
        super().__init__(message)
        self.attempts = attempts


@dataclass
class TextResult:
    value: object
    text: str
    provider: str
    model: str
    attempts: list[dict] = field(default_factory=list)


# ----------------------------------------------------------------------------- providers

def _groq(system: str, user: str, *, model: str, max_tokens: int, temperature: float, json_mode: bool) -> tuple[str, dict]:
    from groq import Groq

    client = Groq(api_key=os.environ[KEYS["groq"]], timeout=TIMEOUT_S, max_retries=0)
    kwargs: dict = {}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if "gpt-oss" in model:
        kwargs["reasoning_effort"] = "low"
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=temperature,
        max_completion_tokens=max_tokens,
        **kwargs,
    )
    choice = resp.choices[0]
    if choice.finish_reason == "length":
        raise RuntimeError(f"output truncated at {max_tokens} tokens")
    u = {"input_tokens": resp.usage.prompt_tokens, "output_tokens": resp.usage.completion_tokens} if resp.usage else {}
    return choice.message.content or "", u


def _gemini(system: str, user: str, *, model: str, max_tokens: int, temperature: float, json_mode: bool) -> tuple[str, dict]:
    from google import genai
    from google.genai import types

    client = genai.Client(
        api_key=os.environ[KEYS["gemini"]],
        http_options=types.HttpOptions(timeout=int(TIMEOUT_S * 1000), retry_options=types.HttpRetryOptions(attempts=1)),
    )
    config = types.GenerateContentConfig(
        system_instruction=system,
        temperature=temperature,
        max_output_tokens=max_tokens + 2048,  # room for (low) thinking
        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
    )
    if json_mode:
        config.response_mime_type = "application/json"
    resp = client.models.generate_content(model=model, contents=user, config=config)
    if not resp.text:
        raise RuntimeError("Gemini returned no text")
    um = resp.usage_metadata
    u = {"input_tokens": getattr(um, "prompt_token_count", None), "output_tokens": getattr(um, "candidates_token_count", None)} if um else {}
    return resp.text, u


def _claude(system: str, user: str, *, model: str, max_tokens: int, temperature: float, json_mode: bool) -> tuple[str, dict]:
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ[KEYS["claude"]], timeout=TIMEOUT_S, max_retries=0)
    msg = client.messages.create(
        model=model,
        system=system + ("\nReply with only the JSON object, no markdown." if json_mode else ""),
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[{"role": "user", "content": user}],
    )
    if msg.stop_reason == "max_tokens":
        raise RuntimeError(f"output truncated at {max_tokens} tokens")
    return "".join(b.text for b in msg.content if b.type == "text"), {
        "input_tokens": msg.usage.input_tokens, "output_tokens": msg.usage.output_tokens}


CALLS: dict[str, Callable[..., tuple[str, dict]]] = {"groq": _groq, "gemini": _gemini, "claude": _claude}


# ----------------------------------------------------------------------------- chain

def _rate_limited(e: BaseException) -> bool:
    code = getattr(e, "status_code", None) or getattr(e, "code", None)
    s = str(e)
    return code == 429 or "429" in s or "RESOURCE_EXHAUSTED" in s or "rate limit" in s.lower()


def _retry_after(e: BaseException) -> Optional[float]:
    resp = getattr(e, "response", None)
    headers = getattr(resp, "headers", None) or {}
    try:
        v = headers.get("retry-after")
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def extract_json(text: str) -> object:
    s = (text or "").strip()
    if s.startswith("```"):
        s = s.strip("`")
        s = s[s.find("\n") + 1:] if "\n" in s else s
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        i, j = s.find("{"), s.rfind("}")
        if i >= 0 and j > i:
            return json.loads(s[i:j + 1])
        raise


def complete(system: str, user: str, *, parse: Callable[[object], T] = lambda v: v, json_mode: bool = True,
             max_tokens: int = 1200, temperature: float = 0.7, order: Optional[list[str]] = None,
             sleep: Callable[[float], None] = time.sleep) -> TextResult:
    """Run the chain; `parse` gets the decoded JSON (or the raw text when json_mode is False)
    and may raise ValueError / ValidationError to reject it (one retry per provider)."""
    attempts: list[dict] = []
    for name in order or TEXT_ORDER:
        if not os.getenv(KEYS[name]):
            attempts.append({"provider": name, "status": "skipped", "error": f"{KEYS[name]} not set"})
            continue
        if usage.cooling(name):
            attempts.append({"provider": name, "status": "skipped", "error": "quota exhausted earlier, cooling down"})
            continue
        model = TEXT_MODELS[name]
        prompt_user, invalid, rate_retries = user, 0, 0
        while True:
            try:
                with usage.track(name, model) as meta:
                    text, u = CALLS[name](system, prompt_user, model=model, max_tokens=max_tokens,
                                          temperature=temperature, json_mode=json_mode)
                    meta.update(u)
            except usage.CapReached as e:
                attempts.append({"provider": name, "model": model, "status": "cap", "error": str(e)})
                break
            except Exception as e:  # noqa: BLE001
                if usage.quota_exhausted(e):
                    usage.cool_down(name)
                elif _rate_limited(e) and rate_retries < MAX_RATE_RETRIES:
                    wait = _retry_after(e)
                    if wait is None or wait <= MAX_WAIT_S:
                        wait = wait if wait is not None else min(MAX_WAIT_S, 3.0 * 2 ** rate_retries) + random.random()
                        attempts.append({"provider": name, "model": model, "status": "rate_limited", "wait_s": round(wait, 1)})
                        rate_retries += 1
                        sleep(wait)
                        continue
                attempts.append({"provider": name, "model": model, "status": "rate_limited" if _rate_limited(e) else "api_error",
                                 "error": " ".join(str(e).split())[:200]})
                break
            try:
                value = parse(extract_json(text) if json_mode else text)
            except (json.JSONDecodeError, ValidationError, ValueError, TypeError, KeyError) as e:
                invalid += 1
                attempts.append({"provider": name, "model": model, "status": "invalid_output", "error": " ".join(str(e).split())[:200]})
                if invalid >= 2:
                    break
                prompt_user = user + f"\n\nYour previous answer was not valid ({' '.join(str(e).split())[:200]}). Reply again, following the format exactly."
                continue
            attempts.append({"provider": name, "model": model, "status": "ok"})
            return TextResult(value, text, name, model, attempts)
    raise TextError("no text provider produced a valid answer", attempts)
