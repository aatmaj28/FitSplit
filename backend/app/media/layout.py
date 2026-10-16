"""Estimated floor plan from photos.

Sizes: one vision call per room with its 3-4 best frames (sharp, with reference objects such as
doors, appliances, fixtures and beds). The model counts how many known-size objects fit along each
wall and returns width, length, a confidence and a +/- percentage. Values outside a sane range for
the room type are pulled into it and marked low confidence; rooms without an answer get a typical
size, marked as such.

Layout: rectangles placed over the room graph (breadth first from the entrance). Each room goes
against a room it connects to, never overlapping, preferring compact layouts that also touch its
other neighbours; when nothing fits, a 3.5 ft hallway bridges the gap. Doors sit on shared walls,
the entry on a free outside wall, windows on outside walls of rooms whose photos show windows.

The result uses the parsed floor plan JSON (walls / rooms / openings in pixels plus a scale), so the
3D viewer, furniture fit and rent split work on it, with "layout_source": "estimated_from_photos" and
per-room "dims_confidence". plan/plan.png (the 2D drawing, also the viewer's 2D overlay) and
plan/plan.svg are rendered from the same geometry.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, Field, field_validator

from . import vision_multi

PPF = 20.0          # pixels per foot in the emitted plan
WALL_FT = 0.5       # wall thickness
MARGIN_FT = 2.0
DOOR_FT = 2.75      # 33 in interior door
HALL_FT = 3.5       # assumed hallway width
MAX_SIZED = 10      # rooms sized by a vision call; the rest get typical sizes
REF_OBJECTS = {"door", "closet door", "fridge", "stove", "oven", "dishwasher", "kitchen counter", "toilet", "bathtub",
               "shower", "bed", "sofa", "dining table", "desk", "washer", "dryer", "window", "radiator"}

# typical (short, long) sides and the sane range per type, in feet
TYPICAL = {"bedroom": (11, 12), "living": (13, 16), "kitchen": (9, 11), "bathroom": (5.5, 8), "dining": (10, 11),
           "hallway": (3.5, 10), "closet": (3, 5), "balcony": (5, 10), "laundry": (5, 6), "entry": (5, 6), "other": (8, 10)}
RANGE = {"bedroom": (7, 22), "living": (8, 32), "kitchen": (5, 22), "bathroom": (4, 14), "dining": (6, 20), "hallway": (2.5, 30),
         "closet": (2, 12), "balcony": (3, 20), "laundry": (3, 12), "entry": (3, 14), "other": (3, 25)}
PCT = {"high": (8, 15), "medium": (15, 25), "low": (25, 45)}
PLAN_TYPE = {"hallway": "other", "entry": "foyer", "laundry": "other"}  # media room type -> viewer RoomType
COLORS = {"bedroom": "#c9d5f7", "bathroom": "#b6e6ee", "kitchen": "#f6d9b8", "living": "#cdebd2", "dining": "#f3e6b5",
          "closet": "#e4ded6", "balcony": "#d9bf98", "foyer": "#eadff0", "other": "#e3e6ea"}

PROMPT = """The photos above show one room of an apartment: the {name} ({type}). Earlier tags saw
these objects in it: {objects}.

Estimate the room's floor size in feet from objects of known size:
- interior door: about 80 in tall and 30-32 in wide; closet doors are often wider
- refrigerator: 30-36 in wide; range / stove: 30 in wide; kitchen counter: 36 in high, 25 in deep
- toilet: about 28-30 in deep; bathtub: 60 in long, 30 in wide; vanity: 18-21 in deep
- beds: twin 39 x 75 in, full 54 x 75, queen 60 x 80, king 76 x 80
- ceilings: usually 8-9 ft; floor tiles are often 12 or 18 in
Work out each wall's length from how many of these fit along it. If a wall isn't visible, use what
is visible and lower your confidence. Estimate this room; don't fall back to a typical size.

