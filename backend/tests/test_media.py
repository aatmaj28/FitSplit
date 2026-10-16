"""Media pipeline: frames from video / photos, tagging + checklist, description guard, job API.
Synthetic inputs only; vision and text calls are faked (conftest blocks the real ones)."""
from __future__ import annotations

import io
import json

import cv2
import numpy as np
import pytest
from PIL import Image

from app.media import describe, frames, jobs, tagging, vision_multi
from app.semantics.providers import ProviderReply


def scene(seed: int, w: int = 640, h: int = 360) -> np.ndarray:
    """A sharp, textured synthetic 'room' (different per seed)."""
    rng = np.random.default_rng(seed)
    img = np.full((h, w, 3), rng.integers(120, 230, 3), np.uint8)
    for _ in range(14):
        x, y = int(rng.integers(0, w - 80)), int(rng.integers(0, h - 60))
        cv2.rectangle(img, (x, y), (x + int(rng.integers(30, 120)), y + int(rng.integers(20, 90))), tuple(int(c) for c in rng.integers(0, 255, 3)), -1)
    for i in range(0, w, 16):
        cv2.line(img, (i, 0), (i, h), (40, 40, 40), 1)
    return img


def make_video(path, fps: int = 10) -> None:
    out = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (640, 360))
    a, b, c = scene(1), scene(2), scene(3)
    for _ in range(2 * fps):  # 2 s standing still: one frame should survive
        out.write(a)
    for _ in range(fps):  # 1 s of motion blur: dropped
        out.write(cv2.GaussianBlur(b, (41, 41), 0))
    for k in range(3 * fps):  # 3 s panning across a new room
        out.write(np.roll(c, k * 9, axis=1))
    out.release()


def test_video_frames_are_sampled_filtered_and_in_walk_order(tmp_path):
    video = tmp_path / "walk.mp4"
    make_video(video)
    kept, stats = frames.extract([video], tmp_path / "job")
    assert stats["sampled"] >= 11 and 3 <= len(kept) < stats["sampled"]
    ts = [f.t for f in kept]
    assert ts == sorted(ts) and ts[0] < 2.0  # the still part is represented once, at the start
    assert not any(1.4 < t < 3.0 for t in ts[1:])  # no blurred frame (2-3 s) and only one frame of the still shot
    assert all(f.width <= 1024 and f.height <= 1024 and (tmp_path / "job" / f.file).is_file() for f in kept)
    assert [f.id for f in kept] == list(range(1, len(kept) + 1))


def test_select_drops_blurry_frames_and_near_duplicates():
    c = lambda i, sharp, h: {"order": i, "sharp": sharp, "hash": h, "path": None, "t": i * 2.0, "source": "v"}  # noqa: E731
    cands = [c(0, 300, 0b1111), c(1, 320, 0b1110), c(2, 20, 0xF0F0F0), c(3, 280, 0xFFFF0000), c(4, 290, 0x0000FFFF)]
    kept = frames.select(cands, video=True)
    assert [k["order"] for k in kept] == [1, 3, 4]  # the sharper of the duplicates, no blur
    assert len(frames.select([c(i, 200, (i * 0x9E3779B97F4A7C15) & (2**64 - 1)) for i in range(80)], video=False, max_frames=50)) == 50


def test_soft_footage_still_covers_the_walk():
    # compressed / tone-mapped HDR video: every frame scores low; a fixed floor kept just one
    c = lambda i, sharp: {"order": i, "sharp": sharp, "hash": (i * 0x9E3779B97F4A7C15) & (2**64 - 1), "path": None, "t": i * 0.5, "source": "v"}  # noqa: E731
    cands = [c(i, 3.0 + (i % 3)) for i in range(40)]  # 20 s at 2 fps, sharpness 3-5
    kept = frames.select(cands, video=True)
    assert len(kept) == 14 and all(k["sharp"] == 5.0 for k in kept[:-1])  # the sharpest of each 1.5 s window (the last holds one frame)
    blank = [c(i, 0.5) for i in range(10)]
    assert len(frames.select(blank, video=True)) == len(blank[:8])  # nothing usable: the sharpest few, not nothing


