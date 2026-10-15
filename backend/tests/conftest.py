"""Shared fixtures. Tests never call a real LLM/vision provider: `no_network_llm` (autouse)
replaces every provider entry point with one that fails the test if it is reached."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def no_network_llm(monkeypatch, tmp_path):
    from app.llm import cache, text, usage
    from app.semantics import providers

    def refuse(*_a, **_k):
        raise AssertionError("a test tried to call a real vision provider")

    for name in list(providers.PROVIDERS):
        monkeypatch.setitem(providers.PROVIDERS, name, refuse)

    # text providers too; the chain would swallow the error, so record it and fail at teardown
    reached: list[str] = []

    def refuse_text(name):
        def call(*_a, **_k):
            reached.append(name)
            raise AssertionError(f"a test tried to call the real {name} text API")
        return call

    for name in list(text.CALLS):
        monkeypatch.setitem(text.CALLS, name, refuse_text(name))
    # never count, log or cache anything in the real data/llm while testing
    monkeypatch.setattr(usage, "LLM_DIR", tmp_path / "llm")
    monkeypatch.setattr(usage, "USAGE_PATH", tmp_path / "llm" / "usage.json")
    monkeypatch.setattr(usage, "CALLS_PATH", tmp_path / "llm" / "calls.jsonl")
    monkeypatch.setattr(usage, "LOCK_PATH", tmp_path / "llm" / ".lock")
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path / "llm" / "cache")
    (tmp_path / "llm").mkdir(exist_ok=True)
    yield
    assert not reached, f"tests reached real text providers: {reached}"


@pytest.fixture()
def client():
    from app.main import app

    return TestClient(app)
