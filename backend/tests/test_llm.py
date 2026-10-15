"""LLM plumbing: call accounting + Claude cap, text chain backoff / fallback / validation retries."""
from __future__ import annotations

import json

import pytest

from app.llm import text, usage


@pytest.fixture()
def ledger(tmp_path, monkeypatch):
    monkeypatch.setattr(usage, "_cooldown", {})
    monkeypatch.setattr(usage, "LLM_DIR", tmp_path)
    monkeypatch.setattr(usage, "USAGE_PATH", tmp_path / "usage.json")
    monkeypatch.setattr(usage, "CALLS_PATH", tmp_path / "calls.jsonl")
    monkeypatch.setattr(usage, "LOCK_PATH", tmp_path / ".lock")
    monkeypatch.setattr(usage, "CLAUDE_CAP", 2)
    for k in text.KEYS.values():
        monkeypatch.setenv(k, "test-key-not-real")
    return tmp_path


def test_claude_cap_blocks_before_sending(ledger):
    for _ in range(2):
        with usage.track("claude", "m"):
            pass
    with pytest.raises(usage.CapReached):
        with usage.track("claude", "m"):
            raise AssertionError("must not run")
    t = usage.totals()
    assert t["providers"]["claude"]["calls"] == 2 and t["claude_remaining"] == 0
    lines = (ledger / "calls.jsonl").read_text().splitlines()
    assert len(lines) == 2 and all(json.loads(x)["status"] == "ok" for x in lines)


def test_errors_and_tokens_are_counted(ledger):
    with usage.purpose("rent_check"):
        with pytest.raises(RuntimeError):
            with usage.track("groq", "m"):
                raise RuntimeError("boom")
        with usage.track("groq", "m") as meta:
            meta.update({"input_tokens": 10, "output_tokens": 5})
    g = usage.totals()["providers"]["groq"]
    assert (g["calls"], g["ok"], g["errors"], g["input_tokens"], g["output_tokens"]) == (2, 1, 1, 10, 5)
    assert {json.loads(x)["purpose"] for x in (ledger / "calls.jsonl").read_text().splitlines()} == {"rent_check"}


class RateLimit(Exception):
    status_code = 429

    def __init__(self, retry_after):
        super().__init__("429 rate limit")
        self.response = type("R", (), {"headers": {"retry-after": str(retry_after)}})()


def test_429_backs_off_then_succeeds(ledger, monkeypatch):
    calls, waits = [], []

    def groq(*_a, **_k):
        calls.append("groq")
        if len(calls) == 1:
            raise RateLimit(2)
        return '{"ok": true}', {"input_tokens": 1, "output_tokens": 1}

    monkeypatch.setitem(text.CALLS, "groq", groq)
    res = text.complete("s", "u", sleep=waits.append)
    assert res.provider == "groq" and res.value == {"ok": True} and waits == [2.0]


def test_long_retry_after_moves_to_next_provider(ledger, monkeypatch):
    monkeypatch.setitem(text.CALLS, "groq", lambda *a, **k: (_ for _ in ()).throw(RateLimit(3600)))
    monkeypatch.setitem(text.CALLS, "gemini", lambda *a, **k: ('{"who": "gemini"}', {}))
    waits = []
    res = text.complete("s", "u", sleep=waits.append)
    assert res.provider == "gemini" and waits == []


def test_invalid_output_retries_once_then_falls_back(ledger, monkeypatch):
    seen = []

    def groq(system, user, **_k):
        seen.append(user)
        return "not json", {}

    def need_key(v):
        if "x" not in v:
            raise ValueError("missing x")
        return v

    monkeypatch.setitem(text.CALLS, "groq", groq)
    monkeypatch.setitem(text.CALLS, "gemini", lambda *a, **k: ('{"x": 1}', {}))
    res = text.complete("s", "u", parse=need_key)
    assert res.provider == "gemini" and len(seen) == 2 and "not valid" in seen[1]


def test_claude_cap_is_respected_by_text_chain(ledger, monkeypatch):
    monkeypatch.setattr(usage, "CLAUDE_CAP", 0)
    for name in ("groq", "gemini"):
        monkeypatch.setitem(text.CALLS, name, lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))
    monkeypatch.setitem(text.CALLS, "claude", lambda *a, **k: pytest.fail("Claude must not be called over the cap"))
    with pytest.raises(text.TextError) as e:
        text.complete("s", "u")
    assert any(a["status"] == "cap" for a in e.value.attempts)


def test_daily_quota_cools_provider_down(ledger, monkeypatch):
    monkeypatch.setattr(usage, "_cooldown", {})
    groq_calls = []

    def groq(*_a, **_k):
        groq_calls.append(1)
        raise RuntimeError("429 Rate limit reached on tokens per day (TPD)")

    monkeypatch.setitem(text.CALLS, "groq", groq)
    monkeypatch.setitem(text.CALLS, "gemini", lambda *a, **k: ('{"ok": 1}', {}))
    assert text.complete("s", "u", sleep=lambda s: pytest.fail("no backoff for a daily quota")).provider == "gemini"
    assert text.complete("s", "u").provider == "gemini"
    assert len(groq_calls) == 1  # skipped while cooling down
