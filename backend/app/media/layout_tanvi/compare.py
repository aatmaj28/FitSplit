"""Score a layout against a reference layout of the same video.

Rooms are matched by when the video shows them (seconds), not by position, so layouts with different
origins and orientations can be compared. Then:

  bedrooms       15 x (1 - |bedrooms - reference| / reference)
  rooms          20 x F1 of matched rooms (each reference room matched at most once)
  types          10 x share of matched rooms with the same type
  connections    20 x F1 of door / opening connections between matched rooms
  sizes          20 x (1 - mean area error / 50%) on the reference's MEASURED rooms (Depth Anything 3),
                 the only metric ground truth; other rooms are reported, not scored
  total area     15 x (1 - |total indoor area error| / 50%)

Each part is clipped at 0. The reference used for FitSplit's demo video is Tanvi's hand-checked
apartment1 layout_fused.json (github.com/Tanvi-15/Layout-maker, by Tanvi Deshpande), whose three
bedrooms were measured with Depth Anything 3.
"""
from __future__ import annotations

from typing import Iterable, Optional

from .schema import OUTDOOR, room_area

COMMON = {"living_room": "living", "living": "living", "bedroom": "bedroom", "kitchen": "kitchen", "bathroom": "bathroom",
          "dining_room": "dining", "dining": "dining", "hallway": "hall", "stairs": "hall", "entry": "hall", "foyer": "hall",
          "closet": "closet", "laundry": "other", "porch": "outdoor", "balcony": "outdoor", "office": "other", "other": "other"}
SQFT_M2 = 0.092903


def _seconds(ranges: Iterable[Iterable[float]]) -> set[int]:
    out: set[int] = set()
    for a, b in ranges:
        out |= set(range(int(a), int(b) + 1))
    return out


def rooms_from_tanvi(layout: dict, timeline: Optional[dict]) -> tuple[list[dict], set[frozenset]]:
    """Normalized rooms and connections from one of her layouts (+ its timeline)."""
    segs: dict[str, list] = {}
    for s in (timeline or {}).get("segments", []):
        segs.setdefault(s["room"], []).append(s["t"])
    rooms = []
    for r in layout["rooms"]:
        times = _seconds(segs.get(r["id"], [])) | {int(t) for t in r.get("evidence_s", [])}
        _, _, w, h = r["rect"]
        rooms.append({"id": r["id"], "type": COMMON.get(r["type"], "other"), "area_m2": room_area(r), "dims_m": sorted((w, h)),
                      "times": times, "measured": r.get("dims_source") == "measured", "outdoor": r["type"] in OUTDOOR})
    edges = {frozenset(o["rooms"]) for o in layout.get("openings", [])
             if o["type"] in ("door", "opening") and len(set(o.get("rooms", []))) == 2}
    return rooms, edges


def rooms_from_fitsplit(job: dict, plan: dict) -> tuple[list[dict], set[frozenset]]:
    """Normalized rooms and connections from FitSplit's own layout of a media job."""
    t_of = {f["id"]: f["t"] for f in job["frames"]}
    by_id = {r["id"]: r for r in plan["rooms"]}
    rooms = []
    for r in job["rooms"]:
        pr = by_id.get(r["id"])
        if not pr:
            continue
        times = {int(t_of[f]) for f in r["frames"] if t_of.get(f) is not None}
        dims = r.get("dims") or {}
        rooms.append({"id": r["id"], "type": COMMON.get(r["type"], "other"), "area_m2": pr["area_sqft_final"] * SQFT_M2,
                      "dims_m": sorted((dims.get("w", 0) * 0.3048, dims.get("l", 0) * 0.3048)), "times": times,
                      "measured": False, "outdoor": r["type"] == "balcony"})
    edges = {frozenset((c["a"], c["b"])) for c in job.get("connections", [])}
    return rooms, edges