Return JSON only:
{{"width_ft": 10.5, "length_ft": 12.0, "confidence": "medium", "plus_minus_pct": 20,
"references": ["door", "queen bed"], "reasoning": "at most 2 sentences", "ceiling_ft": 8.5}}
width_ft is the shorter side; confidence is low, medium or high."""


class SizeOut(BaseModel):
    width_ft: float
    length_ft: float
    confidence: str = "medium"
    plus_minus_pct: Optional[float] = None
    references: list[str] = Field(default_factory=list)
    reasoning: str = ""
    ceiling_ft: Optional[float] = None

    @field_validator("confidence", mode="before")
    @classmethod
    def _conf(cls, v):
        v = str(v or "").strip().lower()
        return v if v in PCT else "medium"

    @field_validator("reasoning", mode="before")
    @classmethod
    def _why(cls, v):
        return trim_sentences(str(v or ""))

    @field_validator("references", mode="before")
    @classmethod
    def _refs(cls, v):
        return [str(x).strip().lower()[:30] for x in (v or [])][:6]


def trim_sentences(text: str, limit: int = 320) -> str:
    """At most `limit` chars, cut after a whole sentence (or a word, with an ellipsis)."""
    t = " ".join(text.split())
    if len(t) <= limit:
        return t
    cut = t[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[:end + 1] if end >= limit // 3 else cut[:cut.rfind(" ")].rstrip(",;:") + "…"


def parse_size(text: str) -> SizeOut:
    out = SizeOut.model_validate(json.loads(text[text.find("{"): text.rfind("}") + 1]))
    if not (0 < out.width_ft < 80 and 0 < out.length_ft < 80):
        raise ValueError("sizes out of range")
    return out


def pick_frames(room: dict, frames: dict[int, dict], tags: dict[int, dict], k: int = 4) -> list[int]:
    """Up to k frames spread over the room's photos, each the best of its part of the walk:
    sharp, with reference objects in view."""
    ids = room["frames"]
    if len(ids) <= k:
        return ids
    sharp = sorted(frames[i]["sharpness"] for i in ids)
    rank = {i: sharp.index(frames[i]["sharpness"]) / max(1, len(ids) - 1) for i in ids}

    def score(i: int) -> float:
        t = tags.get(i, {})
        return rank[i] + 0.6 * len(REF_OBJECTS & set(t.get("objects", []))) + 0.2 * min(2, t.get("windows", 0))

    chunks = np.array_split(np.array(ids), k)
    return [int(max(c, key=score)) for c in chunks if len(c)]


def _clean(size: SizeOut, rtype: str) -> dict:
    lo, hi = RANGE.get(rtype, RANGE["other"])
    w, l = sorted((size.width_ft, size.length_ft))
    conf, note = size.confidence, ""
    cw, cl = min(max(w, lo), hi), min(max(l, lo), hi)
    if rtype == "hallway":
        cw = min(max(w, 2.5), 8)
    if (cw, cl) != (w, l):
        conf, note = "low", f" Adjusted from {w:g} x {l:g} ft to a sane range for a {rtype}."
    p_lo, p_hi = PCT[conf]
    pct = size.plus_minus_pct if size.plus_minus_pct is not None else (p_lo + p_hi) / 2
    return {"w": round(cw, 1), "l": round(cl, 1), "confidence": conf, "plus_minus_pct": round(min(max(pct, p_lo), p_hi)),
            "references": size.references, "reasoning": (size.reasoning + note).strip(), "ceiling_ft": size.ceiling_ft}


def typical(rtype: str, why: str) -> dict:
    w, l = TYPICAL.get(rtype, TYPICAL["other"])
    return {"w": float(w), "l": float(l), "confidence": "low", "plus_minus_pct": 40, "references": [],
            "reasoning": why, "ceiling_ft": None, "source": "typical"}


def estimate_sizes(job: dict, d: Path, progress: Callable[[float, str], None]) -> str:
    rooms = job.get("rooms") or []
    frames = {f["id"]: f for f in job["frames"]}
    tags = {t["frame"]: t for t in job["tags"]}
    levels: dict[str, int] = defaultdict(int)
    for i, r in enumerate(rooms):
        progress(i / max(1, len(rooms)), f"{r['name']}: reading sizes from reference objects")
        if i >= MAX_SIZED:
            r["dims"] = typical(r["type"], f"Typical {r['type']} size; only the first {MAX_SIZED} rooms are measured.")
        else:
            picks = pick_frames(r, frames, tags)
            objects = sorted({o for f in r["frames"] for o in tags.get(f, {}).get("objects", [])}) or ["none tagged"]
            images = [(f"Photo {f}", vision_multi.jpeg(d / frames[f]["file"], side=768, quality=80)) for f in picks]
            prompt = PROMPT.format(name=r["name"], type=r["type"], objects=", ".join(objects))
            try:
                size, provider = vision_multi.vision_multi_json(images, prompt, parse_size, kind="size", max_tokens=1200)
                r["dims"] = {**_clean(size, r["type"]), "source": provider, "frames": picks}
            except RuntimeError as e:
                print(f"[media] sizing {r['name']} fell back to a typical size: {e}")
                r["dims"] = typical(r["type"], f"Typical {r['type']} size; the photo estimate wasn't available.")
        levels[r["dims"]["confidence"]] += 1
    return f"{len(rooms)} rooms sized ({', '.join(f'{n} {k} confidence' for k, n in levels.items())})"


# ----------------------------------------------------------------------------- placement

@dataclass
class Rect:
    x: float
    y: float
    w: float
    h: float

    @property
    def x1(self) -> float:
        return self.x + self.w

    @property
    def y1(self) -> float:
        return self.y + self.h

    def overlaps(self, o: "Rect", eps: float = 0.05) -> bool:
        return self.x < o.x1 - eps and o.x < self.x1 - eps and self.y < o.y1 - eps and o.y < self.y1 - eps


def shared_edge(a: Rect, b: Rect, eps: float = 0.05) -> Optional[tuple[str, float, float, float]]:
    """("v", x, y0, y1) for a shared vertical wall, ("h", y, x0, x1) for a horizontal one."""
    for ax, bx in ((a.x1, b.x), (b.x1, a.x)):
        if abs(ax - bx) < eps:
            lo, hi = max(a.y, b.y), min(a.y1, b.y1)
            if hi - lo > eps:
                return ("v", bx, lo, hi)
    for ay, by in ((a.y1, b.y), (b.y1, a.y)):
        if abs(ay - by) < eps:
            lo, hi = max(a.x, b.x), min(a.x1, b.x1)
            if hi - lo > eps:
                return ("h", by, lo, hi)
    return None


def _bbox(rects: list[Rect]) -> Rect:
    x0, y0 = min(r.x for r in rects), min(r.y for r in rects)
    return Rect(x0, y0, max(r.x1 for r in rects) - x0, max(r.y1 for r in rects) - y0)


def _candidates(p: Rect, w: float, h: float, gap: float = 0.0) -> list[tuple[Rect, Optional[Rect]]]:
    """Rooms of w x h against each side of p (or `gap` away, with the hallway that bridges it)."""
    out = []
    for rw, rh in {(w, h), (h, w)}:
        for side in ("right", "left", "bottom", "top"):
            along_p = p.h if side in ("right", "left") else p.w
            along_r = rh if side in ("right", "left") else rw
            need = min(3.0, along_p, along_r)
            start = p.y if side in ("right", "left") else p.x
            lo, hi = start - along_r + need, start + along_p - need
            offs = sorted({round(v, 2) for v in (start, start + along_p - along_r, start + (along_p - along_r) / 2, lo, hi) if lo - 1e-6 <= v <= hi + 1e-6})
            for o in offs:
                if side == "right":
                    r = Rect(p.x1 + gap, o, rw, rh)
                elif side == "left":
                    r = Rect(p.x - gap - rw, o, rw, rh)
                elif side == "bottom":
                    r = Rect(o, p.y1 + gap, rw, rh)
                else:
                    r = Rect(o, p.y - gap - rh, rw, rh)
                hall = None
                if gap:
                    if side in ("right", "left"):
                        y0, y1 = max(p.y, r.y), min(p.y1, r.y1)
                        hall = Rect(p.x1 if side == "right" else p.x - gap, y0, gap, y1 - y0)
                    else:
                        x0, x1 = max(p.x, r.x), min(p.x1, r.x1)
                        hall = Rect(x0, p.y1 if side == "bottom" else p.y - gap, x1 - x0, gap)
                out.append((r, hall))
    return out


def _corridors(p: Rect, w: float, h: float, length: float) -> list[tuple[Rect, Rect]]:
    """A HALL_FT wide corridor running `length` ft straight out of a side of p, with the room at its
    far end (for rooms boxed in by others)."""
    out = []
    hw = HALL_FT
    for rw, rh in {(w, h), (h, w)}:
        for side in ("right", "left", "bottom", "top"):
            along_p = p.h if side in ("right", "left") else p.w
            if along_p < hw:
                continue
            start = p.y if side in ("right", "left") else p.x
            for c in {start + hw / 2, start + along_p / 2, start + along_p - hw / 2}:
                along_r = rh if side in ("right", "left") else rw
                for o in {c - hw / 2, c + hw / 2 - along_r, c - along_r / 2}:
                    if not (o <= c - hw / 2 + 1e-6 and o + along_r >= c + hw / 2 - 1e-6):
                        continue
                    if side == "right":
                        hall, r = Rect(p.x1, c - hw / 2, length, hw), Rect(p.x1 + length, o, rw, rh)
                    elif side == "left":
                        hall, r = Rect(p.x - length, c - hw / 2, length, hw), Rect(p.x - length - rw, o, rw, rh)
                    elif side == "bottom":
                        hall, r = Rect(c - hw / 2, p.y1, hw, length), Rect(o, p.y1 + length, rw, rh)
                    else:
                        hall, r = Rect(c - hw / 2, p.y - length, hw, length), Rect(o, p.y - length - rh, rw, rh)
                    out.append((r, hall))
    return out


def _stranded(r: Rect, pending: list[str], size: dict[str, tuple[float, float]], obstacles: list[Rect]) -> int:
    """How many of a room's unplaced neighbours would have no free spot against it (one-level
    lookahead: a hub boxed in by its first neighbours strands the rest)."""
    out = 0
    taken: list[Rect] = []
    for n in pending:
        w, h = size[n]
        spot = next((c for c, _ in _candidates(r, w, h) if not any(c.overlaps(o) for o in obstacles + taken)), None)
        if spot is None:
            out += 1
        else:
            taken.append(spot)
    return out


def _near(a: Rect, b: Rect, d: float) -> bool:
    return a.x - d < b.x1 and b.x < a.x1 + d and a.y - d < b.y1 and b.y < a.y1 + d


def place(rooms: list[dict], connections: list[dict], entrance: Optional[str]) -> tuple[dict[str, Rect], list[dict], list[str]]:
    """Room rectangles (feet) on the wall centerlines, assumed hallways added, and notes. Estimated
    sizes are interior sizes, so each rectangle is one wall thickness bigger than its room."""
    size = {r["id"]: (r["dims"]["w"] + WALL_FT, r["dims"]["l"] + WALL_FT) for r in rooms}
    nbrs: dict[str, list[str]] = defaultdict(list)
    for c in connections:
        nbrs[c["a"]].append(c["b"])
        nbrs[c["b"]].append(c["a"])
    start = entrance if entrance in size else rooms[0]["id"]
    order, seen, q = [], {start}, deque([start])
    while q:  # breadth first; bigger, better connected rooms first among siblings
        cur = q.popleft()
        order.append(cur)
        for n in sorted(nbrs[cur], key=lambda n: (-len(nbrs[n]), -size[n][0] * size[n][1])):
            if n not in seen:
                seen.add(n)
                q.append(n)
    order += [r["id"] for r in rooms if r["id"] not in seen]
    placed: dict[str, Rect] = {start: Rect(0, 0, size[start][1], size[start][0])}
    kind = {r["id"]: r["type"] for r in rooms}
    extended: set[str] = set()
    halls: list[dict] = []
    notes: list[str] = []
    for rid in order[1:]:
        w, h = size[rid]
        mine = [n for n in nbrs[rid] if n in placed]
        pending = [n for n in nbrs[rid] if n not in placed and n != rid]  # still to place, and they need a free wall here
        waiting_by = {pid: [n for n in nbrs[pid] if n not in placed and n != rid] for pid in placed}
        waiting_by = {k: v for k, v in waiting_by.items() if v}
        waiting = len(pending) + sum(len(v) for v in waiting_by.values())
        reach = max((max(size[n]) for v in waiting_by.values() for n in v), default=0.0) + max(w, h)
        parents = mine or list(placed)
        obstacles = list(placed.values()) + [hh["rect"] for hh in halls]
        best, best_score = None, math.inf
        for gap in (0.0, HALL_FT, 8.0, 14.0):
            for pid in parents:
                cands = _candidates(placed[pid], w, h, gap) if gap <= HALL_FT else _corridors(placed[pid], w, h, gap)
                for r, hall in cands:
                    if hall is not None and (hall.w < 2.9 and hall.h < 2.9):
                        continue
                    if any(r.overlaps(o) for o in obstacles) or (hall and any(hall.overlaps(o) for o in obstacles)):
                        continue
                    bb_before = _bbox(obstacles)
                    bb = _bbox(obstacles + [r] + ([hall] if hall else []))
                    growth = bb.w * bb.h - bb_before.w * bb_before.h
                    aspect = max(bb.w, bb.h) / max(1.0, min(bb.w, bb.h))
                    touch = sum(1 for n in mine if (e := shared_edge(r, placed[n])) and e[3] - e[2] >= 2.5)
                    edges = {round(v, 1) for o in obstacles for v in (o.x, o.x1, o.y, o.y1)}
                    aligned = sum(1 for v in (r.x, r.x1, r.y, r.y1) if round(v, 1) in edges)
                    s = growth + 30 * max(0.0, aspect - 1.7) - 60 * touch - 2 * aligned + (40 if hall else 0) + (200 if not mine else 0)
                    if s - 400 * waiting < best_score:  # lookahead only when it could still win
                        after = obstacles + [r] + ([hall] if hall else [])
                        stranded = _stranded(r, pending, size, after)
                        for pid, pend in waiting_by.items():  # don't take the free walls rooms placed earlier still need
                            if _near(placed[pid], r, reach):
                                stranded += _stranded(placed[pid], pend, size, after)
                        s += 400 * stranded
                    if s < best_score:
                        best, best_score = (r, hall, pid), s
            if best is not None:
                break
        if best is None:  # boxed in: put it to the right of everything
            bb = _bbox(obstacles)
            best = (Rect(bb.x1 + HALL_FT, bb.y, h, w), None, None)
            notes.append(f"{rid} could not be placed next to a room it connects to")
        r, hall, pid = best
        placed[rid] = r
        if hall is not None:
            host = pid if kind.get(pid) == "hallway" else None
            hr = placed[host] if host else None
            if hr and abs(hall.x - hr.x) < 0.05 and abs(hall.w - hr.w) < 0.05 and (abs(hall.y - hr.y1) < 0.05 or abs(hall.y1 - hr.y) < 0.05):
                placed[host] = Rect(hr.x, min(hr.y, hall.y), hr.w, hr.h + hall.h)  # just a longer hallway
                extended.add(host)
            elif hr and abs(hall.y - hr.y) < 0.05 and abs(hall.h - hr.h) < 0.05 and (abs(hall.x - hr.x1) < 0.05 or abs(hall.x1 - hr.x) < 0.05):
                placed[host] = Rect(min(hr.x, hall.x), hr.y, hr.w + hall.w, hr.h)
                extended.add(host)
            else:
                hid = f"h{len(halls) + 1}"
                halls.append({"id": hid, "rect": hall, "between": (pid, rid)})
                notes.append(f"assumed a hallway between {pid} and {rid}")
    for host in extended:
        notes.append(f"extended {host} to reach the rooms it connects to")
    return placed, halls, notes


# ----------------------------------------------------------------------------- plan JSON + drawing

def _free_segments(r: Rect, others: list[Rect], clear: float = 2.0) -> list[tuple[str, float, float, float]]:
    """Outside wall segments of r: (axis, fixed, lo, hi). A stretch of wall with another room in
    front of it (touching, or within `clear` ft, like a sliver between two rooms) isn't outside."""
    sides = [("h", r.y, r.x, r.x1, -1), ("h", r.y1, r.x, r.x1, 1), ("v", r.x, r.y, r.y1, -1), ("v", r.x1, r.y, r.y1, 1)]
    out = []
    for axis, fixed, lo, hi, out_dir in sides:
        cuts = []
        for o in others:
            if axis == "h":
                face = o.y1 if out_dir < 0 else o.y  # the other room's wall facing this one
                gap = (fixed - face) * -out_dir
                a, b = max(lo, o.x), min(hi, o.x1)
            else:
                face = o.x1 if out_dir < 0 else o.x
                gap = (fixed - face) * -out_dir
                a, b = max(lo, o.y), min(hi, o.y1)
            if -0.05 <= gap <= clear and b - a > 0.05:
                cuts.append((a, b))
        cur = lo
        for a, b in sorted(cuts):
            if a - cur > 0.5:
                out.append((axis, fixed, cur, a))
            cur = max(cur, b)
        if hi - cur > 0.5:
            out.append((axis, fixed, cur, hi))
    return out


