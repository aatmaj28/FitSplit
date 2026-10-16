"""Tanvi's layout maker inside FitSplit: the adapter on her three example apartments, her fuse step,
the automated Workflow A step (fake providers), the combined engine, the scoring and the engine switch.
Fixtures: backend/tests/fixtures/tanvi_layout_maker/ (her examples, github.com/Tanvi-15/Layout-maker)."""
from __future__ import annotations

import importlib
import json
from pathlib import Path

import pytest
from PIL import Image

from app.media import engines, vision_multi
from app.media.layout_tanvi import adapter, automate, combine, compare, fuse, measure_da3, schema
from app.semantics.providers import ProviderReply

FIX = Path(__file__).parent / "fixtures" / "tanvi_layout_maker"
EXAMPLES = ["apartment1", "apt2", "apt5"]


def load(ex: str, name: str) -> dict:
    return json.loads((FIX / ex / name).read_text())


@pytest.mark.parametrize("ex", EXAMPLES)
@pytest.mark.parametrize("which", ["layout.json", "layout_fused.json"])
def test_adapter_turns_her_layouts_into_parsed_plans(ex, which):
    lay = load(ex, which)
    plan, rects = adapter.to_plan(lay, engine="tanvi", plan_name=ex, timeline=load(ex, "timeline.json"), problems=schema.validate(lay))
    indoor = sum(schema.room_area(r) for r in lay["rooms"] if r["type"] not in schema.OUTDOOR) * 10.7639
    assert plan["unit"]["total_sqft"] == round(indoor)  # her areas, in sq ft
    assert plan["unit"]["beds"] == sum(r["type"] == "bedroom" for r in lay["rooms"]) and len(plan["rooms"]) == len(lay["rooms"]) == len(rects)
    assert plan["layout_source"] == "estimated_from_photos" and plan["layout_engine"] == "tanvi" and plan["credit"] == "Layout engine by Tanvi Deshpande"
    assert plan["scale"]["pixels_per_foot"] == 20 and plan["walls"] and plan["footprint"]
    for r, src in zip(plan["rooms"], lay["rooms"]):
        assert r["area_source"] == "estimated" and len(r["polygon"]) >= 4 and r["printed_dims_text"].startswith("≈ ")
        level, pct = adapter.her_level(src)
        assert (r["dims_confidence"]["confidence"], r["dims_confidence"]["plus_minus_pct"]) == (level, pct)
        if src.get("dims_source") == "measured":
            assert pct == 10 and "Depth Anything 3" in r["dims_confidence"]["reasoning"]
    straight = [o for o in lay["openings"] if min(abs(o["wall"][1][0] - o["wall"][0][0]), abs(o["wall"][1][1] - o["wall"][0][1])) < 0.05]
    assert len(plan["openings"]) == len(straight)  # every door / window on a straight wall becomes a 3D opening


def test_bay_windows_are_drawn_not_cut():
    plan, _ = adapter.to_plan(load("apartment1", "layout_fused.json"), engine="tanvi", plan_name="a1")
    assert len(plan["window_lines"]) == 2  # the two angled sides of the living room's bay
    living = next(r for r in plan["rooms"] if r["id"] == "living")
    assert len(living["polygon"]) > 4 and living["dims_confidence"]["plus_minus_pct"] == 20  # her confidence 0.85


def test_timeline_maps_job_frames_to_her_rooms():
    frames = [{"id": 1, "t": 0.0}, {"id": 2, "t": 17.5}, {"id": 3, "t": 120.0}, {"id": 4, "t": 30.0}]
    got = adapter.room_frames(load("apartment1", "timeline.json"), frames)
    assert got["living"] == [2, 3] and got["bed1"] == [4] and got["outside_front"] == [1]


def test_fuse_keeps_rooms_attached_and_weighs_estimates():
    lay = {"units": "m", "rooms": [{"id": "a", "type": "bedroom", "label": "A", "rect": [0, 0, 3, 4], "confidence": 0.7, "evidence_s": []},
                                   {"id": "b", "type": "bedroom", "label": "B", "rect": [3, 0, 3, 4], "confidence": 0.7, "evidence_s": []}],
           "openings": [{"type": "door", "wall": [[3, 1], [3, 1.8]], "rooms": ["a", "b"]}]}
    out, log = fuse.fuse(lay, {"a": {"ok": True, "dims_m": [4.0, 3.6], "weight": 4.0, "source": "fitsplit"}})
    a, b = out["rooms"]
    assert a["rect"][2] == pytest.approx(3.6, abs=0.05) and a["dims_source"] == "fitsplit"  # axes matched to the estimate
    assert a["rect"][0] + a["rect"][2] == pytest.approx(b["rect"][0])  # still sharing the wall
    assert out["openings"][0]["wall"][0][0] == pytest.approx(b["rect"][0]) and "fitsplit size estimates" in out["source"]
    _, log2 = fuse.fuse(lay, {"a": {"ok": True, "dims_m": [9.0, 9.0]}})
    assert "rejected" in log2[0]  # her accept ratio (0.6-1.6 x the estimate)


