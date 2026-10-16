"""The combined engine: Tanvi's whole-apartment layout + FitSplit's per-room sizes, fused.

Her layout (Tanvi Deshpande, github.com/Tanvi-15/Layout-maker) gives the rooms, their shapes, where
they sit and every door and window, read from the whole video at one tile per second. FitSplit's
sizing (media/layout.py, Aatmaj Salunke) measures one room at a time against reference objects in
3-4 of its own frames, with a confidence and a ± range. Here each of her rooms gets FitSplit's size
estimate from frames picked out of her timeline, and her fuse step (least squares on shared grid
lines, rooms stay attached) merges them: FitSplit's estimates weigh 2-6 by confidence, her own
estimates 1, Depth Anything 3 measurements 10 (when that optional step ran).
"""
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from .. import layout as fs_layout
from .. import vision_multi
from ..frames import kind_of, sample_video, sharpness
from .adapter import MEDIA_TYPE
from .fuse import fuse

# rooms FitSplit sizes: enclosed rooms, where 3-4 frames show the walls and their reference objects.
# Open living areas and kitchens keep her whole-apartment estimate (a few frames miss walls and bays:
# on the demo video FitSplit's living room dropped the bay); stairs, closets and outdoor spaces too.
SIZED = {"bedroom", "bathroom", "hallway", "office", "laundry"}
WEIGHT = {"high": 6.0, "medium": 4.0, "low": 2.0}
FT2M = 0.3048
PER_ROOM = 4


def pick(cands: list[tuple[float, Path]], segs: list[list[float]], k: int = PER_ROOM) -> list[tuple[float, Path]]:
    """Up to k frames of a room: its timeline seconds split into k even parts, the sharpest of each."""
    inside = [(t, p) for t, p in cands if any(a <= t < b + 1 for a, b in segs)]
    if len(inside) <= k:
        return inside
    out = []
    for chunk in np.array_split(np.arange(len(inside)), k):
        if len(chunk):
            out.append(max((inside[i] for i in chunk), key=lambda tp: sharpness_of(tp[1])))
    return out


def sharpness_of(p: Path) -> float:
    import cv2

    g = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
    return sharpness(g) if g is not None else 0.0


def size_rooms(job: dict, d: Path, tanvi: dict, progress: Callable[[float, str], None] = lambda p, m: None) -> dict[str, dict]:
    """Her room id -> FitSplit's size estimate (layout.estimate_sizes' dims, plus the frames' times)."""
    lay, timeline = tanvi["layout"], tanvi["timeline"]
    segs: dict[str, list[list[float]]] = {}
    objects: dict[str, list[str]] = {}
    for s in timeline.get("segments", []):
        segs.setdefault(s["room"], []).append(s["t"])
        objects.setdefault(s["room"], []).extend(s.get("objects", []))
    rooms = [r for r in lay["rooms"] if r["type"] in SIZED and segs.get(r["id"])]
    video = next((d / "input" / i["name"] for i in job["inputs"] if kind_of(i["name"]) == "video" and (d / "input" / i["name"]).exists()), None)
    tmp = Path(tempfile.mkdtemp())
    try:
        if video is not None:  # her timeline is in seconds of the video: sample it at 2 fps
            cands = [(t, p) for p, t in sample_video(video, tmp / "s")]
        else:  # photos: her stamps are the photo numbers
            cands = [(float(i), d / f["file"]) for i, f in enumerate(job["frames"], 1)]
        out: dict[str, dict] = {}
        for i, r in enumerate(rooms):
            progress(i / max(1, len(rooms)), f"{r['label']}: FitSplit's size from reference objects")
            chosen = pick(cands, segs[r["id"]])
            if not chosen:
                continue
            objs = sorted(set(objects.get(r["id"], []) + r.get("features", [])))[:12] or ["none tagged"]
            images = [(f"Photo {k}", vision_multi.jpeg(p, side=768, quality=80)) for k, (_, p) in enumerate(chosen, 1)]
            mtype = MEDIA_TYPE.get(r["type"], "other")
            prompt = fs_layout.PROMPT.format(name=r["label"], type=mtype, objects=", ".join(objs))
            try:
                size, provider = vision_multi.vision_multi_json(images, prompt, fs_layout.parse_size, kind="size", max_tokens=1200)
            except RuntimeError as e:
                print(f"[media] combined: sizing {r['label']} failed, keeping Tanvi's estimate: {e}")
                continue
            dims = fs_layout._clean(size, mtype)
            out[r["id"]] = {**dims, "source": "fitsplit", "provider": provider, "times": [round(t, 1) for t, _ in chosen]}
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def combined_layout(tanvi: dict, sizes: dict[str, dict], measurements: Optional[dict] = None) -> tuple[dict, list[str]]:
    """Her layout with FitSplit's sizes (and Depth Anything 3 measurements, when there are some) fused in."""
    meas = {}
    kinds = {r["id"]: r["type"] for r in tanvi["layout"]["rooms"]}
    for rid, s in sizes.items():
        if kinds.get(rid) not in SIZED:  # sized under an older rule: not fused
            continue
        meas[rid] = {"ok": True, "dims_m": [s["w"] * FT2M, s["l"] * FT2M], "weight": WEIGHT.get(s["confidence"], 2.0),
                     "source": "fitsplit", "height_m": (s.get("ceiling_ft") or 0) * FT2M or None}
    for rid, m in (measurements or {}).items():  # a real measurement beats an estimate
        if m.get("ok"):
            meas[rid] = m
    fused, log = fuse(tanvi["layout"], meas)
    return fused, log