def test_photos_heic_and_exif_rotation(tmp_path):
    pillow_heif = pytest.importorskip("pillow_heif")
    pillow_heif.register_heif_opener()
    Image.fromarray(scene(5)[:, :, ::-1]).save(tmp_path / "a.heic")
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90 degrees when shown
    Image.fromarray(scene(6)[:, :, ::-1]).save(tmp_path / "b.jpg", exif=exif)
    assert frames.load_photo(tmp_path / "a.heic").size == (640, 360)
    assert frames.load_photo(tmp_path / "b.jpg").size == (360, 640)
    kept, stats = frames.extract([tmp_path / "a.heic", tmp_path / "b.jpg"], tmp_path / "job")
    assert stats == {"sampled": 2, "kept": 2, "videos": 0, "photos": 2} and [f.source for f in kept] == ["a.heic", "b.jpg"]


def fake_tagger(answer_for):
    """A vision call that answers per "Photo N" label (and puts every photo in one room when asked
    to group contact sheets)."""
    calls = []

    def call(images, prompt, **kw):
        calls.append([lbl for lbl, _ in images])
        if images[0][0].startswith("Contact sheet"):
            return ProviderReply(json.dumps({"rooms": [{"id": "a", "type": "living", "frames": list(range(1, 51))}], "connections": []}), "fake", 0.01)
        if "floor size in feet" in prompt:
            return ProviderReply(json.dumps({"width_ft": 12, "length_ft": 15, "confidence": "medium", "plus_minus_pct": 18, "references": ["door"], "reasoning": "Two doors fit."}), "fake", 0.01)
        frames_ = [answer_for(int(lbl.split()[1])) for lbl, _ in images]
        return ProviderReply(json.dumps({"frames": frames_}), "fake", 0.01)

    return call, calls


@pytest.fixture()
def keys(monkeypatch):
    """Every provider looks configured (the calls themselves are faked)."""
    monkeypatch.setattr(vision_multi, "provider_settings", lambda: {n: {"model": "m", "api_key": "k", "env_key": "X"} for n in ("claude", "gemini", "groq")})
    from app.llm import text
    for env in text.KEYS.values():
        monkeypatch.setenv(env, "test")


def answer(n: int) -> dict:
    kitchen = n in (2, 3)
    return {"frame": n, "room_type": "kitchen" if kitchen else "living room" if n == 1 else "bathroom",
            "amenities": ["dishwasher", "stainless_appliances", "made_up_thing"] if n == 2 else ["bathtub"] if n == 4 else [],
            "flooring": "hardwood" if n in (1, 2) else "tile", "wall_color": "#EDE6DA" if n == 1 else "beige",
            "natural_light": "bright", "windows": 2 if n == 1 else 0, "condition": "updated", "objects": ["fridge", "door", "unicorn"] if kitchen else ["door"],
            "caption": f"photo {n}"}


def test_tagging_batches_merges_with_evidence_and_insight(tmp_path, monkeypatch, keys):
    call, calls = fake_tagger(answer)
    monkeypatch.setitem(vision_multi.CALLS, "claude", call)
    fr = []
    for i in range(1, 13):
        Image.fromarray(scene(i)[:, :, ::-1]).save(tmp_path / f"f{i:03d}.jpg")
        fr.append({"id": i, "file": f"f{i:03d}.jpg"})
    tags, providers = tagging.tag_frames(tmp_path, fr)
    assert [len(c) for c in calls] == [10, 2] and providers == {"claude": 2}  # several photos per request
    assert tags[0]["room_type"] == "living" and tags[1]["amenities"] == ["dishwasher", "stainless_appliances"]
    assert tags[0]["wall_color"] == "#ede6da" and tags[2]["wall_color"] is None and tags[1]["objects"] == ["fridge", "door"]
    items = {a["id"]: a for a in tagging.checklist(tags)}
    assert items["dishwasher"]["evidence"] == [2] and items["hardwood_floors"]["evidence"] == [1, 2]
    assert items["bathtub"]["evidence"] == [4] and items["tile_floors"]["confidence"] == 0.95
    ins = tagging.insight(list(items.values()), existing=["hardwood_floors"])
    assert "hardwood_floors" not in ins["new_tags"] and "dishwasher" in ins["filters"]
    assert ins["new_filter_matches"] == sum(1 for i in items.values() if i["filter"] and i["id"] != "hardwood_floors")
    # cached by image hash: running again makes no call
    tagging.tag_frames(tmp_path, fr)
    assert len(calls) == 2


