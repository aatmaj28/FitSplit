"""Schematic floor-plan layout: JSON format and validation.

Ported from Tanvi Deshpande's layout maker, github.com/Tanvi-15/Layout-maker (v2p/layout.py), kept
as written. Her matplotlib drawing is replaced by FitSplit's own plan drawing (media/layout.py).

A layout is produced by a vision-language model reading the video's contact sheets
(automate.py) or written by hand. Coordinates are metres, x = across the building, y = depth from
the front (street) side, so y grows toward the back.

{
  "units": "m",
  "rooms": [{"id": "living", "type": "living_room", "label": "Living room",
             "rect": [x, y, w, h], "confidence": 0.8, "evidence_s": [16, 120],
             "features": ["bay window", "ceiling fan"],
             "polygon": [[x, y], ...]}],   # optional exact outline (bays, L-shapes, angled
                                           # walls); rect stays its bounding box
  "openings": [{"type": "door|opening|window|bay_window",
                "wall": [[x1, y1], [x2, y2]], "rooms": ["living", "hall"]}],
  "notes": "free text"
}
"""
from __future__ import annotations

ROOM_TYPES = ["living_room", "bedroom", "kitchen", "bathroom", "dining_room", "hallway",
              "stairs", "closet", "laundry", "porch", "balcony", "office", "other"]
OPENING_TYPES = ["door", "opening", "window", "bay_window"]
OUTDOOR = {"porch", "balcony"}

# JSON schema handed to the VLM as its structured-output contract.
SCHEMA = {
    "type": "object",
    "properties": {
        "units": {"type": "string", "enum": ["m"]},
        "rooms": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "type": {"type": "string", "enum": ROOM_TYPES},
                "label": {"type": "string"},
                "rect": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
                "confidence": {"type": "number"},
                "evidence_s": {"type": "array", "items": {"type": "number"}},
                "features": {"type": "array", "items": {"type": "string"}},
                "polygon": {"type": "array", "items": {"type": "array", "items": {"type": "number"}}},
            },
            "required": ["id", "type", "label", "rect", "confidence", "evidence_s"],
        }},
        "openings": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": OPENING_TYPES},
                "wall": {"type": "array", "items": {"type": "array", "items": {"type": "number"}}},
                "rooms": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["type", "wall"],
        }},
        "notes": {"type": "string"},
    },
    "required": ["units", "rooms", "openings"],
}


def validate(layout: dict) -> list[str]:
    """Return human-readable problems (empty list = OK). Overlaps are reported, not fixed."""
    problems = []
    ids = set()
    rooms = layout.get("rooms", [])
    for r in rooms:
        if r["id"] in ids:
            problems.append(f"duplicate room id {r['id']}")
        ids.add(r["id"])
        if r["type"] not in ROOM_TYPES:
            problems.append(f"{r['id']}: unknown type {r['type']}")
        x, y, w, h = r["rect"]
        if w <= 0 or h <= 0:
            problems.append(f"{r['id']}: non-positive size")
        for px, py in r.get("polygon", []):
            if not (x - 0.05 <= px <= x + w + 0.05 and y - 0.05 <= py <= y + h + 0.05):
                problems.append(f"{r['id']}: polygon point ({px}, {py}) outside its rect")
                break
    for i, a in enumerate(rooms):
        for b in rooms[i + 1:]:
            ov = _overlap(a["rect"], b["rect"])
            if ov > 0.05:
                problems.append(f"{a['id']} overlaps {b['id']} by {ov:.2f} m²")
    for o in layout.get("openings", []):
        for rid in o.get("rooms", []):
            if rid not in ids:
                problems.append(f"opening references unknown room {rid}")
    return problems


def _overlap(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    dx = min(ax + aw, bx + bw) - max(ax, bx)
    dy = min(ay + ah, by + bh) - max(ay, by)
    return max(dx, 0) * max(dy, 0)


def summary(layout: dict) -> str:
    lines = []
    indoor = 0.0
    for r in layout["rooms"]:
        _, _, w, h = r["rect"]
        a = room_area(r)
        if r["type"] not in OUTDOOR:
            indoor += a
        lines.append(f"  {r['label']:<28} {r['type']:<12} {w:4.1f} x {h:4.1f} m  "
                     f"({a:5.1f} m²)  conf {r.get('confidence', 0):.1f}  {r.get('dims_source', '')}")
    lines.append(f"  {'Total indoor':<28} {'':<12} {'':>14}  ({indoor:5.1f} m²)")
    return "\n".join(lines)


def room_area(r) -> float:
    """Polygon area (shoelace) if the room has an outline, else rect area."""
    if r.get("polygon"):
        x, y = zip(*r["polygon"])
        return 0.5 * abs(sum(x[i] * y[i - 1] - x[i - 1] * y[i] for i in range(len(x))))
    return r["rect"][2] * r["rect"][3]
