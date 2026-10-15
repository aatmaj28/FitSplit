"""AI rent check: input key (shared with the browser), validation that keeps the model away from
the numbers, cache and endpoint behaviour. The vision call is always mocked."""
from __future__ import annotations

import pytest

from app import rentcheck
from app.llm.vision import VisionResult

REQ = {
    "plan": "jvue_3bed", "method": "fair", "include_closets": False, "rent": 4200,
    "rows": [
        {"room_id": "r4", "name": "DREAM", "bedroom_area": 193.06, "private_bath": False, "private_bath_area": 0, "share": 1352, "vs_even": -48},
        {"room_id": "r5", "name": "DREAM", "bedroom_area": 196.08, "private_bath": False, "private_bath_area": 0, "share": 1360, "vs_even": -40},
        {"room_id": "r6", "name": "DREAM", "bedroom_area": 205.0, "private_bath": True, "private_bath_area": 36.9, "share": 1488, "vs_even": 88},
    ],
    "private_portion": 1767.4, "shared_portion": 2432.6, "shared_each": 810.9,
}
# the browser computes the same key (frontend/scripts/check-step3.mjs asserts this exact value)
KEY_STRING = "rc1|jvue_3bed|fair|0|4200|r4:1931:0:0:1352;r5:1961:0:0:1360;r6:2050:1:369:1488"


@pytest.fixture()
def req():
    return rentcheck.RentCheckRequest.model_validate(REQ)


def test_key_is_stable(req):
    assert rentcheck.key_string(req) == KEY_STRING
    assert rentcheck.input_key(req) == "8643cdf0dc9a881d"
    flipped = req.model_copy(update={"include_closets": True})
    assert rentcheck.input_key(flipped) != rentcheck.input_key(req)


def test_prompt_lists_every_bedroom(req):
    p = rentcheck.build_prompt(req, rentcheck._ctx(req))
    assert p.count("- Bedroom ") == 3 and "$1,488" in p and "37 sq ft bathroom counted as private" in p
    assert "3 bed, 2.5 bath, 1,500 sq ft total" in p


def finalize(req, raw):
    return rentcheck.finalize(raw, req, rentcheck._ctx(req), "test", "m")


def test_finalize_cleans_up_model_output(req):
    raw = {
        "checks": [
            {"id": "bedroom_count", "status": "ok", "reason": "Three bedrooms."},
            {"id": "private_bath", "status": "FAIL", "reason": "Bedroom 2 also has a bath."},
            {"id": "made_up", "status": "pass", "reason": "x"},
            {"id": "bedroom_count", "status": "warn", "reason": "duplicate"},
        ],
        "suggestions": [
            {"action": "set_private_bath", "bedroom": 2, "value": True, "reason": "has its own bath"},
            {"action": "set_private_bath", "bedroom": 3, "value": True, "reason": "already on: no-op"},
            {"action": "set_private_bath", "bedroom": 9, "value": True, "reason": "no such bedroom"},
            {"action": "raise_rent", "value": True, "reason": "not an input"},
        ],
        "explanation": "Bedroom 3 pays $88 more than an even $1,400 split because it has its own bathroom.",
    }
    out = finalize(req, raw)
    assert [(c.id, c.status) for c in out.checks] == [("bedroom_count", "pass"), ("private_bath", "warn")]
    assert [(s.room_id, s.value, s.label) for s in out.suggestions] == [("r5", True, "Turn private bath on for Bedroom 2")]
    assert out.verdict == "warn" and out.explanation_source == "ai"


@pytest.mark.parametrize("bad", [
    "Bedroom 3 pays $95 more because of its bathroom.",      # invented dollar amount
    "Bedroom 3 is 230 sq ft, so it pays more.",                # invented area
])
def test_explanation_with_invented_numbers_is_replaced(req, bad):
    out = finalize(req, {"checks": [{"id": "areas", "status": "pass", "reason": "ok"}], "suggestions": [], "explanation": bad})
    assert out.explanation_source == "template" and out.verdict == "ok"
    assert "$1,488" in out.explanation and "$88 more" in out.explanation and "own bathroom" in out.explanation


@pytest.fixture()
def cache_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(rentcheck, "CACHE_DIR", tmp_path)
    return tmp_path


def test_endpoint_calls_vision_once_then_serves_cache(client, cache_dir, monkeypatch):
    calls = []

    def fake_vision(image, mime, prompt, parse, **_k):
        calls.append(prompt)
        assert image[:4] == b"\x89PNG" and "Bedroom 3" in prompt
        raw = parse('{"checks": [{"id": "bedroom_count", "status": "pass", "reason": "3 bedrooms"}], "suggestions": [], '
                    '"explanation": "Bedroom 3 pays $1,488, $88 more, for its own bathroom."}')
        return VisionResult(raw, "gemini", "gemini-test", 0.1)

    monkeypatch.setattr(rentcheck, "vision_json", fake_vision)
    assert client.post("/api/rent-check?cache_only=1", json=REQ).status_code == 404
    first = client.post("/api/rent-check", json=REQ).json()
    second = client.post("/api/rent-check", json=REQ).json()
    assert len(calls) == 1 and first["cached"] is False and second["cached"] is True
    assert first["verdict"] == "ok" and first["key"] == "8643cdf0dc9a881d"
    assert (cache_dir / "8643cdf0dc9a881d.json").exists()


def test_endpoint_rejects_unknown_rooms(client, cache_dir):
    bad = {**REQ, "rows": [{**REQ["rows"][0], "room_id": "r99"}]}
    assert client.post("/api/rent-check", json=bad).status_code == 422
    assert client.post("/api/rent-check", json={**REQ, "plan": "nope"}).status_code == 404


def test_vision_retries_transient_errors_before_falling_back(monkeypatch):
    from app.llm import vision
    from app.semantics.providers import ProviderReply

    calls = []

    def gemini(**kw):
        calls.append("gemini")
        if len(calls) < 3:
            raise RuntimeError("503 UNAVAILABLE: high demand")
        return ProviderReply('{"ok": 1}', "g", 0.1)

    monkeypatch.setitem(vision.PROVIDERS, "gemini", gemini)
    monkeypatch.setitem(vision.PROVIDERS, "claude", lambda **kw: pytest.fail("Claude must not be used for a transient Gemini error"))
    monkeypatch.setattr(vision, "provider_settings", lambda: {n: {"model": "m", "api_key": "k", "env_key": "X"} for n in ("gemini", "claude", "groq")})
    waits = []
    res = vision.vision_json(b"img", "image/png", "p", lambda t: t, sleep=waits.append)
    assert res.provider == "gemini" and calls == ["gemini"] * 3 and waits == [3.0, 8.0]