def test_description_never_keeps_made_up_numbers_or_money(monkeypatch, keys):
    from app.llm import text

    bad = lambda *a, **k: (json.dumps({"full": "Bright 2 bed for $2,400 with a 300 sq ft living room." * 2, "short": "Only $2,400!"}), {})  # noqa: E731
    for name in list(text.CALLS):
        monkeypatch.setitem(text.CALLS, name, bad)
    tags = [answer(n) | {"room_type": "kitchen", "amenities": [], "objects": []} for n in (1, 2)]
    tags = [tagging.FrameTag.model_validate(t).model_dump() for t in tags]
    out = describe.describe([{"id": "dishwasher", "label": "Dishwasher", "confidence": 0.8}], {"kitchen": 2}, tags)
    assert out["source"] == "template" and "$" not in out["full"] and "Dishwasher".lower() in out["full"].lower()

    puffed = lambda *a, **k: (json.dumps({"full": "A spacious home with a private balcony and hardwood floors. Come see it.", "short": "Spacious home with a private balcony."}), {})  # noqa: E731
    for name in list(text.CALLS):
        monkeypatch.setitem(text.CALLS, name, puffed)
    assert describe.describe([{"id": "dishwasher", "label": "Dishwasher", "confidence": 0.8}], {"kitchen": 2}, tags)["source"] == "template"

    good = lambda *a, **k: (json.dumps({"full": "A bright home with a dishwasher and hardwood floors. Come see it.", "short": "Bright home with a dishwasher."}), {})  # noqa: E731
    for name in list(text.CALLS):
        monkeypatch.setitem(text.CALLS, name, good)
    out = describe.describe([{"id": "dishwasher", "label": "Dishwasher", "confidence": 0.8}], {"kitchen": 3}, tags)
    assert out["short"] == "Bright home with a dishwasher." and out["source"] != "template"


def test_media_job_endpoint(tmp_path, monkeypatch, keys, client):
    monkeypatch.setattr(jobs, "MEDIA_DIR", tmp_path / "media_jobs")
    monkeypatch.setattr(jobs, "BACKGROUND", False)
    call, _ = fake_tagger(answer)
    monkeypatch.setitem(vision_multi.CALLS, "claude", call)
    from app.llm import text
    for name in list(text.CALLS):
        monkeypatch.setitem(text.CALLS, name, lambda *a, **k: (json.dumps({"full": "A home with a dishwasher and a bathtub, and bright rooms.", "short": "Home with a dishwasher."}), {}))

    def jpg(seed):
        buf = io.BytesIO()
        Image.fromarray(scene(seed)[:, :, ::-1]).save(buf, "JPEG", quality=90)
        return buf.getvalue()

    files = [("files", (f"IMG_{i}.jpg", jpg(i), "image/jpeg")) for i in range(1, 6)]
    r = client.post("/api/media/jobs", files=files, data={"listing_id": "jvue_1bed", "existing_amenities": "hardwood_floors"})
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["status"] == "complete" and job["id"].startswith("mj_") and len(job["frames"]) == 5
    assert [s["status"] for s in job["steps"]] == ["done"] * 6
    assert job["plan"]["layout_source"] == "estimated_from_photos" and job["plan"]["rooms"][0]["area_sqft_final"] == 180
    assert client.get(f"/api/media/jobs/{job['id']}/files/plan/plan.png").status_code == 200
    assert [r["name"] for r in job["rooms"]] == ["Living room"] and job["walkthrough"]["rooms"][0]["photos"][0] == "frames/f001.jpg"
    assert {a["id"] for a in job["amenities"]} >= {"dishwasher", "bathtub"} and job["description"]["short"]
    assert job["insight"]["new_filter_matches"] >= 1
    assert client.get(f"/api/media/jobs/{job['id']}").json()["status"] == "complete"
    assert [(j["id"], j["frames"], j["cover"]) for j in client.get("/api/media/jobs").json()] == [(job["id"], 5, "frames/f001.jpg")]
    assert client.get(f"/api/media/jobs/{job['id']}/files/frames/f001.jpg").status_code == 200
    assert client.get(f"/api/media/jobs/{job['id']}/files/../job.json").status_code == 404
    # same upload again: the stored job comes straight back
    assert client.post("/api/media/jobs", files=files).json()["id"] == job["id"]
    # one video or several photos; known file types only
    assert client.post("/api/media/jobs", files=[("files", ("a.mp4", b"x", "video/mp4")), ("files", ("b.jpg", jpg(9), "image/jpeg"))]).status_code == 422
    assert client.post("/api/media/jobs", files=[("files", ("notes.txt", b"hi", "text/plain"))]).status_code == 415


