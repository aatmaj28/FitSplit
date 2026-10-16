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
    c = lambda i, sharp, h: {"order": i, "sharp": sharp, "hash": h, "path": None, "t": i * 0.5, "source": "v"}  # noqa: E731
    cands = [c(0, 300, 0b1111), c(1, 320, 0b1110), c(2, 20, 0xF0F0F0), c(3, 280, 0xFFFF0000), c(4, 290, 0x0000FFFF)]
    kept = frames.select(cands, video=True)
    assert [k["order"] for k in kept] == [1, 3, 4]  # the sharper of the duplicates, no blur
    assert len(frames.select([c(i, 200, (i * 0x9E3779B97F4A7C15) & (2**64 - 1)) for i in range(80)], video=False, max_frames=50)) == 50


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
    """A vision call that answers per "Photo N" label."""
    calls = []

    def call(images, prompt, **kw):
        calls.append([lbl for lbl, _ in images])
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
    assert [s["status"] for s in job["steps"]][:2] == ["done", "done"]
    assert {a["id"] for a in job["amenities"]} >= {"dishwasher", "bathtub"} and job["description"]["short"]
    assert job["insight"]["new_filter_matches"] >= 1
    assert client.get(f"/api/media/jobs/{job['id']}").json()["status"] == "complete"
    assert client.get(f"/api/media/jobs/{job['id']}/files/frames/f001.jpg").status_code == 200
    assert client.get(f"/api/media/jobs/{job['id']}/files/../job.json").status_code == 404
    # same upload again: the stored job comes straight back
    assert client.post("/api/media/jobs", files=files).json()["id"] == job["id"]
    # one video or several photos; known file types only
    assert client.post("/api/media/jobs", files=[("files", ("a.mp4", b"x", "video/mp4")), ("files", ("b.jpg", jpg(9), "image/jpeg"))]).status_code == 422
    assert client.post("/api/media/jobs", files=[("files", ("notes.txt", b"hi", "text/plain"))]).status_code == 415
