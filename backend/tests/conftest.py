"""Shared fixtures. Tests never call a real LLM/vision provider: `no_network_llm` (autouse)
replaces every provider entry point with one that fails the test if it is reached."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def no_network_llm(monkeypatch):
    from app.semantics import providers

    def refuse(*_a, **_k):
        raise AssertionError("a test tried to call a real vision provider")

    for name in list(providers.PROVIDERS):
        monkeypatch.setitem(providers.PROVIDERS, name, refuse)
    yield


@pytest.fixture()
def client():
    from app.main import app

    return TestClient(app)