# ----------------------------------------------------------------------------- rooms + walkthrough

from app.media import walkthrough as wt  # noqa: E402


def tag(n: int, room: str) -> dict:
    return tagging.FrameTag.model_validate({"frame": n, "room_type": room}).model_dump()


def test_walk_order_grouping_merges_blips_and_numbers_rooms():
    seq = ["living", "living", "kitchen", "living", "hallway", "bedroom", "bedroom", "bathroom", "hallway", "bedroom"]
    tags = [tag(i + 1, r) for i, r in enumerate(seq)]
    g = wt.finalize(wt.heuristic(tags), tags)
    assert [(r["name"], r["frames"]) for r in g["rooms"]][:2] == [("Living room", [1, 2, 3, 4]), ("Hallway 1", [5])]
    assert [r["name"] for r in g["rooms"]] == ["Living room", "Hallway 1", "Bedroom 1", "Bathroom", "Hallway 2", "Bedroom 2"]
    assert g["entrance"] == "r1" and len(g["connections"]) == 5


def test_model_grouping_is_cleaned_up_and_connected():
    tags = [tag(i, r) for i, r in enumerate(["living", "living", "kitchen", "kitchen", "living", "bedroom", "bedroom"], 1)]
    raw = wt.GroupOut.model_validate({
        "rooms": [{"id": "a", "type": "living room", "frames": [1, 2, 5, 99]}, {"id": "b", "type": "kitchen", "frames": [3, 4, 2]},
                  {"id": "c", "type": "bedroom", "frames": [6], "entrance": False}],
        "connections": [{"a": "a", "b": "b", "via_frames": [2, 3], "kind": "opening"}, {"a": "b", "b": "zzz"}],
    })
    g = wt.finalize(raw, tags)
    assert [(r["id"], r["type"], r["frames"]) for r in g["rooms"]] == [("r1", "living", [1, 2, 5]), ("r2", "kitchen", [3, 4]), ("r3", "bedroom", [6, 7])]
    pairs = {(c["a"], c["b"]): c["source"] for c in g["connections"]}
    assert pairs == {("r1", "r2"): "model", ("r1", "r3"): "walk order"}  # 5 -> 6 walks from the living room into the bedroom


def test_group_rooms_uses_one_call_on_contact_sheets(tmp_path, monkeypatch, keys):
    calls = []

    def fake(images, prompt, **kw):
        calls.append([lbl for lbl, _ in images])
        return ProviderReply(json.dumps({"rooms": [{"id": "x", "type": "kitchen", "frames": list(range(1, 15))},
                                                   {"id": "y", "type": "bathroom", "frames": list(range(15, 31))}],
                                         "connections": [{"a": "x", "b": "y", "via_frames": [14, 15]}]}), "fake", 0.01)

    monkeypatch.setitem(vision_multi.CALLS, "claude", fake)
    (tmp_path / "frames").mkdir()
    for i in range(1, 31):
        Image.fromarray(scene(i)[:, :, ::-1]).save(tmp_path / f"frames/f{i:03d}.jpg")
    job = {"frames": [{"id": i, "file": f"frames/f{i:03d}.jpg"} for i in range(1, 31)], "tags": [tag(i, "kitchen") for i in range(1, 31)]}
    detail = wt.group_rooms(job, tmp_path, lambda p, d: None)
    assert calls == [["Contact sheet 1: photos 1-24", "Contact sheet 2: photos 25-30"]]
    assert [r["name"] for r in job["rooms"]] == ["Kitchen", "Bathroom"] and "2 rooms" in detail and job["rooms_source"] == "claude"


