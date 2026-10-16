"""Media jobs: one video or several photos in, tags / description / rooms / walkthrough / estimated
floor plan out. A job's id is the content hash of its upload, so the same video comes back from disk
instantly (and its model calls are cached too). Work runs in a background thread, one job at a time;
GET /api/media/jobs/{id} reports the current step and progress.

data/media_jobs/<id>/job.json     status, steps and results
data/media_jobs/<id>/input/       the original upload (gitignored)
data/media_jobs/<id>/frames/      the kept frames (1024 px)
data/media_jobs/<id>/pano/        per-room panoramas
data/media_jobs/<id>/walk/        walkthrough.json (rooms, panoramas, hotspots)
data/media_jobs/<id>/plan/        the estimated floor plan: plan.json (parsed-plan format), plan.png, plan.svg
"""
from __future__ import annotations

import hashlib
import json
import shutil
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from ..config import DATA_DIR
from . import describe as describe_mod
from . import frames as frames_mod
from . import layout, tagging, walkthrough

MEDIA_DIR = DATA_DIR / "media_jobs"
PIPELINE_VERSION = "media-1"
MAX_UPLOAD_BYTES = 500 * 1024 * 1024
STEPS = [
    ("extract", "Extracting frames"),
    ("tag", "Tagging photos"),
    ("rooms", "Grouping rooms"),
    ("sizes", "Estimating sizes"),
    ("layout", "Building layout"),
    ("walkthrough", "Stitching walkthrough"),
]
WEIGHTS = {"extract": 0.15, "tag": 0.35, "rooms": 0.1, "sizes": 0.15, "layout": 0.1, "walkthrough": 0.15}

_lock = threading.Lock()          # guards RUNNING
_one_at_a_time = threading.Semaphore(1)
RUNNING: dict[str, dict] = {}
BACKGROUND = True                  # tests run jobs inline
StepFn = Callable[[dict, Path, Callable[[float, str], None]], str]
EXTRA_STEPS: dict[str, StepFn] = {}  # rooms / sizes / layout / walkthrough register here (walkthrough.py, layout.py)


def job_dir(jid: str) -> Path:
    return MEDIA_DIR / jid


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def job_id(hashes: list[str]) -> str:
    return "mj_" + hashlib.sha256(json.dumps([PIPELINE_VERSION, hashes]).encode()).hexdigest()[:12]