def match(rooms: list[dict], ref: list[dict]) -> dict[str, str]:
    """engine room id -> reference room id: greedy on time overlap (share of the smaller set), type agreement breaks ties."""
    pairs = []
    for a in rooms:
        for b in ref:
            if not a["times"] or not b["times"]:
                continue
            ov = len(a["times"] & b["times"]) / min(len(a["times"]), len(b["times"]))
            if ov >= 0.3:
                pairs.append((ov + (0.25 if a["type"] == b["type"] else 0.0), a["id"], b["id"]))
    out, used = {}, set()
    for _, a, b in sorted(pairs, reverse=True):
        if a not in out and b not in used:
            out[a] = b
            used.add(b)
    return out


def _f1(p: float, r: float) -> float:
    return 2 * p * r / (p + r) if p + r else 0.0


def score(rooms: list[dict], edges: set[frozenset], ref: list[dict], ref_edges: set[frozenset]) -> dict:
    m = match(rooms, ref)
    by_ref = {r["id"]: r for r in ref}
    by_id = {r["id"]: r for r in rooms}
    beds, ref_beds = sum(r["type"] == "bedroom" for r in rooms), sum(r["type"] == "bedroom" for r in ref)
    recall, precision = len(m) / max(1, len(ref)), len(m) / max(1, len(rooms))
    types = sum(by_id[a]["type"] == by_ref[b]["type"] for a, b in m.items()) / max(1, len(m))
    mapped = {frozenset(m[x] for x in e) for e in edges if all(x in m for x in e) and len({m[x] for x in e}) == 2}
    c_p = len(mapped & ref_edges) / max(1, len(mapped))
    c_r = len(mapped & ref_edges) / max(1, len(ref_edges))
    errs = {b: (by_id[a]["area_m2"] - by_ref[b]["area_m2"]) / by_ref[b]["area_m2"] for a, b in m.items() if by_ref[b]["area_m2"] > 0}
    measured = {b: e for b, e in errs.items() if by_ref[b]["measured"]}
    mean_measured = sum(abs(e) for e in measured.values()) / len(measured) if measured else None
    mean_all = sum(abs(e) for e in errs.values()) / len(errs) if errs else None
    total = sum(r["area_m2"] for r in rooms if not r["outdoor"])
    ref_total = sum(r["area_m2"] for r in ref if not r["outdoor"])
    total_err = (total - ref_total) / ref_total if ref_total else 0.0
    clip = lambda v: max(0.0, v)  # noqa: E731
    parts = {
        "bedrooms": 15 * clip(1 - abs(beds - ref_beds) / max(1, ref_beds)),
        "rooms": 20 * _f1(precision, recall),
        "types": 10 * types,
        "connections": 20 * _f1(c_p, c_r),
        "sizes": 20 * clip(1 - mean_measured / 0.5) if mean_measured is not None else 0.0,
        "total_area": 15 * clip(1 - abs(total_err) / 0.5),
    }
    return {
        "score": round(sum(parts.values()), 1), "parts": {k: round(v, 1) for k, v in parts.items()},
        "rooms": len(rooms), "ref_rooms": len(ref), "bedrooms": beds, "ref_bedrooms": ref_beds,
        "matched": len(m), "match": m, "types_agree": round(types, 2),
        "connections": {"precision": round(c_p, 2), "recall": round(c_r, 2), "found": len(mapped), "ref": len(ref_edges)},
        "measured_room_error_pct": {b: round(100 * e) for b, e in measured.items()},
        "mean_measured_error_pct": None if mean_measured is None else round(100 * mean_measured),
        "mean_area_error_pct_vs_reference": None if mean_all is None else round(100 * mean_all),
        "total_sqft": round(total / SQFT_M2), "ref_total_sqft": round(ref_total / SQFT_M2), "total_error_pct": round(100 * total_err),
        "unmatched_reference_rooms": sorted(set(by_ref) - set(m.values())),
    }