def wide_scene(w: int = 3200, h: int = 900) -> np.ndarray:
    rng = np.random.default_rng(0)
    img = np.full((h, w, 3), 200, np.uint8)
    for _ in range(900):
        cv2.circle(img, (int(rng.integers(0, w)), int(rng.integers(0, h))), int(rng.integers(6, 40)), tuple(int(c) for c in rng.integers(0, 255, 3)), -1)
    return img


def test_walkthrough_stitches_a_pan_and_falls_back_to_photos(tmp_path):
    big = wide_scene()
    (tmp_path / "frames").mkdir()
    frames = []
    for i, x in enumerate(range(0, 3200 - 1066, 420), 1):  # room 1: a pan across one wall (stitches)
        cv2.imwrite(str(tmp_path / f"frames/f{i:03d}.jpg"), cv2.resize(big[50:850, x:x + 1066], (800, 600)))
        frames.append(i)
    for j in range(2):  # room 2: two unrelated photos (doesn't stitch)
        i = len(frames) + 1
        cv2.imwrite(str(tmp_path / f"frames/f{i:03d}.jpg"), cv2.resize(scene(40 + j), (800, 600)))
        frames.append(i)
    job = {"frames": [{"id": i, "file": f"frames/f{i:03d}.jpg"} for i in frames],
           "rooms": [{"id": "r1", "name": "Living room", "type": "living", "frames": frames[:6]}, {"id": "r2", "name": "Bedroom", "type": "bedroom", "frames": frames[6:]}],
           "connections": [{"a": "r1", "b": "r2", "via": [6, 7], "kind": "door"}], "entrance": "r1"}
    detail = wt.build_walkthrough(job, tmp_path, lambda p, d: None)
    living, bed = job["walkthrough"]["rooms"]
    assert living["pano"] == "pano/r1.jpg" and (tmp_path / "pano/r1.jpg").is_file() and living["pano_size"][0] > 1.5 * 800
    assert bed["pano"] is None and bed["photos"] == ["frames/f007.jpg", "frames/f008.jpg"]
    # the door to the bedroom is where the walker left the living room: its last frame, at the right end
    assert living["hotspots"][0]["to"] == "r2" and living["hotspots"][0]["frame"] == 6 and living["hotspots"][0]["x"] > 0.7
    assert bed["hotspots"][0] == {"to": "r1", "name": "Living room", "frame": 7, "x": None, "photo": 0}
    assert detail.startswith("1 of 2 rooms stitched")
    assert json.loads((tmp_path / "walk/walkthrough.json").read_text())["entrance"] == "r1"


def test_finished_job_resumes_new_steps_without_retagging(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "MEDIA_DIR", tmp_path)
    ran = []
    monkeypatch.setitem(jobs.BUILTIN, "extract", lambda job, d, p: ran.append("extract"))
    monkeypatch.setitem(jobs.BUILTIN, "tag", lambda job, d, p: ran.append("tag"))
    monkeypatch.setitem(jobs.BUILTIN, "rooms", lambda job, d, p: ran.append("rooms") or "2 rooms")
    monkeypatch.delitem(jobs.BUILTIN, "walkthrough")
    f = tmp_path / "in.jpg"
    f.write_bytes(b"photo")
    job = jobs.create([f], background=False)
    assert ran == ["extract", "tag", "rooms"] and job["steps"][5]["status"] == "skipped" and not jobs.upgradable(jobs.load(job["id"]))
    monkeypatch.setitem(jobs.BUILTIN, "walkthrough", lambda job, d, p: ran.append("walkthrough") or "stitched")
    g = tmp_path / "again.jpg"
    g.write_bytes(b"photo")
    again = jobs.create([g], background=False)  # same content: resume, not a new job
    assert again["id"] == job["id"] and ran[3:] == ["walkthrough"] and again["steps"][5]["detail"] == "stitched"
    assert again["status"] == "complete" and [s["status"] for s in again["steps"]][:3] == ["done"] * 3


def test_hotspots_never_overlap():
    assert wt.spread([0.74, 0.74]) == [0.74, 0.86]
    assert wt.spread([0.95, 0.9, 0.5]) == [0.96, 0.84, 0.5]
    xs = wt.spread([0.5] * 9)
    assert sorted(xs) == xs and all(b - a > 0.1 for a, b in zip(xs, xs[1:])) and xs[-1] <= 0.96