def _opening(oid: str, kind: str, axis: str, fixed: float, center: float, width: float) -> dict:
    t = WALL_FT / 2 + 0.15
    if axis == "v":
        x0, x1, y0, y1 = fixed - t, fixed + t, center - width / 2, center + width / 2
    else:
        x0, x1, y0, y1 = center - width / 2, center + width / 2, fixed - t, fixed + t
    return {"id": oid, "kind": kind, "axis": axis, "ft": [x0, y0, x1, y1], "width_ft": round(width, 2)}


def build_plan(job: dict) -> tuple[dict, dict[str, Rect]]:
    rooms = job["rooms"]
    placed, halls, notes = place(rooms, job.get("connections", []), job.get("entrance"))
    all_rects = dict(placed)
    for hh in halls:
        all_rects[hh["id"]] = hh["rect"]
    bb = _bbox(list(all_rects.values()))
    for r in all_rects.values():  # origin at the top-left corner of the unit
        r.x -= bb.x
        r.y -= bb.y
    # doors between connected rooms (through an assumed hallway when one was added)
    links = [(c["a"], c["b"], c.get("kind", "door")) for c in job.get("connections", [])]
    for hh in halls:
        a, b = hh["between"]
        links = [lk for lk in links if {lk[0], lk[1]} != {a, b}] + [(a, hh["id"], "door"), (hh["id"], b, "door")]
    openings, n = [], 0
    for a, b, kind in links:
        e = shared_edge(all_rects[a], all_rects[b])
        if not e or e[3] - e[2] < 2.0:
            continue
        axis, fixed, lo, hi = e
        width = min(max(3.0, hi - lo - 1.0), 8.0) if kind == "opening" else min(DOOR_FT, hi - lo - 0.5)
        n += 1
        openings.append(_opening(f"o{n}", "opening" if kind == "opening" else "door", axis, fixed, (lo + hi) / 2, width))
    # the way in: the entrance room's longest outside wall
    ent = job.get("entrance") or rooms[0]["id"]
    free = sorted(_free_segments(all_rects[ent], [r for k, r in all_rects.items() if k != ent]), key=lambda s: s[3] - s[2], reverse=True)
    used: set[tuple] = set()
    if free and free[0][3] - free[0][2] >= 3.5:
        axis, fixed, lo, hi = free[0]
        n += 1
        openings.append(_opening(f"o{n}", "door", axis, fixed, lo + min(3.0, (hi - lo) / 2), 3.0))
        used.add(free[0])
    # windows where the photos show them
    tags = {t["frame"]: t for t in job.get("tags", [])}
    for r in rooms:
        if r["type"] in ("hallway", "closet", "entry", "laundry"):
            continue
        want = min(2 if r["type"] in ("living", "bedroom") else 1, max([tags.get(f, {}).get("windows", 0) for f in r["frames"]] or [0]))
        segs = [s for s in sorted(_free_segments(all_rects[r["id"]], [o for k, o in all_rects.items() if k != r["id"]]), key=lambda s: s[3] - s[2], reverse=True)
                if s not in used and s[3] - s[2] >= 3.0]
        for k in range(min(want, len(segs) * 2)):
            axis, fixed, lo, hi = segs[k % len(segs)]
            width = 2.0 if r["type"] == "bathroom" else min(3.5, (hi - lo) / 2.5)
            slots = 2 if want > len(segs) else 1
            centre = lo + (hi - lo) * ((k // len(segs)) + 1) / (slots + 1)
            n += 1
            openings.append(_opening(f"o{n}", "window", axis, fixed, centre, width))
    # raster walls: every room outline, openings cut out, traced back to polygons
    W = int(round((bb.w + 2 * MARGIN_FT) * PPF))
    H = int(round((bb.h + 2 * MARGIN_FT) * PPF))
    px = lambda v: (v + MARGIN_FT) * PPF  # noqa: E731
    mask = np.zeros((H, W), np.uint8)
    thick = int(round(WALL_FT * PPF))
    for r in all_rects.values():
        cv2.rectangle(mask, (round(px(r.x)), round(px(r.y))), (round(px(r.x1)), round(px(r.y1))), 255, thick)
    for o in openings:
        x0, y0, x1, y1 = o["ft"]
        cv2.rectangle(mask, (round(px(x0)), round(px(y0))), (round(px(x1)), round(px(y1))), 0, -1)
    contours, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    walls = []
    if hier is not None:
        for i, c in enumerate(contours):
            if hier[0][i][3] != -1 or cv2.contourArea(c) < 4:
                continue
            holes, child = [], hier[0][i][2]
            while child != -1:
                if cv2.contourArea(contours[child]) >= 4:
                    holes.append(contours[child].reshape(-1, 2).astype(float).tolist())
                child = hier[0][child][0]
            walls.append({"id": f"w{len(walls) + 1}", "polygon": c.reshape(-1, 2).astype(float).tolist(), "holes": holes})
    fill = np.zeros((H, W), np.uint8)
    for r in all_rects.values():
        cv2.rectangle(fill, (round(px(r.x)), round(px(r.y))), (round(px(r.x1)), round(px(r.y1))), 255, -1)
    fp, _ = cv2.findContours(fill, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    footprint = [c.reshape(-1, 2).astype(float).tolist() for c in fp]
    # rooms in the viewer's format
    bath_of = {}
    for r in rooms:
        if r["type"] == "bathroom":
            beds = [c["a"] if c["b"] == r["id"] else c["b"] for c in job.get("connections", []) if r["id"] in (c["a"], c["b"])]
            if len(beds) == 1 and next((x for x in rooms if x["id"] == beds[0]), {}).get("type") == "bedroom":
                bath_of[beds[0]] = r["id"]
    out_rooms = []
    for r in rooms + [{"id": hh["id"], "name": "Hallway", "type": "hallway", "dims": {"w": round(min(hh["rect"].w, hh["rect"].h) - WALL_FT, 1), "l": round(max(hh["rect"].w, hh["rect"].h) - WALL_FT, 1),
                       "confidence": "low", "plus_minus_pct": 40, "references": [], "reasoning": "Assumed: no photos of it; it joins two rooms that connect.", "source": "assumed"}, "frames": []} for hh in halls]:
        rc = all_rects[r["id"]]
        d = dict(r["dims"])
        inner = Rect(rc.x + WALL_FT / 2, rc.y + WALL_FT / 2, rc.w - WALL_FT, rc.h - WALL_FT)  # the floor between the walls
        short, long_ = sorted((round(inner.w, 1), round(inner.h, 1)))
        if (short, long_) != tuple(sorted((d["w"], d["l"]))):  # stretched to reach its rooms
            d.update(w=short, l=long_, plus_minus_pct=max(d["plus_minus_pct"], 30), reasoning=(d.get("reasoning", "") + " Length stretched in the layout to reach the rooms it connects.").strip())
        area = round(inner.w * inner.h, 1)
        out_rooms.append({
            "id": r["id"], "name": r["name"], "type": PLAN_TYPE.get(r["type"], r["type"]), "media_type": r["type"],
            "label_point": [px(inner.x + inner.w / 2), px(inner.y + inner.h / 2)],
            "printed_dims_ft": None, "printed_dims_text": f"≈ {d['w']:g}' × {d['l']:g}'",
            "area_sqft": area, "area_sqft_final": area, "area_source": "estimated",
            "has_private_bath": (r["id"] in bath_of) if r["type"] == "bedroom" else None,
            "polygon": [[px(inner.x), px(inner.y)], [px(inner.x1), px(inner.y)], [px(inner.x1), px(inner.y1)], [px(inner.x), px(inner.y1)]],
            "dims_confidence": {k: d.get(k) for k in ("confidence", "plus_minus_pct", "reasoning", "references", "source", "frames")},
            "frames": r.get("frames", []),
        })
    sized = [r for r in out_rooms if r["media_type"] not in ("hallway",)] or out_rooms
    total = sum(r["area_sqft"] for r in out_rooms if r["type"] != "balcony")
    pct = round(sum(r["dims_confidence"]["plus_minus_pct"] * r["area_sqft"] for r in sized) / max(1.0, sum(r["area_sqft"] for r in sized)))
    plan = {
        "plan_name": f"media_{job['id'][3:]}", "source_image": "plan/plan.png",
        "image_size": {"w": W, "h": H},
        "semantics_provider": "photos", "semantics_model": None,
        "scale": {"pixels_per_foot": PPF, "method": "estimated_from_photos", "notes": "Room sizes estimated from reference objects in the photos"},
        "walls": walls, "rooms": out_rooms, "footprint": footprint,
        "openings": [{"id": o["id"], "kind": o["kind"], "axis": o["axis"], "width_ft": o["width_ft"],
                      "polygon": [[px(o["ft"][0]), px(o["ft"][1])], [px(o["ft"][2]), px(o["ft"][1])], [px(o["ft"][2]), px(o["ft"][3])], [px(o["ft"][0]), px(o["ft"][3])]]}
                     for o in openings],
        "unit": {"total_sqft": round(total), "beds": sum(1 for r in rooms if r["type"] == "bedroom"),
                 "baths": sum(1 for r in rooms if r["type"] == "bathroom"), "rent": None},
        "warnings": [f"Estimated from photos: room sizes ±{pct}% on average", "Room positions are schematic (from which rooms connect), not surveyed"] + notes,
        "layout_source": "estimated_from_photos",
        "layout_engine": "fitsplit",
        "credit": "Layout engine by Aatmaj Salunke",
        "estimate": {"plus_minus_pct": pct, "rooms_sized": sum(1 for r in rooms if r["dims"].get("source") not in ("typical", "assumed")),
                     "rooms": len(out_rooms), "method": "reference objects in the photos (doors, appliances, fixtures, beds)"},
    }
    return plan, all_rects


def _font(size: int):
    for name in ("Helvetica.ttc", "Arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def render_png(plan: dict, path: Path, scale: int = 2) -> None:
    """The 2D drawing (also the 3D viewer's 2D overlay, so it matches the plan's pixels exactly)."""
    W, H = plan["image_size"]["w"], plan["image_size"]["h"]
    img = Image.new("RGB", (W * scale, H * scale), "white")
    dr = ImageDraw.Draw(img)
    s = lambda pts: [(x * scale, y * scale) for x, y in pts]  # noqa: E731
    for r in plan["rooms"]:
        dr.polygon(s(r["polygon"]), fill=COLORS.get(r["type"], "#e3e6ea"))
    # walls: outlines and their holes filled even-odd, so rooms inside stay visible
    mask = np.zeros((H * scale, W * scale), np.uint8)
    polys = [np.array(s(w["polygon"]), np.int32) for w in plan["walls"]] + [np.array(s(h), np.int32) for w in plan["walls"] for h in w["holes"]]
    if polys:
        cv2.fillPoly(mask, polys, 255)
    img.paste((51, 65, 85), mask=Image.fromarray(mask))
    for o in plan["openings"]:
        (x0, y0), _, (x1, y1), _ = o["polygon"]
        if o["kind"] == "window":
            dr.rectangle([x0 * scale, y0 * scale, x1 * scale, y1 * scale], fill="#bae6fd", outline="#0284c7", width=scale)
    for (ax, ay), (bx, by) in plan.get("window_lines", []):  # windows in angled walls (bays): 2D only
        dr.line([ax * scale, ay * scale, bx * scale, by * scale], fill="#0284c7", width=4 * scale)
    for r in plan["rooms"]:
        x, y = r["label_point"]
        xs = [p[0] for p in r["polygon"]]
        room_w = (max(xs) - min(xs) - 8) * scale
        size = 13
        while size > 8 and dr.textbbox((0, 0), r["name"], font=_font(size * scale))[2] > room_w:
            size -= 1  # long names in narrow rooms (stairs, passages) shrink to fit
        big, small = _font(size * scale), _font(min(10, size) * scale)
        lines = [(r["name"], big, "#0f172a"), (r["printed_dims_text"], small, "#334155"), (f"±{r['dims_confidence']['plus_minus_pct']}%", small, "#64748b")]
        if room_w < 90 * scale / 2:
            lines = lines[:1]
        hts = [dr.textbbox((0, 0), t, font=f)[3] for t, f, _ in lines]
        cy = y * scale - (sum(hts) + 4 * scale * (len(lines) - 1)) / 2
        for (t, f, col), ht in zip(lines, hts):
            tw = dr.textbbox((0, 0), t, font=f)[2]
            dr.text((x * scale - tw / 2, cy), t, font=f, fill=col)
            cy += ht + 4 * scale
    img.save(path, "PNG", optimize=True)


def render_svg(plan: dict, path: Path) -> None:
    W, H = plan["image_size"]["w"], plan["image_size"]["h"]
    pts = lambda p: " ".join(f"{x:.1f},{y:.1f}" for x, y in p)  # noqa: E731
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="Inter, Helvetica, Arial, sans-serif">',
             f'<rect width="{W}" height="{H}" fill="#ffffff"/>']
    for r in plan["rooms"]:
        parts.append(f'<polygon points="{pts(r["polygon"])}" fill="{COLORS.get(r["type"], "#e3e6ea")}"/>')
    for w in plan["walls"]:
        d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in w["polygon"]) + " Z"
        for h in w["holes"]:
            d += " M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in h) + " Z"
        parts.append(f'<path d="{d}" fill="#334155" fill-rule="evenodd"/>')
    for o in plan["openings"]:
        if o["kind"] == "window":
            parts.append(f'<polygon points="{pts(o["polygon"])}" fill="#bae6fd" stroke="#0284c7" stroke-width="1"/>')
    for (ax, ay), (bx, by) in plan.get("window_lines", []):
        parts.append(f'<line x1="{ax:.1f}" y1="{ay:.1f}" x2="{bx:.1f}" y2="{by:.1f}" stroke="#0284c7" stroke-width="4"/>')
    for r in plan["rooms"]:
        x, y = r["label_point"]
        rw = max(p[0] for p in r["polygon"]) - min(p[0] for p in r["polygon"])
        esc = lambda t: t.replace("&", "&amp;").replace("<", "&lt;")  # noqa: E731
        fs = max(8.0, min(13.0, (rw - 8) / (0.56 * max(1, len(r["name"])))))  # ~0.56 em per character
        if rw < 45:
            parts.append(f'<text x="{x:.1f}" y="{y + 4:.1f}" text-anchor="middle" font-size="{min(11.0, fs):.1f}" font-weight="600" fill="#0f172a">{esc(r["name"])}</text>')
            continue
        parts.append(f'<text x="{x:.1f}" y="{y - 6:.1f}" text-anchor="middle" font-size="{fs:.1f}" font-weight="600" fill="#0f172a">{esc(r["name"])}</text>')
        parts.append(f'<text x="{x:.1f}" y="{y + 9:.1f}" text-anchor="middle" font-size="10.5" fill="#334155">{esc(r["printed_dims_text"])} · ±{r["dims_confidence"]["plus_minus_pct"]}%</text>')
    parts.append("</svg>")
    path.write_text("\n".join(parts))


def build_layout(job: dict, d: Path, progress: Callable[[float, str], None]) -> str:
    if not job.get("rooms"):
        return "no rooms to lay out"
    for r in job["rooms"]:
        r.setdefault("dims", typical(r["type"], f"Typical {r['type']} size."))
    progress(0.2, "placing rooms by how they connect")
    plan, rects = build_plan(job)
    (d / "plan").mkdir(exist_ok=True)
    (d / "plan" / "plan.json").write_text(json.dumps(plan, indent=1))
    progress(0.7, "drawing the floor plan")
    render_png(plan, d / "plan" / "plan.png")
    render_svg(plan, d / "plan" / "plan.svg")
    job["plan"] = plan
    job["layout"] = {r: {"x": round(v.x, 2), "y": round(v.y, 2), "w": round(v.w, 2), "h": round(v.h, 2)} for r, v in rects.items()}
    est = plan["estimate"]
    return f"{len(plan['rooms'])} rooms, ≈ {plan['unit']['total_sqft']} sq ft, estimated from photos ±{est['plus_minus_pct']}%"
