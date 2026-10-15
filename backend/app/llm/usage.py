"""Counts every provider API call (vision and text) and enforces a hard cap on Claude calls.

State lives on disk so the cap holds across the API server, scripts and restarts:
    data/llm/usage.json   per-provider totals (calls, ok, errors, tokens) + the cap
    data/llm/calls.jsonl  one line per call: time, provider, model, purpose, status, tokens
Nothing about prompts, answers or keys is written.
"""
from __future__ import annotations

import contextlib
import contextvars
import fcntl
import functools
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterator

from ..config import DATA_DIR

LLM_DIR = DATA_DIR / "llm"
USAGE_PATH = LLM_DIR / "usage.json"
CALLS_PATH = LLM_DIR / "calls.jsonl"
LOCK_PATH = LLM_DIR / ".usage.lock"
# hard cap on Claude calls (all of them, since the ledger started): 80 for the overnight run (17 used),
# then "40 more" (57) for the 2026-10-15 fixes, then raised by the user to 150 for that day; for the
# final pre-hackathon changes "max 10 more" on top of the 108 used by then
CLAUDE_CAP = int(os.getenv("CLAUDE_CALL_CAP", "118"))

_purpose: contextvars.ContextVar[str] = contextvars.ContextVar("llm_purpose", default="semantics")


class CapReached(RuntimeError):
    """Claude's call budget is used up; callers treat this like any provider failure."""


# provider -> monotonic time until which it is skipped (quota exhausted); per process
_cooldown: dict[str, float] = {}


def quota_exhausted(e: BaseException) -> bool:
    s = str(e).lower()
    return "exceeded your current quota" in s or "per day" in s or "tokens per day" in s or "requests per day" in s


def cool_down(provider: str, seconds: float = 600) -> None:
    _cooldown[provider] = time.monotonic() + seconds


def cooling(provider: str) -> bool:
    return _cooldown.get(provider, 0) > time.monotonic()


@contextlib.contextmanager
def purpose(name: str) -> Iterator[None]:
    """Label the calls made inside this block (e.g. "rent_check", "roommates")."""
    token = _purpose.set(name)
    try:
        yield
    finally:
        _purpose.reset(token)


_SECRETS = re.compile(r"(org_[A-Za-z0-9]{6,}|gsk_[A-Za-z0-9]{6,}|sk-ant-[A-Za-z0-9_-]{6,}|AIza[0-9A-Za-z_-]{10,})")


def redact(text: str) -> str:
    """Provider errors can echo account identifiers (Groq puts the org id in 429s); never log them."""
    return _SECRETS.sub(lambda m: m.group(1)[:4] + "…", text)


@contextlib.contextmanager
def _locked() -> Iterator[None]:
    LLM_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOCK_PATH, "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def _read() -> dict:
    try:
        return json.loads(USAGE_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"since": datetime.now(timezone.utc).isoformat(timespec="seconds"), "providers": {}}


def totals() -> dict:
    data = _read()
    data["claude_cap"] = CLAUDE_CAP
    data["claude_remaining"] = max(0, CLAUDE_CAP - data["providers"].get("claude", {}).get("calls", 0))
    return data


def claude_remaining() -> int:
    return totals()["claude_remaining"]


def _reserve(provider: str) -> None:
    """Count the call before it is sent (so a crash mid-call still counts against the cap)."""
    with _locked():
        data = _read()
        p = data["providers"].setdefault(provider, {"calls": 0, "ok": 0, "errors": 0, "input_tokens": 0, "output_tokens": 0})
        if provider == "claude" and p["calls"] >= CLAUDE_CAP:
            raise CapReached(f"Claude call cap reached ({CLAUDE_CAP} calls)")
        p["calls"] += 1
        USAGE_PATH.write_text(json.dumps(data, indent=2))


def _finish(provider: str, model: str, ok: bool, latency_s: float, usage: dict | None, error: str | None) -> None:
    with _locked():
        data = _read()
        p = data["providers"].setdefault(provider, {"calls": 0, "ok": 0, "errors": 0, "input_tokens": 0, "output_tokens": 0})
        p["ok" if ok else "errors"] += 1
        for k in ("input_tokens", "output_tokens"):
            p[k] += int((usage or {}).get(k) or 0)
        USAGE_PATH.write_text(json.dumps(data, indent=2))
        line = {"t": datetime.now(timezone.utc).isoformat(timespec="seconds"), "provider": provider, "model": model,
                "purpose": _purpose.get(), "status": "ok" if ok else "error", "latency_s": round(latency_s, 2),
                "input_tokens": (usage or {}).get("input_tokens"), "output_tokens": (usage or {}).get("output_tokens")}
        if error:
            line["error"] = redact(error)[:160]
        with open(CALLS_PATH, "a") as fh:
            fh.write(json.dumps(line) + "\n")


@contextlib.contextmanager
def track(provider: str, model: str) -> Iterator[dict]:
    """Wrap one API request. Raises CapReached (before sending) when Claude's budget is gone.
    The caller may put {"input_tokens", "output_tokens"} into the yielded dict."""
    _reserve(provider)
    meta: dict = {}
    t0 = time.monotonic()
    try:
        yield meta
    except BaseException as e:
        _finish(provider, model, False, time.monotonic() - t0, meta, f"{type(e).__name__}: {e}")
        raise
    _finish(provider, model, True, time.monotonic() - t0, meta, None)


def tracked(provider: str, fn: Callable) -> Callable:
    """Decorate a vision provider function (signature of app.semantics.providers.call_*)."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with track(provider, kwargs.get("model", "?")) as meta:
            reply = fn(*args, **kwargs)
            meta.update(getattr(reply, "usage", None) or {})
            return reply
    return wrapper