def test_parse_answer_cleans_up_and_rejects():
    ans = {"timeline": {"segments": [{"t": [5, 2], "room": "living"}]},
           "layout": {"units": "m", "rooms": [{"id": "living", "type": "Living Room", "label": "L", "rect": [0, 0, 4, 4], "confidence": 0.8, "evidence_s": [2]},
                                              {"id": "x", "type": "garage", "label": "X", "rect": [4, 0, 2, 2], "confidence": 0.3, "evidence_s": []}],
                      "openings": [{"type": "french door", "wall": [[4, 1], [4, 2]], "rooms": ["living", "outside"]}]}}
    out = automate.parse_answer("Here you go: " + json.dumps(ans))
    assert [r["type"] for r in out["layout"]["rooms"]] == ["living_room", "other"] and out["timeline"]["segments"][0]["t"] == [2.0, 5.0]
    assert out["layout"]["openings"][0] == {"type": "opening", "wall": [[4.0, 1.0], [4.0, 2.0]], "rooms": ["living"]} and out["problems"] == []
    with pytest.raises(ValueError):
        automate.parse_answer(json.dumps({"layout": {"rooms": ans["layout"]["rooms"][:1]}}))
    with pytest.raises(ValueError):
        automate.parse_answer(json.dumps({"layout": {"rooms": [{**ans["layout"]["rooms"][0], "rect": [0, 0, -1, 2]}] * 2}}))


def test_prompt_is_hers_and_never_shows_the_demo_apartment():
    p = automate.PROMPT
    assert '"enum":["living_room","bedroom"' in p.replace(" ", "")  # her JSON schema
    assert "doors are about 0.8 m wide" in p and "x across the building" in p
    assert "videos/apt2.MOV" in p  # her example is another apartment ...
    assert "triple-decker" not in p and "apartment1" not in p  # ... never apartment1, the demo video itself
    assert automate.prompt_for("photo numbers") != p and "#16" in automate.prompt_for("photo numbers")


@pytest.fixture()
def keys(monkeypatch):
    monkeypatch.setattr(vision_multi, "provider_settings", lambda: {n: {"model": "m", "api_key": "k", "env_key": "X"} for n in ("claude", "gemini", "groq")})


def photo_job(tmp_path, n=6):
    (tmp_path / "frames").mkdir()
    for i in range(1, n + 1):
        Image.new("RGB", (320, 240), (40 * i % 255, 120, 200)).save(tmp_path / f"frames/f{i:03d}.jpg")
    return {"id": "mj_00000000beef", "inputs": [{"name": f"IMG_{i}.jpg", "kind": "photo"} for i in range(1, n + 1)],
            "frames": [{"id": i, "file": f"frames/f{i:03d}.jpg", "t": None} for i in range(1, n + 1)]}


def test_read_layout_one_call_cached(tmp_path, monkeypatch, keys):
    calls = []
    ans = {"timeline": {"segments": [{"t": [1, 3], "room": "living"}, {"t": [4, 6], "room": "bed1"}]},
           "layout": {"units": "m", "rooms": [{"id": "living", "type": "living_room", "label": "Living", "rect": [0, 0, 4, 4], "confidence": 0.8, "evidence_s": [1]},
                                              {"id": "bed1", "type": "bedroom", "label": "Bed", "rect": [4, 0, 3, 4], "confidence": 0.7, "evidence_s": [4]}], "openings": []}}

    def fake(images, prompt, **kw):
        calls.append((len(images), prompt))
        return ProviderReply(json.dumps(ans), "fake", 0.01)

    monkeypatch.setitem(vision_multi.CALLS, "claude", fake)
    job = photo_job(tmp_path)
    out = automate.read_layout(job, tmp_path)
    assert out["provider"] == "claude" and out["stamps"] == "photo numbers" and out["sheets"] == 1 and len(out["layout"]["rooms"]) == 2
    assert calls[0][0] == 1 and "#16" in calls[0][1]  # one sheet, photo numbers
    automate.read_layout(job, tmp_path)
    assert len(calls) == 1  # cached by the sheet images


