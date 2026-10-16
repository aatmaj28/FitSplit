"""Tanvi's layout.json -> FitSplit's parsed plan JSON.

Her layout (github.com/Tanvi-15/Layout-maker, by Tanvi Deshpande) has rooms as rectangles or
polygons in metres and doors / windows as wall segments. FitSplit's 3D view, furniture fit, rent
split and walkthrough minimap read the parsed plan format: walls, rooms and openings in pixels plus a
scale. This adapter converts one into the other, the same way FitSplit's own estimated plans are
built (media/layout.py):

- metres -> feet -> pixels (20 px/ft), with her axes kept (x across, y back from the street);
- walls are traced from a raster of the indoor rooms' outlines (a 6 in wall centred on each edge),
  with every door, opening and window that sits on a straight wall cut out. A window in an angled
  bay wall has no 3D opening and is drawn in the 2D plan only;
- each room's floor is its outline inset by half a wall, so furniture fits the way it does on parsed
  plans. Its area stays her estimate (shoelace area for polygons);
- every size gets dims_confidence: her estimates from visual cues are medium (±20%) or low
  (±30-40%, by her confidence), Depth Anything 3 measurements are high (±10%), and sizes fused in
  from FitSplit's per-room estimates keep their own ± and reasoning;
- the timeline maps the job's frames to her rooms (room photos, wall colors, floors).
"""
from __future__ import annotations

import math
from typing import Optional

import cv2
import numpy as np

from ..layout import MARGIN_FT, PPF, WALL_FT
from .schema import OUTDOOR, room_area

M2FT = 3.28084
PLAN_TYPE = {"living_room": "living", "bedroom": "bedroom", "kitchen": "kitchen", "bathroom": "bathroom", "dining_room": "dining",
             "hallway": "other", "stairs": "other", "closet": "closet", "laundry": "other", "porch": "balcony", "balcony": "balcony",
             "office": "other", "other": "other"}
MEDIA_TYPE = {"living_room": "living", "dining_room": "dining", "hallway": "hallway", "stairs": "hallway", "porch": "balcony",
              "office": "other", "bedroom": "bedroom", "kitchen": "kitchen", "bathroom": "bathroom", "closet": "closet",
              "laundry": "laundry", "balcony": "balcony", "other": "other"}
CREDIT = {"tanvi": "Layout engine by Tanvi Deshpande", "combined": "Layout engine by Tanvi Deshpande and Aatmaj Salunke"}
METHOD = {
    "tanvi": "Tanvi's layout maker: the whole apartment read from the video's contact sheets; sizes from doors and windows",
    "combined": "Tanvi's whole-apartment layout, with FitSplit's per-room sizes from reference objects fused in (her least-squares fuse)",
}


def her_level(r: dict) -> tuple[str, int]:
    """Her room confidence -> FitSplit's size confidence and ± (her sizes are visual-cue estimates)."""
    if r.get("dims_source") == "measured":
        return "high", 10
    c = float(r.get("confidence", 0.5))
    return ("medium", 20) if c >= 0.8 else ("low", 30) if c >= 0.6 else ("low", 40)


def outline(r: dict) -> list[list[float]]:
    if r.get("polygon"):
        return [list(map(float, p)) for p in r["polygon"]]
    x, y, w, h = r["rect"]
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]


def _inset(poly: np.ndarray, d: float) -> list[list[float]]:
    """The polygon shrunk by d px: exact for rectangles, by erosion otherwise."""
    xs, ys = poly[:, 0], poly[:, 1]
    if len(poly) == 4 and len({round(v, 3) for v in xs}) == 2 and len({round(v, 3) for v in ys}) == 2:
        x0, x1, y0, y1 = xs.min() + d, xs.max() - d, ys.min() + d, ys.max() - d
        return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    pad = int(d) + 4
    ox, oy = math.floor(xs.min()) - pad, math.floor(ys.min()) - pad
    w, h = math.ceil(xs.max()) - ox + pad, math.ceil(ys.max()) - oy + pad
    m = np.zeros((h, w), np.uint8)
    cv2.fillPoly(m, [np.round(poly - [ox, oy]).astype(np.int32)], 255)
    k = int(2 * d) | 1
    m = cv2.erode(m, np.ones((k, k), np.uint8))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs:
        return poly.tolist()
    c = cv2.approxPolyDP(max(cs, key=cv2.contourArea), 1.5, True).reshape(-1, 2).astype(float)
    return (c + [ox, oy]).tolist()


