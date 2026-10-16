"""Layout engines for listing videos and photos.

  combined   Tanvi's whole-apartment layout with FitSplit's per-room sizes fused in (default)
  tanvi      Tanvi Deshpande's layout maker (github.com/Tanvi-15/Layout-maker), Workflow A automated
  fitsplit   FitSplit's own: room grouping + per-room sizes + placement over the room graph

LAYOUT_ENGINE picks the one a new job builds; the others are built on request (the listing page's
"Layout engine" switch) and kept, so each costs its model calls once. Every engine's plan is stored
in job["plans"][engine] (the parsed plan format) and drawn to plan/<engine>.png / .svg; job["plan"]
is the default engine's. job["layouts"][engine] holds the room rectangles in feet for the
walkthrough minimap and which walkthrough room sits in which of the engine's rooms.

Why combined is the default: docs/DECISIONS.md (Tanvi layout section) and the README's "Layout
engines" section. On the demo video, scored against Tanvi's hand-checked layout of the same
apartment: combined 84.6, tanvi 79.6, fitsplit 64.6 (out of 100).
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Callable

from . import layout as fs_layout
from .layout_tanvi import adapter, automate, combine, measure_da3
from .layout_tanvi.schema import validate

ENGINES = ("combined", "tanvi", "fitsplit")
LABELS = {"combined": "Combined", "tanvi": "Tanvi's", "fitsplit": "FitSplit"}
DEFAULT = os.getenv("LAYOUT_ENGINE", "combined").strip().lower()
if DEFAULT not in ENGINES:
    DEFAULT = "combined"
Progress = Callable[[float, str], None]


def _plan_name(job: dict) -> str:
    return f"media_{job['id'][3:]}"


def ensure_tanvi(job: dict, d: Path, progress: Progress) -> dict:
    if not job.get("tanvi"):
        job["tanvi"] = automate.read_layout(job, d, progress)
    return job["tanvi"]


def walk_map(job: dict, engine: str, rects: dict) -> dict[str, str]:
    """walkthrough room id -> the engine's room that holds most of its frames (by her timeline)."""
    if engine == "fitsplit":
        return {r["id"]: r["id"] for r in job.get("rooms", []) if r["id"] in rects}
    t_of = {f["id"]: f.get("t") for f in job["frames"]}
    segs = (job.get("tanvi") or {}).get("timeline", {}).get("segments", [])
    out = {}
    for r in job.get("rooms", []):
        votes: dict[str, int] = {}
        for f in r["frames"]:
            t = t_of.get(f)
            if t is None:
                continue
            for s in segs:
                if s["t"][0] - 0.25 <= t < s["t"][1] + 1 and s["room"] in rects:
                    votes[s["room"]] = votes.get(s["room"], 0) + 1
        if votes:
            out[r["id"]] = max(votes, key=votes.get)
    return out


def build(job: dict, d: Path, engine: str, progress: Progress = lambda p, m: None) -> dict:
    """Build (or rebuild) one engine's plan for a finished job; stores and draws it."""
    if engine not in ENGINES:
        raise ValueError(f"unknown layout engine {engine!r}")
    if engine == "fitsplit":
        if any("dims" not in r for r in job.get("rooms", [])):
            fs_layout.estimate_sizes(job, d, progress)
        plan, rect_objs = fs_layout.build_plan(job)
        rects = {k: {"x": round(v.x, 2), "y": round(v.y, 2), "w": round(v.w, 2), "h": round(v.h, 2)} for k, v in rect_objs.items()}
    else:
        tv = ensure_tanvi(job, d, progress)
        if engine == "tanvi":
            plan, rects = adapter.to_plan(tv["layout"], engine="tanvi", plan_name=_plan_name(job), timeline=tv["timeline"],
                                          frames=job["frames"], problems=tv.get("problems"))
        else:
            if job.get("tanvi_sizes") is None:
                progress(0.3, "FitSplit's sizes for the enclosed rooms")
                job["tanvi_sizes"] = combine.size_rooms(job, d, tv, progress)
            measurements = None
            video = next((d / "input" / i["name"] for i in job["inputs"] if i.get("kind") == "video"), None)
            if measure_da3.available() and video is not None and video.exists():  # optional, off by default
                progress(0.6, "measuring rooms with Depth Anything 3")
                measurements = measure_da3.measure_all(video, tv["timeline"], d / "da3")
                job["da3_measurements"] = measurements
            fused, log = combine.combined_layout(tv, job["tanvi_sizes"], measurements)
            job["combined_layout"], job["combined_log"] = fused, log
            plan, rects = adapter.to_plan(fused, engine="combined", plan_name=_plan_name(job), timeline=tv["timeline"],
                                          frames=job["frames"], sizes=job["tanvi_sizes"], problems=validate(fused))
    plan["source_image"] = f"plan/{engine}.png"
    (d / "plan").mkdir(exist_ok=True)
    (d / "plan" / f"{engine}.json").write_text(json.dumps(plan, indent=1))
    fs_layout.render_png(plan, d / "plan" / f"{engine}.png")
    fs_layout.render_svg(plan, d / "plan" / f"{engine}.svg")
    job.setdefault("plans", {})[engine] = plan
    job.setdefault("layouts", {})[engine] = {"rects": rects, "walk": walk_map(job, engine, rects)}
    if engine == job.get("layout_engine", DEFAULT):
        job["plan"], job["layout"] = plan, rects
        # the default engine is also plan/plan.* (what jobs built before the engines point to)
        for ext in ("json", "png", "svg"):
            (d / "plan" / f"plan.{ext}").write_bytes((d / "plan" / f"{engine}.{ext}").read_bytes())
    return plan


# ----------------------------------------------------------------------------- pipeline steps

def sizes_step(job: dict, d: Path, progress: Progress) -> str:
    """'Estimating sizes' for the default engine (the others are built on request)."""
    engine = job.setdefault("layout_engine", DEFAULT)
    if engine == "fitsplit":
        return fs_layout.estimate_sizes(job, d, progress)
    tv = ensure_tanvi(job, d, progress)
    detail = f"{len(tv['layout']['rooms'])} rooms read from the whole video (Tanvi's layout maker)"
    if engine == "combined":
        job["tanvi_sizes"] = combine.size_rooms(job, d, tv, progress)
        detail += f"; {len(job['tanvi_sizes'])} enclosed rooms sized from reference objects (FitSplit)"
    return detail


def layout_step(job: dict, d: Path, progress: Progress) -> str:
    engine = job.setdefault("layout_engine", DEFAULT)
    plan = build(job, d, engine, progress)
    return f"{LABELS[engine]} engine: {len(plan['rooms'])} rooms, ≈ {plan['unit']['total_sqft']} sq ft, estimated from photos ±{plan['estimate']['plus_minus_pct']}%"
