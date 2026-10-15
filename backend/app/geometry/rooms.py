"""Room regions from label points.

Two levels:
  1. Fragments: free space cut by walls, door/window gap fills (gaps.py) and long thin
     ink lines (door arcs + leaves, window glass, bifold/slider symbols, railings,
     fixture and counter outlines). Thin lines alone already seal most openings, so
     rooms don't leak to the outside through windows or into each other through doors.
  2. Rooms: the fragment under each label, plus small unlabeled fragments (door swings,
     counter strips, fixture interiors) merged in across the thin line they share.
     Fragments that touch the outside (window sills, exterior) are never merged, and big
     unlabeled fragments (hallways, unlabeled spaces) stay unassigned.

Labels that still share one region are split by closing progressively wider gaps; if
that doesn't separate them (open plan), a distance-transform watershed splits the
region at its narrowest points (doorways, passages) and a warning is raised.
A label point that lands outside the plan (vision glitch) is snapped to the nearest
enclosed fragment within `label_exterior_snap_px`.
"""
from __future__ import annotations

import heapq
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

from .gaps import GapFills
from .walls import rect, remove_small_components


@dataclass
class RoomRegion:
    mask: Optional[np.ndarray]  # bool (h, w)
    label_px: tuple[int, int]
    status: str = "ok"  # ok | split | snapped | leaked | failed
    notes: list[str] = field(default_factory=list)
    shared_with: list[int] = field(default_factory=list)  # rooms that shared the region before a split


@dataclass
class Segmentation:
    regions: list[RoomRegion]
    closed: np.ndarray  # uint8 255 = walls + gap fills (the segmentation barrier, minus thin lines)
    lines: np.ndarray  # bool, thin-line barrier pixels
    floor: np.ndarray  # bool, enclosed free space (can't reach the border without crossing a barrier)
    door_px: float