def test_combined_engine_fuses_fitsplit_sizes_for_enclosed_rooms(tmp_path, monkeypatch, keys):
    sized = []

    def fake(images, prompt, **kw):
        if "contact sheets" in prompt:
            raise AssertionError("her layout is already on the job")
        sized.append(prompt.split("the ")[1].split(" (")[0])
        return ProviderReply(json.dumps({"width_ft": 9, "length_ft": 11, "confidence": "medium", "plus_minus_pct": 20, "reasoning": "x"}), "fake", 0.01)

    monkeypatch.setitem(vision_multi.CALLS, "claude", fake)
    job = photo_job(tmp_path)
    job.update(rooms=[], tanvi={"layout": {"units": "m", "rooms": [
        {"id": "living", "type": "living_room", "label": "Living", "rect": [0, 0, 4, 4], "confidence": 0.8, "evidence_s": [1]},
        {"id": "bed1", "type": "bedroom", "label": "Bed", "rect": [4, 0, 3, 4], "confidence": 0.7, "evidence_s": [4]}],
        "openings": [{"type": "door", "wall": [[4, 1], [4, 1.8]], "rooms": ["living", "bed1"]}]},
        "timeline": {"segments": [{"t": [1, 3], "room": "living"}, {"t": [4, 6], "room": "bed1"}]}, "problems": []})
    plan = engines.build(job, tmp_path, "combined")
    assert sized == ["Bed"]  # the open living room keeps her estimate; the bedroom gets FitSplit's
    bed = next(r for r in plan["rooms"] if r["id"] == "bed1")
    assert bed["dims_confidence"]["source"] == "fitsplit" and "least-squares" in bed["dims_confidence"]["reasoning"]
    assert bed["area_sqft_final"] == pytest.approx(9 * 11, rel=0.05) and plan["layout_engine"] == "combined"
    assert (tmp_path / "plan/combined.png").is_file() and (tmp_path / "plan/plan.png").is_file()  # the default is also plan.png
    assert set(job["plans"]) == {"combined"} and job["layouts"]["combined"]["rects"]["bed1"]["w"] > 0


def test_da3_measurements_win_over_estimates():
    tv = {"layout": load("apartment1", "layout.json")}
    sizes = {"bed1": {"w": 8, "l": 11, "confidence": "low", "plus_minus_pct": 25}}
    meas = {"bed1": {"ok": True, "dims_m": [2.3, 3.2], "height_m": 2.67}}
    fused, _ = combine.combined_layout(tv, sizes, meas)
    bed1 = next(r for r in fused["rooms"] if r["id"] == "bed1")
    assert bed1["dims_source"] == "measured" and fused["ceiling_height_m"] == 2.67


def test_depth_anything_is_off_by_default(monkeypatch):
    monkeypatch.delenv("DA3_MEASURE", raising=False)
    assert not measure_da3.enabled() and not measure_da3.available()


def test_scores_against_her_reference():
    ref, ref_edges = compare.rooms_from_tanvi(load("apartment1", "layout_fused.json"), load("apartment1", "timeline.json"))
    own, own_edges = compare.rooms_from_tanvi(load("apartment1", "layout.json"), load("apartment1", "timeline.json"))
    res = compare.score(own, own_edges, ref, ref_edges)
    # her hand layout before the fuse: every room and connection right, sizes off on the measured bedrooms
    assert res["score"] == 86.9 and res["parts"]["rooms"] == 20 and res["parts"]["connections"] == 20
    assert res["measured_room_error_pct"] == {"bed1": 13, "bed2": 24, "bed3": 31}
    perfect = compare.score(ref, ref_edges, ref, ref_edges)
    assert perfect["score"] == 100.0


def test_walkthrough_rooms_map_to_her_rooms():
    job = {"frames": [{"id": 1, "t": 17.0}, {"id": 2, "t": 29.5}, {"id": 3, "t": 30.0}],
           "rooms": [{"id": "r1", "frames": [1]}, {"id": "r2", "frames": [2, 3]}],
           "tanvi": {"timeline": load("apartment1", "timeline.json")}}
    assert engines.walk_map(job, "tanvi", {"living": {}, "bed1": {}}) == {"r1": "living", "r2": "bed1"}
    assert engines.walk_map({"rooms": [{"id": "r1"}], "frames": []}, "fitsplit", {"r1": {}}) == {"r1": "r1"}


def test_layout_engine_setting(monkeypatch):
    try:
        monkeypatch.setenv("LAYOUT_ENGINE", "tanvi")
        assert importlib.reload(engines).DEFAULT == "tanvi"
        monkeypatch.setenv("LAYOUT_ENGINE", "nonsense")
        assert importlib.reload(engines).DEFAULT == "combined"
    finally:
        monkeypatch.delenv("LAYOUT_ENGINE", raising=False)
        importlib.reload(engines)
    assert engines.DEFAULT == "combined" and engines.ENGINES == ("combined", "tanvi", "fitsplit")