# ----------------------------------------------------------------------------- sizes + layout

from app.media import layout as lay  # noqa: E402


def sized(rid: str, rtype: str, w: float, l: float, frames=None) -> dict:
    return {"id": rid, "name": rtype.title(), "type": rtype, "frames": frames or [],
            "dims": {"w": w, "l": l, "confidence": "medium", "plus_minus_pct": 20, "references": [], "reasoning": "", "source": "test"}}


def test_size_answers_are_cleaned():
    ok = lay._clean(lay.SizeOut(width_ft=13, length_ft=11, confidence="High", plus_minus_pct=40), "bedroom")
    assert (ok["w"], ok["l"], ok["confidence"], ok["plus_minus_pct"]) == (11, 13, "high", 15)  # short side first, pct within the level's range
    odd = lay._clean(lay.SizeOut(width_ft=2, length_ft=40, confidence="high"), "bathroom")
    assert (odd["w"], odd["l"], odd["confidence"]) == (4, 14, "low") and "Adjusted" in odd["reasoning"]
    with pytest.raises(ValueError):
        lay.parse_size('{"width_ft": -3, "length_ft": 10}')
    long = "The bay spans about 8 ft. " * 20
    assert lay.trim_sentences(long).endswith("ft.") and len(lay.trim_sentences(long)) <= 320
    assert lay.trim_sentences("word " * 100).endswith("…")


def test_sizes_one_call_per_room_with_the_best_frames(tmp_path, monkeypatch, keys):
    calls = []

    def fake(images, prompt, **kw):
        calls.append((prompt.split("the ")[1].split(" (")[0], [lbl for lbl, _ in images]))
        if "Bathroom" in prompt:
            return ProviderReply("not json", "fake", 0.01)
        return ProviderReply(json.dumps({"width_ft": 10, "length_ft": 12.5, "confidence": "medium", "references": ["door"], "reasoning": "x"}), "fake", 0.01)

    monkeypatch.setitem(vision_multi.CALLS, "claude", fake)
    monkeypatch.setattr(vision_multi, "PROVIDER_ORDER", ["claude"])
    (tmp_path / "frames").mkdir()
    for i in range(1, 11):
        Image.fromarray(scene(i)[:, :, ::-1]).save(tmp_path / f"frames/f{i:03d}.jpg")
    frames = [{"id": i, "file": f"frames/f{i:03d}.jpg", "sharpness": 100 + i} for i in range(1, 11)]
    tags = [tag(i, "bedroom" if i <= 8 else "bathroom") | {"objects": ["door"] if i == 2 else []} for i in range(1, 11)]
    job = {"frames": frames, "tags": tags, "rooms": [{"id": "r1", "name": "Bedroom", "type": "bedroom", "frames": list(range(1, 9))},
                                                       {"id": "r2", "name": "Bathroom", "type": "bathroom", "frames": [9, 10]}]}
    detail = lay.estimate_sizes(job, tmp_path, lambda p, d: None)
    bed, bath = job["rooms"]
    assert [c[0] for c in calls if c[0] == "Bedroom"] == ["Bedroom"] and len(calls[0][1]) == 4 and "Photo 2" in calls[0][1]
    assert (bed["dims"]["w"], bed["dims"]["l"], bed["dims"]["source"]) == (10, 12.5, "claude")
    assert bath["dims"]["source"] == "typical" and bath["dims"]["confidence"] == "low"  # no valid answer: typical size, said so
    assert "2 rooms sized" in detail