def _centroid(poly: list[list[float]]) -> list[float]:
    m = cv2.moments(np.array(poly, np.float32))
    if m["m00"] == 0:
        return [float(np.mean([p[0] for p in poly])), float(np.mean([p[1] for p in poly]))]
    return [m["m10"] / m["m00"], m["m01"] / m["m00"]]


def _half_ft(v: float) -> str:
    return f"{round(v * 2) / 2:g}"


def room_frames(timeline: Optional[dict], frames: Optional[list[dict]]) -> dict[str, list[int]]:
    """room id -> the job's frame ids whose time falls in one of that room's timeline segments."""
    out: dict[str, list[int]] = {}
    if not timeline or not frames:
        return out
    for seg in timeline.get("segments", []):
        a, b = seg["t"]
        for f in frames:
            t = f.get("t")
            if t is not None and a - 0.25 <= t < b + 1:
                out.setdefault(seg["room"], [])
                if f["id"] not in out[seg["room"]]:
                    out[seg["room"]].append(f["id"])
    return {k: sorted(v) for k, v in out.items()}


def to_plan(layout: dict, *, engine: str, plan_name: str, timeline: Optional[dict] = None, frames: Optional[list[dict]] = None,
            sizes: Optional[dict] = None, problems: Optional[list[str]] = None) -> tuple[dict, dict]:
    """(parsed plan JSON, {room id: rect in feet} for the minimap). `sizes`: room id -> FitSplit's
    dims for rooms whose size was fused in (combined engine)."""
    rooms = layout["rooms"]
    opens = layout.get("openings", [])
    pts_m = [p for r in rooms for p in outline(r)] + [p for o in opens for p in o["wall"]]
    minx, miny = min(p[0] for p in pts_m), min(p[1] for p in pts_m)
    maxx, maxy = max(p[0] for p in pts_m), max(p[1] for p in pts_m)
    ft = lambda v, lo: (v - lo) * M2FT  # noqa: E731
    P = lambda x, y: [(ft(x, minx) + MARGIN_FT) * PPF, (ft(y, miny) + MARGIN_FT) * PPF]  # noqa: E731
    W = int(math.ceil(((maxx - minx) * M2FT + 2 * MARGIN_FT) * PPF))
    H = int(math.ceil(((maxy - miny) * M2FT + 2 * MARGIN_FT) * PPF))
    thick = int(round(WALL_FT * PPF))
    half = WALL_FT * PPF / 2

    # walls: indoor room outlines (outdoor spaces get no walls of their own), openings cut out
    mask = np.zeros((H, W), np.uint8)
    outlines_px = {r["id"]: np.array([P(*p) for p in outline(r)], np.float64) for r in rooms}
    for r in rooms:
        if r["type"] not in OUTDOOR:
            cv2.polylines(mask, [np.round(outlines_px[r["id"]]).astype(np.int32)], True, 255, thick)
    openings, window_lines = [], []
    for o in opens:
        (x1, y1), (x2, y2) = (P(*p) for p in o["wall"])
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy)
        if length < 0.5 * PPF:
            continue
        kind = {"bay_window": "window"}.get(o["type"], o["type"])
        if abs(dy) <= 0.2 * length:  # on a horizontal wall
            axis, y = "h", (y1 + y2) / 2
            xa, xb = sorted((x1, x2))
            rect = [xa, y - half - 3, xb, y + half + 3]
        elif abs(dx) <= 0.2 * length:
            axis, x = "v", (x1 + x2) / 2
            ya, yb = sorted((y1, y2))
            rect = [x - half - 3, ya, x + half + 3, yb]
        else:  # an angled bay wall: no 3D opening; windows are drawn in the 2D plan
            if kind == "window":
                window_lines.append([[x1, y1], [x2, y2]])
            continue
        cv2.rectangle(mask, (round(rect[0]), round(rect[1])), (round(rect[2]), round(rect[3])), 0, -1)
        x0, ya0, x3, yb3 = rect
        openings.append({"id": f"o{len(openings) + 1}", "kind": kind, "axis": axis, "width_ft": round(length / PPF, 2),
                         "polygon": [[x0, ya0], [x3, ya0], [x3, yb3], [x0, yb3]]})
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
    for poly in outlines_px.values():
        cv2.fillPoly(fill, [np.round(poly).astype(np.int32)], 255)
    fp, _ = cv2.findContours(fill, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    footprint = [c.reshape(-1, 2).astype(float).tolist() for c in fp]

    # private baths: a bathroom whose only door is to one bedroom
    joins: dict[str, set[str]] = {}
    for o in opens:
        if o["type"] in ("door", "opening") and len(o.get("rooms", [])) == 2:
            a, b = o["rooms"]
            joins.setdefault(a, set()).add(b)
            joins.setdefault(b, set()).add(a)
    kind_of = {r["id"]: r["type"] for r in rooms}
    ensuite = {next(iter(joins[r["id"]])) for r in rooms if r["type"] == "bathroom" and len(joins.get(r["id"], ())) == 1
               and kind_of.get(next(iter(joins[r["id"]]))) == "bedroom"}

    per_room = room_frames(timeline, frames)
    out_rooms, rects = [], {}
    for r in rooms:
        x, y, w, h = r["rect"]
        wf, hf = w * M2FT, h * M2FT
        area = round(room_area(r) * M2FT * M2FT, 1)
        fused = (sizes or {}).get(r["id"]) if r.get("dims_source") not in (None, "estimated", "measured") else None
        if fused:
            dc = {k: fused.get(k) for k in ("confidence", "plus_minus_pct", "reasoning", "references", "source", "frames")}
            dc["reasoning"] = ((dc.get("reasoning") or "") + " Fused into Tanvi's layout with her least-squares step.").strip()
        else:
            level, pct = her_level(r)
            cue = "measured with Depth Anything 3" if r.get("dims_source") == "measured" else "estimated from doors and windows in the video"
            seen = ", ".join(f"{s:g}s" for s in r.get("evidence_s", [])[:6])
            dc = {"confidence": level, "plus_minus_pct": pct, "references": r.get("features", [])[:6], "source": "tanvi", "frames": [],
                  "reasoning": f"Tanvi's layout maker: {cue}." + (f" Seen at {seen}." if seen else "")}
        inset = _inset(outlines_px[r["id"]], half)
        name = r.get("label") or r["id"]
        out_rooms.append({
            "id": r["id"], "name": name[:40], "type": PLAN_TYPE.get(r["type"], "other"), "media_type": MEDIA_TYPE.get(r["type"], "other"),
            "tanvi_type": r["type"], "label_point": _centroid(inset), "printed_dims_ft": None,
            "printed_dims_text": f"≈ {_half_ft(min(wf, hf))}' × {_half_ft(max(wf, hf))}'",
            "area_sqft": area, "area_sqft_final": area, "area_source": "estimated",
            "has_private_bath": (r["id"] in ensuite) if r["type"] == "bedroom" else None,
            "polygon": inset, "dims_confidence": dc, "frames": per_room.get(r["id"], []),
            "evidence_s": r.get("evidence_s", []), "features": r.get("features", []),
        })
        rects[r["id"]] = {"x": round(ft(x, minx), 2), "y": round(ft(y, miny), 2), "w": round(wf, 2), "h": round(hf, 2)}
    indoor = [r for r, src in zip(out_rooms, rooms) if src["type"] not in OUTDOOR]
    pct = round(sum(r["dims_confidence"]["plus_minus_pct"] * r["area_sqft"] for r in indoor) / max(1.0, sum(r["area_sqft"] for r in indoor)))
    plan = {
        "plan_name": plan_name, "source_image": f"plan/{engine}.png", "image_size": {"w": W, "h": H},
        "semantics_provider": "photos", "semantics_model": None,
        "scale": {"pixels_per_foot": PPF, "method": "estimated_from_photos", "notes": METHOD.get(engine, engine)},
        "walls": walls, "rooms": out_rooms, "footprint": footprint, "openings": openings, "window_lines": window_lines,
        "unit": {"total_sqft": round(sum(r["area_sqft"] for r in indoor)), "beds": sum(1 for r in rooms if r["type"] == "bedroom"),
                 "baths": sum(1 for r in rooms if r["type"] == "bathroom"), "rent": None},
        "warnings": [f"Estimated from photos: room sizes ±{pct}% on average",
                     "Room positions come from reading the whole video, not a survey"] + list(problems or []),
        "layout_source": "estimated_from_photos", "layout_engine": engine, "credit": CREDIT.get(engine, ""),
        "estimate": {"plus_minus_pct": pct, "rooms_sized": sum(1 for r in out_rooms if r["dims_confidence"].get("source") != "tanvi"),
                     "rooms": len(out_rooms), "method": METHOD.get(engine, engine)},
        "notes": layout.get("notes", ""),
    }
    return plan, rects
