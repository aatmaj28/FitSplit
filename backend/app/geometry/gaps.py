"""Door / window gap closing for room segmentation (never written into the 3D walls).

A plain morphological closing would also close hallways and fill closets that are
narrower than a door, so instead rays are cast from *free wall ends* along the
wall direction: a horizontal wall piece whose end is open space (not a T/L junction)
shoots a ray sideways; if it hits another wall, that row of the gap is a candidate
fill. Same for vertical pieces.

Each ray is measured by its *open width*: the longest stretch not covered by an ink
line running along it. A window (glass lines across the whole gap) has open width ~0,
a door has its full width, and a window next to a balcony door has the door's width.
Short ink crossings (text, door leaves) don't count, so rays across rooms stay long.
Callers close everything up to `door_max_ft` for the main segmentation and wider
gaps only when two room labels still share one region.

Every ray is judged on its own: a single sealed row already blocks a 4-connected
flood fill, and grouping touching rays would let a short ray vouch for a long one.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

LINED = np.float32(0.5)  # open width stored for fully lined rays (always closed)


@dataclass
class GapFills:
    open_w: np.ndarray  # float32 px; 0 = not a gap, else open width of the narrowest ray through it
    gaps: list[dict]  # every accepted ray (debugging / door export later)

    def mask(self, max_open_px: float) -> np.ndarray:
        m = (self.open_w > 0) & (self.open_w <= max_open_px)
        return np.where(m, 255, 0).astype(np.uint8)

    @property
    def lined(self) -> np.ndarray:
        return self.open_w == LINED


def _run_extent_along_cols(M: np.ndarray) -> np.ndarray:
    """For every True pixel, the length of the vertical run of True pixels containing it."""
    h, w = M.shape
    starts = M & ~np.vstack([np.zeros((1, w), bool), M[:-1]])
    run_id = np.cumsum(starts, axis=0)  # per column, 1-based run counter
    idx = run_id + np.arange(w)[None, :] * (h + 1)
    counts = np.bincount(idx[M], minlength=(h + 1) * w)
    ext = np.zeros(M.shape, np.int32)
    ext[M] = counts[idx[M]]
    return ext


def _open_width(ink: np.ndarray, min_line: int) -> int:
    """Longest stretch of the ray not covered by an ink run of at least min_line px."""
    d = np.diff(np.concatenate(([0], ink.view(np.int8), [0])))
    starts, ends = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
    covered = np.zeros(ink.size + 2, bool)  # padded with True at both ends
    covered[0] = covered[-1] = True
    for s, e in zip(starts, ends):
        if e - s >= min_line:
            covered[s + 1:e + 1] = True
    idx = np.flatnonzero(covered)
    return int((np.diff(idx) - 1).max())


def _cast_rows(W: np.ndarray, ink: np.ndarray, run_min: float, elongation: float, free_max: float,
               limit: float):
    """Horizontal rays from free ends of horizontal wall pieces.

    A row-run end counts as a wall end when the piece is long enough, clearly longer than it
    is thick (column faces and wall bulges are blocky, stubs/jambs are elongated), and thin
    enough at the end that it is not a T/L junction with a perpendicular wall.
    Returns (row, x0, x1_exclusive, ray_ink) tuples.
    """
    h, w = W.shape
    vext = _run_extent_along_cols(W)
    hext = _run_extent_along_cols(W.T).T
    is_end = (hext >= run_min) & (hext >= elongation * vext) & (vext <= free_max)
    cols = np.arange(w)
    big = np.int64(10 ** 9)
    nxt = np.minimum.accumulate(np.where(W, cols[None, :], big)[:, ::-1], axis=1)[:, ::-1]
    prv = np.maximum.accumulate(np.where(W, cols[None, :], -big), axis=1)

    right_end = np.zeros_like(W)
    right_end[:, :-1] = W[:, :-1] & ~W[:, 1:] & is_end[:, :-1]
    left_end = np.zeros_like(W)
    left_end[:, 1:] = W[:, 1:] & ~W[:, :-1] & is_end[:, 1:]

    rays = []
    ys, xs = np.nonzero(right_end)
    for y, x in zip(ys.tolist(), xs.tolist()):
        hit = int(nxt[y, x + 1])
        if 0 < hit - (x + 1) <= limit:
            rays.append((y, x + 1, hit))
    ys, xs = np.nonzero(left_end)
    for y, x in zip(ys.tolist(), xs.tolist()):
        hit = int(prv[y, x - 1])
        if hit >= 0 and 0 < (x - 1) - hit <= limit:
            rays.append((y, hit + 1, x))
    return [(y, x0, x1, ink[y, x0:x1]) for y, x0, x1 in set(rays)]


def find_gap_fills(walls: np.ndarray, ink: np.ndarray, *, thickness_px: float, ppf: float,
                   cfg: dict) -> GapFills:
    """walls/ink: uint8 255 masks at processed scale. ppf: current pixels-per-foot estimate."""
    W = walls > 0
    I = ink > 0
    run_min = max(cfg["run_min_factor"] * max(thickness_px, 4.0), cfg["run_min_ft"] * ppf)
    free_max = cfg["free_end_max_thickness_ft"] * ppf
    open_max = cfg["merge_split_max_ft"] * ppf  # record everything up to the widest split step
    total_max = cfg["lined_gap_max_ft"] * ppf
    min_line = max(3, int(round(cfg["line_min_run_ft"] * ppf)))
    lined_tol = cfg["lined_tolerance_ft"] * ppf

    open_w = np.zeros(W.shape, np.float32)
    gaps = []
    for transpose in (False, True):
        Wt, It = (W.T, I.T) if transpose else (W, I)
        ow_t = np.zeros(Wt.shape, np.float32)
        for y, x0, x1, ray_ink in _cast_rows(Wt, It, run_min, cfg["end_min_elongation"], free_max, total_max):
            n = x1 - x0
            ow = _open_width(ray_ink, min_line)
            if ow <= lined_tol:
                val, kind = LINED, "lined"
            elif ow <= open_max:
                val, kind = np.float32(ow), ("open" if ow == n else "partly_lined")
            else:
                continue
            seg = ow_t[y, x0:x1]
            np.copyto(seg, val, where=(seg == 0) | (seg > val))
            gaps.append({"kind": kind, "axis": "v" if transpose else "h", "row": y, "span": [x0, x1],
                         "width_px": n, "open_px": round(float(val), 1)})
        if transpose:
            ow_t = ow_t.T
        both = (open_w > 0) & (ow_t > 0)
        open_w = np.where(both, np.minimum(open_w, ow_t), np.maximum(open_w, ow_t))
    return GapFills(open_w=open_w, gaps=gaps)
