"""Text-only completions. The overnight budget rule was Groq "openai/gpt-oss-120b" (free) -> Groq
"openai/gpt-oss-20b" -> Groq "qwen/qwen3.8-27b" (free, each with its own daily quota) -> Gemini ->
Claude "claude-sonnet-5-5" (paid, capped). On 2026-10-15, with Groq and Gemini out of quota, the
user put Claude first; TEXT_CHAIN_ORDER=groq,gemini,claude restores the overnight order.

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

# (provider, model) per provider; each Groq model has its own free quota
PROVIDER_MODELS: dict[str, list[tuple[str, str]]] = {
    "groq": [("groq", os.getenv("GROQ_TEXT_MODEL", "openai/gpt-oss-120b")),
             ("groq", os.getenv("GROQ_TEXT_MODEL_2", "openai/gpt-oss-20b")),
             ("groq", os.getenv("GROQ_TEXT_MODEL_3", "qwen/qwen3.8-27b"))],
    "gemini": [("gemini", os.getenv("GEMINI_TEXT_MODEL", "gemini-flash-latest"))],
    "claude": [("claude", os.getenv("CLAUDE_TEXT_MODEL", "claude-sonnet-5-5"))],
}
OVERNIGHT_ORDER = "groq,gemini,claude"
TEXT_CHAIN_ORDER = [p.strip() for p in os.getenv("TEXT_CHAIN_ORDER", "claude,groq,gemini").split(",") if p.strip() in PROVIDER_MODELS]
TEXT_CHAIN: list[tuple[str, str]] = [m for p in TEXT_CHAIN_ORDER for m in PROVIDER_MODELS[p]]
GROQ_QWEN_MAX_TOKENS = 1000  # this account's output-tokens-per-minute limit for qwen (see semantics/providers.py)
Messages = list[dict]  # [{"role": "user" | "assistant", "content": str}]
KEYS = {"groq": "GROQ_API_KEY", "gemini": "GEMINI_API_KEY", "claude": "ANTHROPIC_API_KEY"}
TIMEOUT_S = float(os.getenv("TEXT_TIMEOUT_S", "60"))
MAX_RATE_RETRIES = 3
TRANSIENT_WAITS = (3.0, 8.0)  # a timeout, dropped connection or 5xx is retried on the same provider first
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

def _groq(system: str, messages: Messages, *, model: str, max_tokens: int, temperature: float, json_mode: bool) -> tuple[str, dict]:
    from groq import Groq

    client = Groq(api_key=os.environ[KEYS["groq"]], timeout=TIMEOUT_S, max_retries=0)
    kwargs: dict = {}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if "gpt-oss" in model:
        kwargs["reasoning_effort"] = "low"
    elif "qwen" in model:
        kwargs.update(reasoning_format="hidden", reasoning_effort="none")
        max_tokens = min(max_tokens, GROQ_QWEN_MAX_TOKENS)
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, *messages],
        temperature=temperature,
        max_completion_tokens=max_tokens,
        **kwargs,
    )
    choice = resp.choices[0]
    if choice.finish_reason == "length":
        raise RuntimeError(f"output truncated at {max_tokens} tokens")
    u = {"input_tokens": resp.usage.prompt_tokens, "output_tokens": resp.usage.completion_tokens} if resp.usage else {}
    return choice.message.content or "", u


def _gemini(system: str, messages: Messages, *, model: str, max_tokens: int, temperature: float, json_mode: bool) -> tuple[str, dict]:
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
    contents = [types.Content(role="model" if m["role"] == "assistant" else "user", parts=[types.Part(text=m["content"])]) for m in messages]
    resp = client.models.generate_content(model=model, contents=contents, config=config)
    if not resp.text:
        raise RuntimeError("Gemini returned no text")
    um = resp.usage_metadata
    u = {"input_tokens": getattr(um, "prompt_token_count", None), "output_tokens": getattr(um, "candidates_token_count", None)} if um else {}
    return resp.text, u


def _claude(system: str, messages: Messages, *, model: str, max_tokens: int, temperature: float, json_mode: bool) -> tuple[str, dict]:
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ[KEYS["claude"]], timeout=TIMEOUT_S, max_retries=0)
    msg = client.messages.create(
        model=model,
        system=system + ("\nReply with only the JSON object, no markdown." if json_mode else ""),
        max_tokens=max_tokens,  # this SDK version takes no sampling parameters
        # the API wants the first message from the user (a history window can start mid-conversation)
        messages=messages if messages[0]["role"] == "user" else [{"role": "user", "content": "(earlier conversation omitted)"}, *messages],
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


_TRANSIENT = ("timed out", "timeout", "connection error", "connection reset", "overloaded", "internal server error",
              "bad gateway", "service unavailable", "error code: 500", "error code: 502", "error code: 503", "error code: 529")


def _transient(e: Exception) -> bool:
    """Worth one or two retries on the same provider (not a quota, not a bad request)."""
    t = f"{type(e).__name__} {e}".lower()
    return not _rate_limited(e) and not usage.quota_exhausted(e) and any(x in t for x in _TRANSIENT)


def complete(system: str, user: "str | Messages", *, parse: Callable[[object], T] = lambda v: v, json_mode: bool = True,
             max_tokens: int = 1200, temperature: float = 0.7, chain: Optional[list[tuple[str, str]]] = None,
             sleep: Callable[[float], None] = time.sleep) -> TextResult:
    """Run the chain on one user message or a message history; `parse` gets the decoded JSON (or
    the raw text when json_mode is False) and may raise ValueError / ValidationError to reject it
    (one retry per model)."""
    attempts: list[dict] = []
    base: Messages = [{"role": "user", "content": user}] if isinstance(user, str) else list(user)
    for name, model in chain or TEXT_CHAIN:
        if not os.getenv(KEYS[name]):
            attempts.append({"provider": name, "status": "skipped", "error": f"{KEYS[name]} not set"})
            continue
        slot = f"{name}:{model}"  # quotas are per model
        if usage.cooling(slot):
            attempts.append({"provider": name, "model": model, "status": "skipped", "error": "quota exhausted earlier, cooling down"})
            continue
        messages, invalid, rate_retries, transient = base, 0, 0, 0
        while True:
            try:
                with usage.track(name, model) as meta:
                    text, u = CALLS[name](system, messages, model=model, max_tokens=max_tokens,
                                          temperature=temperature, json_mode=json_mode)
                    meta.update(u)
            except usage.CapReached as e:
                attempts.append({"provider": name, "model": model, "status": "cap", "error": str(e)})
                break
            except Exception as e:  # noqa: BLE001
                if usage.quota_exhausted(e):
                    usage.cool_down(slot)
                elif _rate_limited(e) and rate_retries < MAX_RATE_RETRIES:
                    wait = _retry_after(e)
                    if wait is None or wait <= MAX_WAIT_S:
                        wait = wait if wait is not None else min(MAX_WAIT_S, 3.0 * 2 ** rate_retries) + random.random()
                        attempts.append({"provider": name, "model": model, "status": "rate_limited", "wait_s": round(wait, 1)})
                        rate_retries += 1
                        sleep(wait)
                        continue
                if _transient(e) and transient < len(TRANSIENT_WAITS):
                    attempts.append({"provider": name, "model": model, "status": "transient", "wait_s": TRANSIENT_WAITS[transient]})
                    sleep(TRANSIENT_WAITS[transient])
                    transient += 1
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
                fix = f"Your previous answer was not valid ({' '.join(str(e).split())[:200]}). Reply again, following the format exactly."
                messages = [*base[:-1], {**base[-1], "content": base[-1]["content"] + "\n\n" + fix}]
                continue
            attempts.append({"provider": name, "model": model, "status": "ok"})
            return TextResult(value, text, name, model, attempts)
    raise TextError("no text provider produced a valid answer", attempts)
