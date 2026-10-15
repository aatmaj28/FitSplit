"""Provider fallback chain (default Gemini -> Claude -> Groq).

A provider fails on: API error, timeout, or invalid JSON after one retry. The
next provider is then tried. Forcing a provider disables fallback (useful when
comparing providers).
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import re
import time
from dataclasses import dataclass, field
from typing import Optional

from pydantic import ValidationError

from ..config import PROVIDER_ORDER, PROVIDER_TIMEOUT_S, provider_settings
from .prompt import PROMPT, RETRY_SUFFIX
from .providers import PROVIDERS, ProviderReply
from .schema import Semantics


class ProviderFailure(Exception):
    def __init__(self, provider: str, reason: str, attempts: list[dict]):
        super().__init__(f"{provider}: {reason}")
        self.provider, self.reason, self.attempts = provider, reason, attempts


class SemanticsError(Exception):
    def __init__(self, message: str, attempts: list[dict], warnings: list[str]):
        super().__init__(message)
        self.attempts, self.warnings = attempts, warnings


@dataclass
class SemanticsResult:
    semantics: Semantics
    provider: str
    model: str
    raw_text: str
    latency_s: float
    usage: dict = field(default_factory=dict)
    attempts: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


_FENCE_RE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.DOTALL)


def extract_json(text: str) -> object:
    s = (text or "").strip()
    m = _FENCE_RE.search(s)
    if m:
        s = m.group(1).strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        i, j = s.find("{"), s.rfind("}")
        if i >= 0 and j > i:
            return json.loads(s[i:j + 1])
        raise


def parse_semantics(text: str) -> Semantics:
    data = extract_json(text)
    if isinstance(data, list):
        data = {"rooms": data}
    return Semantics.model_validate(data)


def _short(e: BaseException, n: int = 200) -> str:
    msg = " ".join(str(e).split())
    return (msg[:n] + "...") if len(msg) > n else msg


def _is_timeout(e: BaseException) -> bool:
    return isinstance(e, TimeoutError) or "timeout" in type(e).__name__.lower() \
        or "timed out" in str(e).lower()


def _call_with_timeout(fn, timeout_s: float, **kwargs) -> ProviderReply:
    """SDK timeouts cover each HTTP read; this enforces a hard wall-clock limit too."""
    ex = cf.ThreadPoolExecutor(max_workers=1)
    fut = ex.submit(fn, timeout_s=timeout_s, **kwargs)
    try:
        return fut.result(timeout=timeout_s + 1.0)
    except cf.TimeoutError:
        raise TimeoutError(f"no reply within {timeout_s:.0f}s") from None
    finally:
        ex.shutdown(wait=False, cancel_futures=True)


def run_provider(name: str, image: bytes, mime: str, *, timeout_s: float,
                 settings: dict) -> SemanticsResult:
    fn = PROVIDERS[name]
    model, api_key = settings[name]["model"], settings[name]["api_key"]
    attempts: list[dict] = []
    prompt = PROMPT
    for attempt in (1, 2):  # second attempt only for invalid JSON
        t0 = time.monotonic()
        try:
            reply = _call_with_timeout(fn, timeout_s, image=image, mime=mime, prompt=prompt,
                                       model=model, api_key=api_key)
        except Exception as e:  # noqa: BLE001 - any SDK error means this provider failed
            status = "timeout" if _is_timeout(e) else "api_error"
            attempts.append({"provider": name, "model": model, "attempt": attempt, "status": status,
                             "error": _short(e), "latency_s": round(time.monotonic() - t0, 2)})
            raise ProviderFailure(name, f"{status}: {_short(e, 120)}", attempts) from e
        try:
            sem = parse_semantics(reply.text)
            sx, sy = reply.coord_scale
            if (sx, sy) != (1.0, 1.0):
                for room in sem.rooms:
                    x, y = room.label_center
                    room.label_center = [min(x * sx, 1.0), min(y * sy, 1.0)]
        except (json.JSONDecodeError, ValidationError, ValueError) as e:
            attempts.append({"provider": name, "model": reply.model, "attempt": attempt,
                             "status": "invalid_json", "error": _short(e),
                             "latency_s": round(reply.latency_s, 2)})
            prompt = PROMPT + RETRY_SUFFIX.format(error=_short(e, 300))
            continue
        attempts.append({"provider": name, "model": reply.model, "attempt": attempt, "status": "ok",
                         "latency_s": round(reply.latency_s, 2), "usage": reply.usage})
        return SemanticsResult(sem, name, reply.model, reply.text, reply.latency_s, reply.usage,
                               attempts)
    raise ProviderFailure(name, "invalid JSON after one retry", attempts)


def get_semantics(image: bytes, mime: str = "image/png", provider: Optional[str] = None,
                  order: Optional[list[str]] = None,
                  timeout_s: Optional[float] = None) -> SemanticsResult:
    settings = provider_settings()
    timeout_s = timeout_s or PROVIDER_TIMEOUT_S
    if provider:
        if provider not in PROVIDERS:
            raise ValueError(f"unknown provider {provider!r}; choose from {sorted(PROVIDERS)}")
        chain = [provider]
    else:
        chain = list(order or PROVIDER_ORDER)

    attempts: list[dict] = []
    warnings: list[str] = []
    for name in chain:
        if not settings[name]["api_key"]:
            warnings.append(f"semantics: skipped {name} ({settings[name]['env_key']} not set)")
            continue
        try:
            res = run_provider(name, image, mime, timeout_s=timeout_s, settings=settings)
        except ProviderFailure as e:
            attempts.extend(e.attempts)
            warnings.append(f"semantics: {name} failed ({e.reason})")
            continue
        res.attempts = attempts + res.attempts
        res.warnings = warnings + ([f"semantics: fell back to {name}"] if warnings else [])
        return res
    raise SemanticsError(f"no provider produced valid semantics (tried {', '.join(chain)})",
                         attempts, warnings)
