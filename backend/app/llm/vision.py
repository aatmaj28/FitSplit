"""One image + prompt -> validated JSON, with the parser's provider order and fallback
(Gemini -> Claude -> Groq): a provider fails on an API error / timeout / Claude cap, or on
invalid output after one retry, and the next one is tried."""
from __future__ import annotations

import contextvars
import json
import time
from dataclasses import dataclass, field
from typing import Callable, Generic, Optional, TypeVar

from pydantic import ValidationError

from ..config import PROVIDER_ORDER, PROVIDER_TIMEOUT_S, provider_settings
from ..semantics.chain import _call_with_timeout, _short
from ..semantics.providers import PROVIDERS
from . import usage

T = TypeVar("T")

RETRY_SUFFIX = "\n\nYour previous answer was not valid ({error}). Reply again with ONLY the JSON object described above."
TRANSIENT_WAITS = (3.0, 8.0)  # 503 "high demand" / short 429: wait and retry the same (free) provider first


def _transient(e: BaseException) -> bool:
    s = str(e)
    if usage.quota_exhausted(e):
        return False
    return any(t in s for t in ("503", "UNAVAILABLE", "overloaded", "529", "429"))


class VisionError(RuntimeError):
    def __init__(self, message: str, attempts: list[dict]):
        super().__init__(message)
        self.attempts = attempts


@dataclass
class VisionResult(Generic[T]):
    value: T
    provider: str
    model: str
    latency_s: float
    attempts: list[dict] = field(default_factory=list)


def vision_json(image: bytes, mime: str, prompt: str, parse: Callable[[str], T], *,
                order: Optional[list[str]] = None, timeout_s: Optional[float] = None,
                sleep: Callable[[float], None] = time.sleep) -> VisionResult[T]:
    settings = provider_settings()
    timeout_s = timeout_s or PROVIDER_TIMEOUT_S
    attempts: list[dict] = []
    for name in order or PROVIDER_ORDER:
        model, api_key = settings[name]["model"], settings[name]["api_key"]
        if not api_key:
            attempts.append({"provider": name, "status": "skipped", "error": f"{settings[name]['env_key']} not set"})
            continue
        if usage.cooling(name):
            attempts.append({"provider": name, "status": "skipped", "error": "quota exhausted earlier, cooling down"})
            continue
        p = prompt
        waits = list(TRANSIENT_WAITS)
        attempt = 0
        while attempt < 2:  # second attempt only for invalid output
            attempt += 1
            t0 = time.monotonic()
            # the provider runs in a worker thread: carry the usage purpose label over
            fn = PROVIDERS[name]
            ctx = contextvars.copy_context()
            try:
                reply = _call_with_timeout(lambda **kw: ctx.run(fn, **kw), timeout_s, image=image, mime=mime, prompt=p,
                                           model=model, api_key=api_key)
            except Exception as e:  # noqa: BLE001 - API error, timeout or cap: next provider
                attempts.append({"provider": name, "model": model, "attempt": attempt, "status": "api_error",
                                 "error": _short(e), "latency_s": round(time.monotonic() - t0, 2)})
                if _transient(e) and waits:
                    sleep(waits.pop(0))
                    attempt -= 1
                    continue
                if usage.quota_exhausted(e):
                    usage.cool_down(name)
                break
            try:
                value = parse(reply.text)
            except (json.JSONDecodeError, ValidationError, ValueError) as e:
                attempts.append({"provider": name, "model": reply.model, "attempt": attempt, "status": "invalid_output",
                                 "error": _short(e), "latency_s": round(reply.latency_s, 2)})
                p = prompt + RETRY_SUFFIX.format(error=_short(e, 200))
                continue
            attempts.append({"provider": name, "model": reply.model, "attempt": attempt, "status": "ok",
                             "latency_s": round(reply.latency_s, 2)})
            return VisionResult(value, name, reply.model, reply.latency_s, attempts)
    raise VisionError("no vision provider produced a valid answer", attempts)
