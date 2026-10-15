"""Pixels-per-foot estimation.

Preferred: rooms with printed dims (room bbox vs printed width/length, both
orientations, median across rooms with outliers dropped). Fallback: total_sqft
from meta.json vs total enclosed floor area. Fallback 2: manual pixels_per_foot.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np


@dataclass
class RoomDimsSample:
    name: str
    bbox_w_px: float  # robust extents (see room_extent), not the raw bounding box
    bbox_h_px: float
    w_ft: float
    l_ft: float
    raw_bbox: tuple[int, int] = (0, 0)


def room_extent(mask: np.ndarray) -> tuple[float, float, tuple[int, int]]:
    """Room width/height as the median row / column span: the bounding box of the room's main
    rectangle, ignoring door nooks, alcoves and notches that would stretch a plain bbox."""
    m = mask.astype(bool)
    rows = m.sum(axis=1)
    cols = m.sum(axis=0)
    _, _, bw, bh = cv2.boundingRect(m.astype(np.uint8))
    return float(np.median(rows[rows > 0])), float(np.median(cols[cols > 0])), (bw, bh)


@dataclass
class ScaleResult:
    ppf: Optional[float]
    method: Optional[str]  # room_dims | total_sqft | manual | None
    notes: list[str] = field(default_factory=list)
    per_room: list[dict] = field(default_factory=list)


def room_estimate(s: RoomDimsSample) -> dict:
    """Pick the orientation whose x and y scales agree best."""
    options = []
    for wide, tall, orient in ((s.w_ft, s.l_ft, "w->x"), (s.l_ft, s.w_ft, "w->y")):
        sx, sy = s.bbox_w_px / wide, s.bbox_h_px / tall
        mean = (sx + sy) / 2
        options.append({"orientation": orient, "ppf_x": sx, "ppf_y": sy,
                        "inconsistency": abs(sx - sy) / mean, "ppf": (sx * sy) ** 0.5})
    best = min(options, key=lambda o: o["inconsistency"])
    return {"name": s.name, "extent_px": [round(s.bbox_w_px), round(s.bbox_h_px)], "bbox_px": list(s.raw_bbox),
            **{k: (round(v, 3) if isinstance(v, float) else v) for k, v in best.items()}}


def weighted_median(values: list[float], weights: list[float]) -> float:
    order = sorted(range(len(values)), key=lambda i: values[i])
    half, acc = sum(weights) / 2, 0.0
    for i in order:
        acc += weights[i]
        if acc >= half:
            return values[i]
    return values[order[-1]]


def from_room_dims(samples: list[RoomDimsSample], cfg: dict) -> ScaleResult:
    """Median across rooms, weighted by how well each room's region matches its printed
    shape (x and y scales agreeing), with outliers dropped."""
    if not samples:
        return ScaleResult(None, None, ["no rooms with printed dims and a clean region"])
    per_room = [room_estimate(s) for s in samples]
    usable = [r for r in per_room if r["inconsistency"] <= cfg["max_dims_inconsistency"]]
    notes = []
    for r in per_room:
        r["weight"] = round(1.0 / (r["inconsistency"] + cfg["consistency_weight_floor"]), 2)
        if r["inconsistency"] > cfg["max_dims_inconsistency"]:
            r["used"] = False
            notes.append(f"{r['name']}: region shape doesn't match printed dims "
                         f"(x/y scales differ {r['inconsistency']:.0%}), ignored")
    if not usable:
        return ScaleResult(None, None, notes, per_room)
    med = weighted_median([r["ppf"] for r in usable], [r["weight"] for r in usable])
    kept = [r for r in usable if abs(r["ppf"] - med) / med <= cfg["outlier_tolerance"]]
    for r in usable:
        r["used"] = r in kept
        if not r["used"]:
            notes.append(f"{r['name']}: {r['ppf']:.1f} px/ft is >{cfg['outlier_tolerance']:.0%} from the median, ignored")
    if not kept:
        kept = usable
    ppf = weighted_median([r["ppf"] for r in kept], [r["weight"] for r in kept])
    spread = (max(r["ppf"] for r in kept) - min(r["ppf"] for r in kept)) / ppf if len(kept) > 1 else 0.0
    notes.insert(0, f"weighted median of {len(kept)}/{len(per_room)} rooms with printed dims "
                    f"(spread {spread:.1%}; rooms whose region matches the printed shape count more); "
                    f"room size = median row/column span of its region (a bbox that ignores door "
                    f"nooks and alcoves), both orientations tried")
    return ScaleResult(ppf, "room_dims", notes, per_room)


def from_total_sqft(floor_px: float, total_sqft: Optional[float], basis: str) -> ScaleResult:
    if not total_sqft or floor_px <= 0:
        return ScaleResult(None, None, ["no total_sqft in meta.json"])
    ppf = (floor_px / total_sqft) ** 0.5
    return ScaleResult(ppf, "total_sqft", [
        f"sqrt({basis} floor area {floor_px:.0f}px / total_sqft {total_sqft:g}); assumes the listing's "
        f"sq ft is the {'net floor area inside the walls' if basis == 'interior' else 'gross area including walls'}"
    ])