def test_layout_places_rooms_against_their_neighbours_without_overlaps():
    rooms = [sized("r1", "living", 12, 16), sized("r2", "kitchen", 9, 11), sized("r3", "hallway", 3.5, 12), sized("r4", "bedroom", 11, 12),
             sized("r5", "bathroom", 5, 8), sized("r6", "bedroom", 10, 11)]
    conns = [{"a": "r1", "b": "r2", "kind": "opening"}, {"a": "r1", "b": "r3"}, {"a": "r3", "b": "r4"}, {"a": "r3", "b": "r5"}, {"a": "r3", "b": "r6"}]
    placed, halls, notes = lay.place(rooms, conns, "r1")
    rects = list(placed.values()) + [h["rect"] for h in halls]
    assert not any(a.overlaps(b) for i, a in enumerate(rects) for b in rects[i + 1:])
    touching = [c for c in conns if (e := lay.shared_edge(placed[c["a"]], placed[c["b"]])) and e[3] - e[2] >= 2.5]
    assert len(touching) + len(halls) >= len(conns) - 1  # every connection gets a door (directly or through a hallway), at worst one doesn't
    inner = lambda r: round((r.w - lay.WALL_FT) * (r.h - lay.WALL_FT))  # noqa: E731 - rectangles are on the wall centerlines
    assert {inner(placed[r["id"]]) for r in rooms} == {192, 99, 42, 132, 40, 110}  # interior sizes kept


def test_layout_keeps_free_walls_for_rooms_still_to_place():
    # a small hub with four big rooms: placed greedily, the first three box in the fourth side;
    # the lookahead keeps a wall free, so every room touches the hub and no hallway is invented
    hub = sized("r1", "entry", 4, 4)
    rooms = [hub] + [sized(f"r{i}", "bedroom", 12, 14) for i in range(2, 6)]
    placed, halls, notes = lay.place(rooms, [{"a": "r1", "b": f"r{i}"} for i in range(2, 6)], "r1")
    rects = list(placed.values()) + [h["rect"] for h in halls]
    assert not any(a.overlaps(b) for i, a in enumerate(rects) for b in rects[i + 1:])
    assert not halls and not notes
    assert all((e := lay.shared_edge(placed["r1"], placed[f"r{i}"])) and e[3] - e[2] >= 2.9 for i in range(2, 6))


def test_hallway_candidates_touch_both_rooms():
    p = lay.Rect(0, 0, 10, 4)
    for r, hall in lay._candidates(p, 8, 10, gap=lay.HALL_FT) + lay._corridors(p, 8, 10, 8.0):
        assert lay.shared_edge(hall, p) and lay.shared_edge(hall, r) and not hall.overlaps(r) and not hall.overlaps(p)
        assert min(hall.w, hall.h) >= 2.9


def test_estimated_plan_uses_the_parsed_plan_format(tmp_path):
    rooms = [sized("r1", "living", 12, 16, [1, 2]), sized("r2", "kitchen", 9, 11, [3]), sized("r3", "bedroom", 11, 12, [4]), sized("r4", "bathroom", 5, 8, [5])]
    job = {"id": "mj_0123456789ab", "rooms": rooms, "entrance": "r1",
           "connections": [{"a": "r1", "b": "r2", "kind": "opening"}, {"a": "r1", "b": "r3", "kind": "door"}, {"a": "r3", "b": "r4", "kind": "door"}],
           "tags": [tag(1, "living") | {"windows": 2}, tag(4, "bedroom") | {"windows": 1}]}
    detail = lay.build_layout(job, tmp_path, lambda p, d: None)
    plan = job["plan"]
    assert plan["layout_source"] == "estimated_from_photos" and plan["scale"]["pixels_per_foot"] == lay.PPF
    assert [r["area_sqft_final"] for r in plan["rooms"]] == [192, 99, 132, 40] and plan["unit"] == {"total_sqft": 463, "beds": 1, "baths": 1, "rent": None}
    assert all(r["area_source"] == "estimated" and r["dims_confidence"]["plus_minus_pct"] == 20 and len(r["polygon"]) == 4 for r in plan["rooms"])
    bed = next(r for r in plan["rooms"] if r["type"] == "bedroom")
    assert bed["has_private_bath"] is True and bed["printed_dims_text"] == "≈ 11' × 12'"
    kinds = sorted(o["kind"] for o in plan["openings"])
    assert kinds.count("door") >= 3 and "opening" in kinds and kinds.count("window") >= 2  # 2 inside doors + the entry, the open kitchen, windows
    assert plan["walls"] and all(len(w["polygon"]) >= 4 for w in plan["walls"]) and plan["footprint"]
    assert "±20%" in detail and (tmp_path / "plan/plan.png").is_file() and "<svg" in (tmp_path / "plan/plan.svg").read_text()
    assert json.loads((tmp_path / "plan/plan.json").read_text())["plan_name"] == "media_0123456789ab"
