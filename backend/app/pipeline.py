"""Floor plan parser: image -> wall polygons (for 3D) + labeled room regions + scale.

    preprocess -> vision semantics (cached) -> wall mask -> [gap fills -> room regions ->
    pixels/ft] x N until the scale settles -> balcony railings dropped from 3D walls ->
    JSON (original-image pixel coords) + debug images

All coordinates in the output are original-image pixels; pixels_per_foot too.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Optional

import cv2
import numpy as np

from . import cache
from .config import PARSED_DIR, get_config
from .debug import write_debug_images
from .geometry import extras
from .geometry.gaps import GapFills, find_gap_fills
from .geometry.preprocess import Prepped, preprocess
from .geometry.rooms import Segmentation, enclosed_floor, segment_rooms
from .geometry.scale import RoomDimsSample, ScaleResult, from_room_dims, from_total_sqft, room_extent
from .geometry.walls import WallResult, extract_walls, mask_polygons, rect
from .meta import lookup_meta
from .semantics import Semantics, get_semantics, parse_dims_text
from .semantics.prompt import PROMPT_VERSION

PIPELINE_VERSION = "1.0"
SCALE_USABLE = ("ok", "snapped", "split")  # region statuses that may vote on the room_dims scale (outliers are dropped)


def _r(v: Optional[float], nd: int = 1) -> Optional[float]:
    return None if v is None else round(float(v), nd)


def _to_orig(pts: np.ndarray, s: float) -> list[list[float]]:
    return [[round(float(x) / s, 1), round(float(y) / s, 1)] for x, y in np.asarray(pts).reshape(-1, 2)]


def _semantics(prepped: Prepped, img_hash: str, provider: Optional[str], no_cache: bool,
               prefer: Optional[str] = None) -> tuple[dict, str]:
    payload = None if no_cache else cache.load_semantics(img_hash, provider, prefer)
    if payload is not None:
        return payload, "cache"
    res = get_semantics(prepped.png_bytes(), "image/png", provider=provider)
    payload = {
        "image_hash": img_hash,
        "provider": res.provider,
        "model": res.model,
        "prompt_version": PROMPT_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "latency_s": round(res.latency_s, 2),
        "usage": res.usage,
        "attempts": res.attempts,
        "warnings": res.warnings,
        "raw_text": res.raw_text,
        "semantics": res.semantics.model_dump(),
    }
    cache.save_semantics(img_hash, res.provider, payload)
    return payload, "api"


def _floor_px(seg: Segmentation, balcony: np.ndarray, walls: np.ndarray, basis: str) -> float:
    """Enclosed floor area (px) for the total_sqft scale, balconies excluded."""
    interior = seg.floor & ~balcony
    if basis == "gross":
        building = interior | ((walls > 0) & (cv2.dilate(interior.astype(np.uint8), rect(5)) > 0))
        return float(building.sum())
    return float(interior.sum())


def _estimate_scale(seg: Segmentation, names: list[str], types: list[str], dims: list, walls: np.ndarray,
                    total_sqft: Optional[float], manual_proc: Optional[float], cfg: dict) -> ScaleResult:
    samples = []
    for i, rr in enumerate(seg.regions):
        if dims[i] and rr.mask is not None and rr.status in SCALE_USABLE:
            ew, eh, raw = room_extent(rr.mask)
            samples.append(RoomDimsSample(names[i], ew, eh, *dims[i], raw_bbox=raw))
    res = from_room_dims(samples, cfg["scale"])
    balcony = np.zeros(walls.shape, bool)
    for rr, t in zip(seg.regions, types):
        if t == "balcony" and rr.mask is not None:
            balcony |= rr.mask
    res2 = from_total_sqft(_floor_px(seg, balcony, walls, cfg["scale"]["total_sqft_basis"]), total_sqft,
                           cfg["scale"]["total_sqft_basis"])
    if res.ppf:
        if res2.ppf:  # independent cross-check, reported only
            res.notes.append(f"cross-check: total_sqft would give {res2.ppf:.2f} processed px/ft "
                             f"({(res2.ppf - res.ppf) / res.ppf:+.0%} vs room dims)")
        return res
    res2.notes = res.notes + res2.notes
    res2.per_room = res.per_room
    if res2.ppf:
        return res2
    if manual_proc:
        return ScaleResult(manual_proc, "manual", res2.notes + ["manual pixels_per_foot parameter"],
                           res.per_room)
    return ScaleResult(None, None, res2.notes + ["no manual pixels_per_foot given; areas unavailable"],
                       res.per_room)


def _initial_ppf(wr: WallResult, prepped: Prepped, cfg: dict, total_sqft: Optional[float],
                 manual_proc: Optional[float]) -> tuple[float, str]:
    """First guess, only used to size door gaps for the first segmentation pass."""
    guess = max(prepped.w, prepped.h) / cfg["scale"]["initial_long_side_ft"]
    if total_sqft:
        fills = find_gap_fills(wr.mask, wr.ink, thickness_px=wr.thickness_px, ppf=guess, cfg=cfg["gaps"])
        closed = cv2.bitwise_or(wr.mask, fills.mask(cfg["gaps"]["door_max_ft"] * guess))
        floor = float(enclosed_floor(closed, wr.ink, guess, cfg["rooms"]).sum())
        if floor > 0.05 * prepped.w * prepped.h:
            return (floor / total_sqft) ** 0.5, "total_sqft"
    if manual_proc:
        return manual_proc, "manual"
    return guess, "image size"


def _railings(walls: np.ndarray, seg: Segmentation, types: list[str], thickness: float, margin: int
              ) -> np.ndarray:
    """Wall pixels that only border balconies (railings drawn as walls) -> not extruded in 3D."""
    balcony = np.zeros(walls.shape, bool)
    others = seg.floor.copy()
    for rr, t in zip(seg.regions, types):
        if rr.mask is None:
            continue
        if t == "balcony":
            balcony |= rr.mask
        else:
            others |= rr.mask
    if not balcony.any():
        return np.zeros(walls.shape, bool)
    # the thin-line strip hugging the balcony (railing glass/edge lines) is balcony too, and
    # 1-2px slivers of leftover floor must not make a railing look shared with a room
    others &= ~(cv2.dilate(balcony.astype(np.uint8), rect(2 * margin + 9)) > 0)
    others = cv2.morphologyEx(others.astype(np.uint8), cv2.MORPH_OPEN, rect(5)) > 0
    k = rect(2 * int(round(1.5 * thickness + margin)) + 1)
    near_b = cv2.dilate(balcony.astype(np.uint8), k) > 0
    near_o = cv2.dilate(others.astype(np.uint8), k) > 0
    return (walls > 0) & near_b & ~near_o


def _footprint(seg: Segmentation, walls_3d: np.ndarray, walls: np.ndarray, types: list[str], cfg: dict
               ) -> list[np.ndarray]:
    """Building outline(s): 3D walls + door/window gap fills + every enclosed floor pixel, minus
    balconies. Lets the 3D view lay one continuous floor slab (hallways have no room polygon)."""
    balcony = np.zeros(walls.shape, np.uint8)
    for rr, t in zip(seg.regions, types):
        if t == "balcony" and rr.mask is not None:
            balcony |= rr.mask.astype(np.uint8)
    foot = seg.floor | (walls_3d > 0) | ((seg.closed > 0) & (walls == 0))
    foot &= ~(cv2.dilate(balcony, rect(5)) > 0)
    foot = cv2.morphologyEx(foot.astype(np.uint8), cv2.MORPH_OPEN, rect(5))
    contours, _ = cv2.findContours(foot, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = cfg["rooms"]["min_room_area_sqft"] * 4 * (cfg["target_long_side"] / 40) ** 2
    return [cv2.approxPolyDP(c, cfg["polygon_epsilon_px"], True).reshape(-1, 2)
            for c in contours if cv2.contourArea(c) >= min_area]


def _bedroom_closets(seg: Segmentation, walls: np.ndarray, types: list[str], thickness: float) -> dict[int, int]:
    """closet index -> bedroom index. A closet belongs to a bedroom when the two regions touch with
    no wall in between: directly (split from one region), across a thin line (bifold, slider, dotted
    closet front) or across a door-gap fill (a closet door that opens into the bedroom). Growth only
    runs through those barrier pixels, so a hall closet next to a bedroom door is not claimed."""
    bedrooms = [i for i, t in enumerate(types) if t == "bedroom" and seg.regions[i].mask is not None]
    if not bedrooms:
        return {}
    reach = ((seg.closed > 0) & (walls == 0)) | seg.lines
    steps = int(round(1.5 * thickness)) + 12
    h, w = walls.shape
    k3 = np.ones((3, 3), np.uint8)
    out: dict[int, int] = {}
    for ci, t in enumerate(types):
        mask = seg.regions[ci].mask
        if t != "closet" or mask is None:
            continue
        ys, xs = np.nonzero(mask)
        y0, y1 = max(0, int(ys.min()) - steps - 2), min(h, int(ys.max()) + steps + 3)
        x0, x1 = max(0, int(xs.min()) - steps - 2), min(w, int(xs.max()) + steps + 3)
        own = mask[y0:y1, x0:x1]
        allowed = (reach[y0:y1, x0:x1] | own).astype(np.uint8)
        grown = own.astype(np.uint8)
        for _ in range(steps):
            nxt = cv2.dilate(grown, k3) & allowed
            if np.array_equal(nxt, grown):
                break
            grown = nxt
        touch = cv2.dilate(grown, k3) > 0
        contact = {bi: int((touch & seg.regions[bi].mask[y0:y1, x0:x1]).sum()) for bi in bedrooms}
        best = max(contact, key=contact.get)
        if contact[best] >= 3:
            out[ci] = best
    return out


def parse_floorplan(image_bytes: bytes, filename: Optional[str] = None, *, wall_style: Optional[str] = None,
                    pixels_per_foot: Optional[float] = None, provider: Optional[str] = None,
                    no_cache: bool = False, reuse_semantics: bool = False, save: bool = True,
                    config_overrides: Optional[dict] = None) -> dict:
    """Parse one floor plan image. Cached by image hash (+ params) unless no_cache/reuse_semantics.

    pixels_per_foot is in original-image pixels and, per spec, only used when neither printed
    room dims nor meta.json total_sqft can provide a scale.
    """
    t0 = time.monotonic()
    timings: dict[str, float] = {}
    img_hash = cache.image_hash(image_bytes)
    wall_style = None if wall_style in (None, "", "auto") else wall_style
    key = cache.cache_key(provider, wall_style, pixels_per_foot)
    prefer = None
    if not no_cache:
        hit = cache.find_result(img_hash, key)
        if hit is not None and not reuse_semantics:
            return {**hit, "cached": True}
        prefer = hit["semantics_provider"] if hit else None  # re-run geometry on the same vision answer

    base = cache.safe_name(filename)
    if cache.name_taken_by_other_image(base, img_hash):
        base = f"{base}_{img_hash[:8]}"
    name = base + cache.variant_suffix(provider, wall_style, pixels_per_foot)
    cfg = get_config(base, config_overrides)
    style = wall_style or cfg["wall_style"]
    warnings: list[str] = []

    prepped = preprocess(image_bytes, cfg["target_long_side"])
    s = prepped.scale
    h, w = prepped.h, prepped.w
    timings["preprocess"] = time.monotonic() - t0

    meta, meta_key = lookup_meta(filename, img_hash)
    if meta is None:
        warnings.append("meta: image not in meta.json; total_sqft scale fallback, sanity check and rent skipped")
    total_sqft = (meta or {}).get("total_sqft")

    t = time.monotonic()
    sem_payload, sem_source = _semantics(prepped, img_hash, provider, no_cache, prefer)
    timings["semantics"] = time.monotonic() - t
    sem = Semantics.model_validate(sem_payload["semantics"])
    warnings += sem_payload.get("warnings", [])
    if sem.is_3d_render:
        warnings.append("semantics: image looks like a 3D render, not a 2D plan; geometry will be unreliable")
    if not sem.rooms:
        warnings.append("semantics: no labeled rooms found")

    names = [r.name.replace("\n", " ").strip() for r in sem.rooms]
    types = [r.type for r in sem.rooms]
    label_px = [(int(round(r.label_center[0] * (w - 1))), int(round(r.label_center[1] * (h - 1))))
                for r in sem.rooms]
    dims: list[Optional[tuple[float, float]]] = []
    for r, nm in zip(sem.rooms, names):
        parsed = parse_dims_text(r.dims_text)
        model = (r.width_ft, r.length_ft) if r.width_ft and r.length_ft else None
        if parsed and model and max(abs(parsed[0] - model[0]), abs(parsed[1] - model[1])) > 0.1:
            warnings.append(f"dims: {nm}: model read {r.dims_text!r} as {model[0]} x {model[1]}, "
                            f"using parsed {parsed[0]} x {parsed[1]}")
        if r.dims_text and not parsed and not model:
            warnings.append(f"dims: {nm}: could not parse {r.dims_text!r}")
        dims.append(parsed or model)

    # walls
    t = time.monotonic()
    wr = extract_walls(prepped.gray, cfg, style, protect=label_px)
    timings["walls"] = time.monotonic() - t

    # scale <-> segmentation loop (door gap sizes depend on the scale, the scale on the rooms)
    t = time.monotonic()
    manual_proc = pixels_per_foot * s if pixels_per_foot else None
    ppf, init_src = _initial_ppf(wr, prepped, cfg, total_sqft, manual_proc)
    history = [{"ppf_processed": round(ppf, 3), "source": f"initial ({init_src})"}]

    def run(p: float) -> tuple[Segmentation, GapFills]:
        f = find_gap_fills(wr.mask, wr.ink, thickness_px=wr.thickness_px, ppf=p, cfg=cfg["gaps"])
        return segment_rooms(wr.mask, wr.ink, f, label_px, p, cfg), f

    est = ScaleResult(None, None)
    converged = False
    for _ in range(cfg["scale"]["max_iterations"]):
        seg, fills = run(ppf)
        est = _estimate_scale(seg, names, types, dims, wr.mask, total_sqft, manual_proc, cfg)
        if est.ppf is None:
            break
        history.append({"ppf_processed": round(est.ppf, 3), "source": est.method})
        converged = abs(est.ppf - ppf) / ppf < cfg["scale"]["converge_tolerance"]
        ppf = est.ppf
        if converged:
            break
    if est.ppf is not None and not converged:
        seg, fills = run(ppf)  # final pass at the last estimate
        warnings.append("scale: estimate still moving after max_iterations; used the last value")
    timings["segmentation"] = time.monotonic() - t
    final_ppf = est.ppf  # processed px per foot, or None
    if est.method is None:
        warnings.append("scale: no printed dims, no total_sqft and no manual pixels_per_foot; areas are null")
    elif est.method != "room_dims":
        warnings.append(f"scale: no usable printed room dims; used {est.method}")
    if pixels_per_foot and est.method not in (None, "manual"):
        est.notes.append(f"manual pixels_per_foot={pixels_per_foot:g} ignored (fallback 2; {est.method} available)")

    # rooms
    rooms_out: list[dict] = []
    dbg_rooms: list[dict] = []
    for i, (r, rr) in enumerate(zip(sem.rooms, seg.regions)):
        mask = rr.mask
        area_px = float(mask.sum()) if mask is not None else None
        area = area_px / final_ppf ** 2 if (area_px and final_ppf) else None
        printed = dims[i]
        printed_area = printed[0] * printed[1] if printed else None
        err = (area - printed_area) / printed_area * 100 if (area and printed_area) else None
        bbox, poly = None, None
        if mask is not None:
            m8 = mask.astype(np.uint8)
            x, y, bw, bh = cv2.boundingRect(m8)
            bbox = [round(x / s, 1), round(y / s, 1), round(bw / s, 1), round(bh / s, 1)]
            cnts, _ = cv2.findContours(m8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            c = max(cnts, key=cv2.contourArea)
            poly = _to_orig(cv2.approxPolyDP(c, cfg["polygon_epsilon_px"], True), s)
        rooms_out.append({
            "id": f"r{i + 1}",
            "name": names[i],
            "type": r.type,
            "label_point": [round(rr.label_px[0] / s, 1), round(rr.label_px[1] / s, 1)],
            "label_point_norm": [round(v, 4) for v in r.label_center],
            "printed_dims_ft": {"w": printed[0], "l": printed[1]} if printed else None,
            "printed_dims_text": r.dims_text,
            "area_sqft": _r(area),
            "area_sqft_final": _r(printed_area if printed_area else area),
            "area_source": "printed" if printed_area else ("measured" if area is not None else None),
            "printed_area_sqft": _r(printed_area),
            "area_vs_printed_pct": _r(err),
            "has_private_bath": (bool(r.has_private_bath) if r.type == "bedroom" else None),
            "bbox": bbox,
            "polygon": poly,
            "segmentation": rr.status,
            "segmentation_notes": rr.notes,
            "shared_region_with": [f"r{j + 1}" for j in rr.shared_with],
        })
        dbg_rooms.append({"mask": mask, "name": names[i], "area_sqft": area, "label_px": rr.label_px,
                          "status": rr.status})

    # bedrooms: closets that open into them (for the rent split). Measured + measured, because
    # printed bedroom dims sometimes already include the closet strip (Longwood) and sometimes don't.
    closet_of = _bedroom_closets(seg, wr.mask, types, wr.thickness_px)
    for bi, ro in enumerate(rooms_out):
        if ro["type"] != "bedroom":
            continue
        cids = sorted((ci for ci, b in closet_of.items() if b == bi), key=lambda c: c)
        ro["closet_ids"] = [rooms_out[ci]["id"] for ci in cids]
        own = ro["area_sqft"]
        ro["area_with_closets_sqft"] = _r(own + sum(rooms_out[ci]["area_sqft"] or 0 for ci in cids)) \
            if own is not None else None

    # room-level warnings
    split_groups = {tuple(sorted([i] + rr.shared_with)) for i, rr in enumerate(seg.regions)
                    if rr.status == "split"}
    for g in sorted(split_groups):
        warnings.append("rooms: " + ", ".join(names[i] for i in g) +
                        " share one open region (no wall/door between them); split with a watershed, "
                        "areas approximate")
    for i, rr in enumerate(seg.regions):
        if rr.status in ("failed", "leaked", "snapped"):
            warnings.append(f"rooms: {names[i]}: {rr.status} - {'; '.join(rr.notes) or 'no region'}")
    for ro in rooms_out:
        if ro["type"] == "closet" and (ro["area_sqft"] or 0) > cfg["sanity"]["closet_max_sqft"]:
            warnings.append(f"rooms: {ro['name']} ({ro['id']}) is {ro['area_sqft']:.0f} sq ft, large for a "
                            "closet; its region probably includes an unlabeled hallway or alcove")
        if ro["area_vs_printed_pct"] is not None and abs(ro["area_vs_printed_pct"]) > 25:
            warnings.append(f"rooms: {ro['name']} area {ro['area_sqft']} sq ft vs printed "
                            f"{ro['printed_area_sqft']} ({ro['area_vs_printed_pct']:+.0f}%)")

    # walls for 3D: drop balcony railings
    rail = _railings(wr.mask, seg, types, wr.thickness_px, cfg["balcony_wall_margin_px"])
    walls_3d = np.where((wr.mask > 0) & ~rail, 255, 0).astype(np.uint8)
    polys = mask_polygons(walls_3d, cfg["polygon_epsilon_px"], cfg["wall_polygon_min_area_px"])
    walls_out = [{"id": f"w{k + 1}", "polygon": _to_orig(p["outer"], s),
                  "holes": [_to_orig(hh, s) for hh in p["holes"]]} for k, p in enumerate(polys)]
    footprint = _footprint(seg, walls_3d, wr.mask, types, cfg)
    footprint_out = [_to_orig(p, s) for p in footprint]
    # export-only extra for the 3D view (not used by anything above)
    openings_out = [{"id": f"o{k + 1}", "kind": o["kind"], "axis": o["axis"], "polygon": _to_orig(o["rect"], s),
                     "width_ft": _r(o["width_px"] / final_ppf)} for k, o in enumerate(extras.openings(fills.gaps, final_ppf, seg.door_px))
                    ] if final_ppf else []

    # unit + sanity check
    unit = {
        "total_sqft": (meta or {}).get("total_sqft", sem.total_sqft),
        "beds": (meta or {}).get("beds", sem.beds),
        "baths": (meta or {}).get("baths", sem.baths),
        "rent": (meta or {}).get("rent"),
    }
    if meta:
        for k in ("beds", "baths"):
            if meta.get(k) is not None and getattr(sem, k) is not None and float(meta[k]) != float(getattr(sem, k)):
                warnings.append(f"unit: meta.json says {k}={meta[k]:g} but the plan reads as {getattr(sem, k):g}")
    room_sum = sum(ro["area_sqft"] or 0 for ro in rooms_out if ro["type"] != "balcony")
    interior_sqft = float(seg.floor.sum()) / final_ppf ** 2 if final_ppf else None
    vs_total = (room_sum - total_sqft) / total_sqft * 100 if (total_sqft and final_ppf) else None
    if vs_total is not None and abs(vs_total) > cfg["sanity"]["total_sqft_tolerance"] * 100:
        warnings.append(f"sanity: rooms sum to {room_sum:.0f} sq ft vs total_sqft {total_sqft:g} ({vs_total:+.0f}%)")

    out_dir = PARSED_DIR / name
    debug_files, original = [], None
    if save:
        debug_files = write_debug_images(out_dir, prepped.rgb, walls_3d, seg.closed, polys, dbg_rooms,
                                         fills.mask(seg.door_px))
        original = cache.save_original(name, image_bytes)
    timings["total"] = time.monotonic() - t0

    result = {
        "source_image": meta_key or (filename and filename.split("/")[-1]) or name,
        "image_size": {"w": prepped.orig_w, "h": prepped.orig_h},
        "semantics_provider": sem_payload["provider"],
        "scale": {
            "pixels_per_foot": _r(final_ppf / s, 3) if final_ppf else None,
            "method": est.method,
            "notes": "; ".join(est.notes),
        },
        "walls": walls_out,
        "rooms": rooms_out,
        "footprint": footprint_out,
        "openings": openings_out,
        "unit": unit,
        "warnings": warnings,
        # ---- extras beyond the spec (debugging, provenance, later steps)
        "plan_name": name,
        "image_hash": img_hash,
        "cache_key": key,
        "semantics_model": sem_payload["model"],
        "is_3d_render": sem.is_3d_render,
        "checks": {
            "rooms_sum_sqft": _r(room_sum) if final_ppf else None,
            "total_sqft": total_sqft,
            "rooms_vs_total_pct": _r(vs_total),
            "enclosed_floor_sqft": _r(interior_sqft),
        },
        "processing": {
            "pipeline_version": PIPELINE_VERSION,
            "prompt_version": PROMPT_VERSION,
            "semantics_source": sem_source,
            "semantics_attempts": sem_payload.get("attempts", []),
            "scale_factor": round(s, 6),
            "processed_size": {"w": w, "h": h},
            "pixels_per_foot_processed": _r(final_ppf, 3),
            "scale_iterations": history,
            "scale_per_room": est.per_room,
            "wall_style": {"requested": style, "used": wr.style, "scores": wr.scores},
            "threshold": wr.threshold,
            "wall_thickness_px": round(wr.thickness_px, 1),
            "door_gap_max_px": round(seg.door_px, 1),
            "gap_rays": {k: sum(g["kind"] == k for g in fills.gaps) for k in ("lined", "partly_lined", "open")},
            "railing_pixels_removed": int(rail.sum()),
            "timings_s": {k: round(v, 2) for k, v in timings.items()},
            "config": cfg,
        },
        "debug_images": [f"{name}/{f}" for f in debug_files],
        "original_image": original,
    }
    if save:
        cache.save_result(name, result)
    return result