def load(jid: str) -> Optional[dict]:
    with _lock:
        if jid in RUNNING:
            return RUNNING[jid]
    try:
        return json.loads((job_dir(jid) / "job.json").read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _save(job: dict) -> None:
    d = job_dir(job["id"])
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "job.json.tmp"
    tmp.write_text(json.dumps(job, indent=2, ensure_ascii=False))
    tmp.replace(d / "job.json")


def create(uploads: list[Path], *, listing_id: Optional[str] = None, existing: Optional[list[str]] = None,
           background: Optional[bool] = None) -> dict:
    """uploads: files already on disk (the API streams them to a temp folder). Moves them into the job."""
    hashes = [file_hash(p) for p in uploads]
    jid = job_id(hashes)
    old = load(jid)
    if old and old["status"] in ("queued", "running", "complete"):
        for p in uploads:
            p.unlink(missing_ok=True)
        return resume(old, background=background) if old["status"] == "complete" and upgradable(old) else old
    d = job_dir(jid)
    (d / "input").mkdir(parents=True, exist_ok=True)
    inputs = []
    for p, h in zip(uploads, hashes):
        dest = d / "input" / p.name
        shutil.move(str(p), dest)
        inputs.append({"name": p.name, "bytes": dest.stat().st_size, "kind": frames_mod.kind_of(p.name), "sha256": h})
    job = {
        "id": jid, "version": PIPELINE_VERSION, "status": "queued", "step": None, "progress": 0.0,
        "steps": [{"id": s, "label": label, "status": "pending", "detail": ""} for s, label in STEPS],
        "listing_id": listing_id, "existing_amenities": existing or [], "inputs": inputs,
        "frames": [], "tags": [], "amenities": [], "rooms_seen": {}, "description": None, "insight": None,
        "rooms": [], "connections": [], "entrance": None, "walkthrough": None, "plan": None, "layout": None,
        "error": None, "created": _now(), "finished": None,
    }
    with _lock:
        RUNNING[jid] = job
    _save(job)
    run = lambda: _run(job)  # noqa: E731
    if BACKGROUND if background is None else background:
        threading.Thread(target=run, name=f"media-{jid}", daemon=True).start()
    else:
        run()
    return job


def upgradable(job: dict) -> bool:
    """A finished job with steps that were skipped (not built yet then) but exist now."""
    return any(s["status"] == "skipped" and (s["id"] in BUILTIN or s["id"] in EXTRA_STEPS) for s in job["steps"])


def resume(job: dict, *, background: Optional[bool] = None) -> dict:
    """Run the steps a job hasn't done (keeps frames, tags and everything else that is done)."""
    with _lock:
        if job["id"] in RUNNING:
            return RUNNING[job["id"]]
        job = {**job, "status": "queued", "error": None, "finished": None}
        job["steps"] = [s if s["status"] == "done" else {**s, "status": "pending", "detail": ""} for s in job["steps"]]
        RUNNING[job["id"]] = job
    _save(job)
    run = lambda: _run(job)  # noqa: E731
    if BACKGROUND if background is None else background:
        threading.Thread(target=run, name=f"media-{job['id']}", daemon=True).start()
    else:
        run()
    return job


def _run(job: dict) -> None:
    d = job_dir(job["id"])
    with _one_at_a_time:
        job["status"] = "running"
        try:
            for i, (sid, _) in enumerate(STEPS):
                step = job["steps"][i]
                if step["status"] == "done":  # resumed job: keep what is done
                    continue
                job["step"], step["status"] = sid, "running"
                done_before = sum(WEIGHTS[s] for s, _ in STEPS[:i])

                def progress(frac: float, detail: str, _step=step, _base=done_before, _w=WEIGHTS[sid]) -> None:
                    _step["detail"] = detail
                    job["progress"] = round(min(0.99, _base + _w * max(0.0, min(1.0, frac))), 3)

                fn = BUILTIN.get(sid) or EXTRA_STEPS.get(sid)
                if fn is None:
                    step["status"], step["detail"] = "skipped", "not available yet"
                    continue
                step["detail"] = fn(job, d, progress) or step["detail"]
                step["status"] = "done"
                job["progress"] = round(done_before + WEIGHTS[sid], 3)
                _save(job)
            job["status"], job["step"], job["progress"], job["finished"] = "complete", None, 1.0, _now()
        except Exception as e:  # noqa: BLE001 - surface any failure to the client; the job can be retried
            job["status"], job["error"] = "error", " ".join(str(e).split())[:400]
            for s in job["steps"]:
                if s["status"] == "running":
                    s["status"] = "error"
            traceback.print_exc()
        finally:
            _save(job)
            with _lock:
                RUNNING.pop(job["id"], None)


# ----------------------------------------------------------------------------- built-in steps

def _extract(job: dict, d: Path, progress) -> str:
    inputs = [d / "input" / i["name"] for i in job["inputs"]]
    frames, stats = frames_mod.extract(inputs, d, progress)
    job["frames"] = [f.to_dict() for f in frames]
    return f"{stats['kept']} sharp, distinct frames kept of {stats['sampled']}"


def _tag(job: dict, d: Path, progress) -> str:
    tags, providers = tagging.tag_frames(d, job["frames"], progress)
    job["tags"] = tags
    job["amenities"] = tagging.checklist(tags)
    job["rooms_seen"] = tagging.rooms_seen(tags)
    job["insight"] = tagging.insight(job["amenities"], job["existing_amenities"])
    progress(0.95, "writing the description")
    job["description"] = describe_mod.describe(job["amenities"], job["rooms_seen"], tags, listing=_listing(job.get("listing_id")))
    return f"{len(tags)} photos tagged, {len(job['amenities'])} amenities found ({', '.join(f'{k}: {v}' for k, v in providers.items())})"


def _listing(listing_id: Optional[str]) -> Optional[dict]:
    if not listing_id:
        return None
    try:
        meta = json.loads((DATA_DIR / "floorplans" / "meta.json").read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    m = meta.get(listing_id) or meta.get(f"{listing_id}.png")
    return {"title": m.get("title") or listing_id.replace("_", " "), "beds": m.get("beds"), "baths": m.get("baths")} if isinstance(m, dict) else None


BUILTIN: dict[str, StepFn] = {"extract": _extract, "tag": _tag, "rooms": walkthrough.group_rooms, "sizes": layout.estimate_sizes,
                               "layout": layout.build_layout, "walkthrough": walkthrough.build_walkthrough}


def list_jobs() -> list[dict]:
    """Finished jobs, newest first: what the upload page offers to reopen."""
    out = []
    for f in MEDIA_DIR.glob("mj_*/job.json"):
        try:
            job = json.loads(f.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if job.get("status") != "complete":
            continue
        names = [i["name"] for i in job.get("inputs", [])]
        out.append({"id": job["id"], "title": job.get("title") or (names[0] if len(names) == 1 else f"{len(names)} photos"),
                    "inputs": ", ".join(names[:3]) + ("…" if len(names) > 3 else ""), "frames": len(job.get("frames", [])),
                    "cover": (job.get("frames") or [{}])[0].get("file"), "created": job.get("created")})
    return sorted(out, key=lambda j: j["created"] or "", reverse=True)


def summary(job: dict) -> dict:
    """What the API returns (everything but the per-frame raw tags' internals is small)."""
    return job