def dashed_lines(small_ink: np.ndarray, ppf: float, rcfg: dict) -> np.ndarray:
    """Dotted / dashed straight lines (closet outlines, cabinet lines) rebuilt from small blobs.

    Small blobs are bridged along each axis. A bar counts as a dotted line when it is long,
    thin (text bridged into words comes out tall) and made of several blobs (a single tall
    letter stroke in a big font is one blob)."""
    bridge = max(3, int(round(rcfg["dash_bridge_ft"] * ppf)))
    min_len = max(5, int(round(rcfg["dash_min_len_ft"] * ppf)))
    max_thick = max(3, int(round(rcfg["dash_max_thick_ft"] * ppf)))
    _, blob_id = cv2.connectedComponents(small_ink, connectivity=8)
    out = np.zeros(small_ink.shape, np.uint8)
    for horiz in (True, False):
        along = (lambda n: (n, 1)) if horiz else (lambda n: (1, n))
        across = (1, max_thick + 1) if horiz else (max_thick + 1, 1)
        joined = cv2.morphologyEx(small_ink, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, along(bridge)))
        bars = cv2.morphologyEx(joined, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, along(min_len)))
        thick = cv2.morphologyEx(bars, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, across))
        n, bar_id = cv2.connectedComponents(bars, connectivity=8)
        if n <= 1:
            continue
        sel = (bar_id > 0) & (blob_id > 0)
        pairs = np.unique(bar_id[sel].astype(np.int64) * (blob_id.max() + 1) + blob_id[sel])
        blobs_per_bar = np.bincount(pairs // (blob_id.max() + 1), minlength=n)
        keep = blobs_per_bar >= rcfg["dash_min_blobs"]
        keep[np.unique(bar_id[cv2.dilate(thick, rect(3)) > 0])] = False  # bar is part of bridged text
        keep[0] = False
        out |= np.where(keep[bar_id], 255, 0).astype(np.uint8)
    return out


def thin_lines(closed: np.ndarray, ink: np.ndarray, ppf: float, rcfg: dict) -> np.ndarray:
    """Long thin ink plus dotted/dashed lines (no text), thickened a little to seal pixel gaps;
    free space only."""
    lines = remove_small_components(ink, min_side=rcfg["barrier_min_side_px"])
    small = cv2.bitwise_and(ink, cv2.bitwise_not(lines))
    lines = cv2.bitwise_or(lines, dashed_lines(small, ppf, rcfg))
    lines = cv2.dilate(lines, rect(1 + 2 * rcfg["barrier_dilate_px"]))
    return (lines > 0) & (closed == 0)


def enclosed_floor(closed: np.ndarray, ink: np.ndarray, ppf: float, rcfg: dict) -> np.ndarray:
    """Free pixels that can't reach the image border without crossing a wall, a gap fill or
    a drawn line. Text and fixtures inside the plan are included; walls are not."""
    lines = thin_lines(closed, ink, ppf, rcfg)
    fine = (closed == 0) & ~lines
    _, cc = cv2.connectedComponents(fine.astype(np.uint8), connectivity=4)
    border = np.unique(np.concatenate([cc[0], cc[-1], cc[:, 0], cc[:, -1]]))
    outside = np.isin(cc, border[border > 0])
    outside |= lines & (cv2.dilate(outside.astype(np.uint8), rect(5)) > 0)  # outer edge lines
    return (closed == 0) & ~outside


def _snap(ok: np.ndarray, x: int, y: int, max_dist: float) -> Optional[tuple[int, int]]:
    """Nearest True pixel of `ok` within max_dist of (x, y), or None."""
    h, w = ok.shape
    x, y = min(max(int(x), 0), w - 1), min(max(int(y), 0), h - 1)
    if ok[y, x]:
        return x, y
    r = int(np.ceil(max_dist))
    x0, x1, y0, y1 = max(0, x - r), min(w, x + r + 1), max(0, y - r), min(h, y + r + 1)
    ys, xs = np.nonzero(ok[y0:y1, x0:x1])
    if xs.size == 0:
        return None
    d2 = (xs + x0 - x) ** 2 + (ys + y0 - y) ** 2
    i = int(np.argmin(d2))
    if d2[i] > max_dist ** 2:
        return None
    return int(xs[i] + x0), int(ys[i] + y0)


def fill_holes(mask: np.ndarray) -> np.ndarray:
    m = np.where(mask, 255, 0).astype(np.uint8)
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = np.zeros_like(m)
    cv2.drawContours(out, contours, -1, 255, thickness=cv2.FILLED)
    return out > 0


def _line_adjacency(fcc: np.ndarray, lines: np.ndarray, steps: int) -> dict[tuple[int, int], int]:
    """Pairs of fragments facing each other across thin lines -> shared boundary (line px).

    Fragment ids are propagated into line pixels only (never through walls), so double
    lines and thick rims work and fragments on opposite sides of a wall never pair up."""
    big = np.float32(fcc.max() + 1)
    hi = np.where(fcc > 0, fcc, 0).astype(np.float32)
    lo = np.where(fcc > 0, fcc, big).astype(np.float32)
    k = np.ones((3, 3), np.uint8)
    for _ in range(steps):
        hi = np.where(lines, np.maximum(hi, cv2.dilate(hi, k)), hi)
        lo = np.where(lines, np.minimum(lo, cv2.erode(lo, k)), lo)
    sel = lines & (lo < big) & (hi > lo)
    a, b = lo[sel].astype(np.int64), hi[sel].astype(np.int64)
    if a.size == 0:
        return {}
    base = int(big) + 1
    keys, counts = np.unique(a * base + b, return_counts=True)
    return {(int(kk // base), int(kk % base)): int(c) for kk, c in zip(keys, counts)}


def _dt_watershed(region: np.ndarray, pts: dict[int, tuple[int, int]], ds: int) -> dict[int, np.ndarray]:
    """Split a region between label points: multi-source Dijkstra where a step costs
    1 / (distance to the nearest wall). Crossing a room is cheap and squeezing through a
    doorway or hallway is expensive, so boundaries land at constrictions; unlike a
    plain watershed, a label sitting in a narrow foyer still claims its own surroundings.
    Runs on a ds-times downsampled crop for speed."""
    ys, xs = np.nonzero(region)
    y0, x0 = int(ys.min()), int(xs.min())
    crop = region[y0:int(ys.max()) + 1, x0:int(xs.max()) + 1]
    ch, cw = crop.shape
    sh, sw = -(-ch // ds), -(-cw // ds)
    pad = np.zeros((sh * ds, sw * ds), bool)
    pad[:ch, :cw] = crop
    small = pad.reshape(sh, ds, sw, ds).mean(axis=(1, 3)) >= 0.5
    step_cost = 1.0 / (cv2.distanceTransform(small.astype(np.uint8), cv2.DIST_L2, 5) + 1.0)
    lab = np.zeros(small.shape, np.int32)
    heap: list[tuple[float, int, int, int]] = []
    ids = list(pts)
    for k, i in enumerate(ids, start=1):
        p = _snap(small, (pts[i][0] - x0) // ds, (pts[i][1] - y0) // ds, max_dist=max(sh, sw))
        if p is not None:
            heapq.heappush(heap, (0.0, p[1], p[0], k))
    while heap:
        c, y, x, k = heapq.heappop(heap)
        if lab[y, x]:
            continue
        lab[y, x] = k
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < sh and 0 <= nx < sw and small[ny, nx] and not lab[ny, nx]:
                heapq.heappush(heap, (c + float(step_cost[ny, nx]), ny, nx, k))
    full = np.repeat(np.repeat(lab, ds, axis=0), ds, axis=1)[:ch, :cw]
    full[~crop] = 0
    todo = crop & (full == 0)  # pixels lost by the downsampling: hand them to the neighbouring basin
    for _ in range(4 * ds):
        if not todo.any():
            break
        grown = cv2.dilate(full.astype(np.uint16), np.ones((3, 3), np.uint8))
        take = todo & (grown > 0)
        full[take] = grown[take]
        todo &= ~take
    out = {}
    for k, i in enumerate(ids, start=1):
        m = np.zeros(region.shape, bool)
        m[y0:y0 + ch, x0:x0 + cw] = full == k
        out[i] = m
    return out


def _split(region: np.ndarray, members: list[int], pts: dict[int, tuple[int, int]], fills: GapFills,
           ppf: float, gap_ft: float, cfg: dict, notes: dict[int, list[str]]
           ) -> tuple[dict[int, np.ndarray], bool]:
    """Split a region shared by several labels. Returns (masks, used_watershed)."""
    gcfg = cfg["gaps"]
    step, top = gcfg["merge_split_step_ft"], gcfg["merge_split_max_ft"]
    g = gap_ft + step
    while g <= top + 1e-6:
        sub = region & (fills.mask(g * ppf) == 0)
        _, cc = cv2.connectedComponents(sub.astype(np.uint8), connectivity=4)
        where: dict[int, list[int]] = {}
        for i in members:
            p = _snap(sub, *pts[i], max_dist=cfg["rooms"]["label_snap_max_px"])
            if p is not None:
                where.setdefault(int(cc[p[1], p[0]]), []).append(i)
        if len(where) > 1:  # at least one label separated at this gap width
            out: dict[int, np.ndarray] = {}
            used_ws = False
            for cid, group in where.items():
                part = cc == cid
                if len(group) == 1:
                    out[group[0]] = part
                    notes[group[0]].append(f"separated by closing gaps up to {g:.2f} ft")
                else:
                    masks, ws = _split(part, group, pts, fills, ppf, g, cfg, notes)
                    out.update(masks)
                    used_ws |= ws
            return out, used_ws
        g += step
    return _dt_watershed(region, {i: pts[i] for i in members}, ds=cfg["rooms"]["split_downsample"]), True


def segment_rooms(walls: np.ndarray, ink: np.ndarray, fills: GapFills, label_px: list[tuple[int, int]],
                  ppf: float, cfg: dict) -> Segmentation:
    rcfg, gcfg = cfg["rooms"], cfg["gaps"]
    h, w = walls.shape
    door_px = gcfg["door_max_ft"] * ppf
    closed = cv2.bitwise_or(walls, fills.mask(door_px))
    free = closed == 0
    lines = thin_lines(closed, ink, ppf, rcfg)
    fine = free & ~lines
    nf, fcc = cv2.connectedComponents(fine.astype(np.uint8), connectivity=4)
    border = np.unique(np.concatenate([fcc[0], fcc[-1], fcc[:, 0], fcc[:, -1]]))
    is_ext = np.zeros(nf, bool)
    is_ext[border[border > 0]] = True
    area = np.bincount(fcc.ravel(), minlength=nf)
    usable = fine & ~is_ext[fcc] & (area[fcc] >= rcfg["min_fragment_sqft"] * ppf * ppf)

    # 1. label -> fragment
    regions: list[RoomRegion] = []
    frag_of: dict[int, int] = {}
    for i, (x, y) in enumerate(label_px):
        rr = RoomRegion(mask=None, label_px=(x, y))
        regions.append(rr)
        p = _snap(usable, x, y, rcfg["label_snap_max_px"])
        if p is None:
            q = _snap(usable, x, y, rcfg["label_exterior_snap_px"])
            if q is None:
                rr.status = "failed"
                rr.notes.append("label point is outside the plan and no enclosed space is nearby")
                continue
            rr.status = "snapped"
            rr.notes.append(f"label point was not inside any enclosed space; snapped "
                            f"{np.hypot(q[0] - x, q[1] - y):.0f}px to the nearest one")
            p = q
        elif p != (x, y):
            rr.notes.append(f"label moved {np.hypot(p[0] - x, p[1] - y):.0f}px off a line/wall")
        rr.label_px = p
        frag_of[i] = int(fcc[p[1], p[0]])

    # 2. merge small unlabeled fragments into the labeled fragment across the thin line
    adj = _line_adjacency(fcc, lines, steps=rcfg["line_adjacency_steps"])
    nbrs: dict[int, dict[int, int]] = {}
    for (a, b), c in adj.items():
        nbrs.setdefault(a, {})[b] = c
        nbrs.setdefault(b, {})[a] = c
    owner = {f: f for f in frag_of.values()}
    merge_max = rcfg["merge_fragment_max_sqft"] * ppf * ppf
    touches_ext = {f for f in nbrs if any(is_ext[g] for g in nbrs[f])}
    cand = [f for f in range(1, nf) if f not in owner and not is_ext[f] and area[f] <= merge_max
            and f not in touches_ext]
    changed = True
    while changed:
        changed = False
        for f in sorted(cand, key=lambda f: -area[f]):
            if f in owner:
                continue
            score: dict[int, int] = {}
            for g, c in nbrs.get(f, {}).items():
                if g in owner:
                    score[owner[g]] = score.get(owner[g], 0) + c
            if score:
                owner[f] = max(score, key=score.get)
                changed = True

    # 3. one region per owner fragment (labels sharing a fragment share the region)
    owned = np.zeros(nf, np.int64)
    for f, o in owner.items():
        owned[f] = o
    own_map = owned[fcc]
    k = rect(2 * rcfg["barrier_dilate_px"] + 5)
    by_owner: dict[int, list[int]] = {}
    for i, f in frag_of.items():
        by_owner.setdefault(f, []).append(i)
    region_of: dict[int, np.ndarray] = {}
    for o in by_owner:
        m = cv2.morphologyEx((own_map == o).astype(np.uint8), cv2.MORPH_CLOSE, k) > 0
        region_of[o] = m & free  # absorbs the thin lines between merged fragments
    union = np.zeros((h, w), bool)
    for m in region_of.values():
        union |= m
    for o, m in region_of.items():
        region_of[o] = m | (fill_holes(m) & free & ~(union & ~m))  # enclosed rugs/islands, not other rooms

    # 4. split regions shared by several labels
    r_txt = max(8, int(round(rcfg["label_text_radius_ft"] * ppf)))
    on_text = {}  # any ink near the original point (label text, possibly touching a line)
    for i, (x, y) in enumerate(label_px):
        y0, y1, x0, x1 = max(0, y - r_txt), min(h, y + r_txt + 1), max(0, x - r_txt), min(w, x + r_txt + 1)
        on_text[i] = bool(ink[y0:y1, x0:x1].any())
    notes = {i: regions[i].notes for i in range(len(regions))}
    pts = {i: regions[i].label_px for i in range(len(regions))}
    max_area = rcfg["max_room_area_frac"] * h * w
    for o, members in by_owner.items():
        region = region_of[o]
        if len(members) == 1:
            i = members[0]
            regions[i].mask = region
            if region.sum() > max_area:
                regions[i].status = "leaked"
                notes[i].append("region is implausibly large (likely leaks through an unclosed opening)")
            continue
        # a label point with no text under it is probably misplaced by the vision model; don't
        # let it carve a piece out of a room that also holds a properly placed label
        placed = [i for i in members if on_text[i]]
        if placed and len(placed) < len(members):
            for i in members:
                if not on_text[i]:
                    regions[i].status = "failed"
                    regions[i].shared_with = [j for j in members if j != i]
                    notes[i].append("label point is not on any text and shares its region with "
                                    "properly placed labels; probably misplaced by the vision model")
            members = placed
            if len(members) == 1:
                regions[members[0]].mask = region
                continue
        masks, used_ws = _split(region, members, pts, fills, ppf, gcfg["door_max_ft"], cfg, notes)
        for i in members:
            regions[i].shared_with = [j for j in members if j != i]
            if i in masks and masks[i].any():
                regions[i].mask = masks[i]
                if used_ws and regions[i].status == "ok":
                    regions[i].status = "split"
            else:
                regions[i].status = "failed"
                notes[i].append("lost while splitting a shared region")

    min_px = rcfg["min_room_area_sqft"] * ppf * ppf
    for rr in regions:
        if rr.mask is not None and rr.mask.sum() < min_px:
            rr.notes.append(f"region smaller than {rcfg['min_room_area_sqft']} sq ft")
            rr.mask, rr.status = None, "failed"
    floor = enclosed_floor(closed, ink, ppf, rcfg)
    return Segmentation(regions=regions, closed=closed, lines=lines, floor=floor, door_px=door_px)
