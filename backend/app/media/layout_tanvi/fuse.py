"""Option C, step B+A merge: keep the schematic layout's topology, adopt measured room sizes.

Ported from Tanvi Deshpande's layout maker, github.com/Tanvi-15/Layout-maker (v2p/fuse.py), kept as
written. One addition for FitSplit: a measurement may carry its own "weight" and "source". FitSplit's
per-room sizes from reference objects are estimates too, so they are fused with a lower weight
than her Depth Anything 3 measurements (10) and labelled with where they came from, never as
"measured".

The layout is a rectilinear arrangement, so every room edge lies on a shared grid
line. We solve (per axis, by least squares) for new grid-line positions so that
each room's width/depth matches its target: the measured size where a
measurement is trusted, otherwise the original estimate (with a lower weight).
Neighbouring rooms stay attached because they share grid lines. Doors and
windows are carried along by piecewise-linear interpolation between grid lines.
"""
from __future__ import annotations

import copy
import math

import numpy as np

W_MEASURED, W_ESTIMATE, W_REGULARISE, W_SMALL_GAP = 10.0, 1.0, 0.05, 20.0
ACCEPT_RATIO = (0.6, 1.6)  # measured/estimated per axis; outside this, distrust the measurement
# Hallway widths are close to standard (~1.0-1.2 m), so an estimated hallway is hard to stretch.
TYPE_WEIGHT = {"hallway": 6.0}


def _grid(values, tol=0.05):
    lines = []
    for v in sorted(values):
        if not lines or v - lines[-1] > tol:
            lines.append(v)
    return np.array(lines)


def _idx(lines, v):
    return int(np.argmin(np.abs(lines - v)))


def match_axes(measured, estimated):
    """Measured dims are unordered w.r.t. the layout axes; pick the assignment closest to the estimate."""
    (a, b), (w, h) = measured, estimated
    keep = abs(math.log(a / w)) + abs(math.log(b / h))
    swap = abs(math.log(b / w)) + abs(math.log(a / h))
    return (a, b) if keep <= swap else (b, a)


def _solve_axis(lines, spans):
    """lines: old grid positions; spans: [(i_lo, i_hi, target, weight)] -> new grid positions."""
    n = len(lines)
    rows, rhs, wts = [], [], []
    for i, j, target, w in spans:
        r = np.zeros(n)
        r[j], r[i] = 1, -1
        rows.append(r), rhs.append(target), wts.append(w)
    for k in range(n - 1):  # keep untouched gaps near their old size
        r = np.zeros(n)
        r[k + 1], r[k] = 1, -1
        gap = lines[k + 1] - lines[k]
        # Small offsets (bay depth, wall insets) are drawn deliberately; keep them.
        rows.append(r), rhs.append(gap), wts.append(W_SMALL_GAP if gap < 1.0 else W_REGULARISE)
    r = np.zeros(n)
    r[0] = 1  # anchor
    rows.append(r), rhs.append(lines[0]), wts.append(100.0)
    A = np.array(rows) * np.sqrt(wts)[:, None]
    b = np.array(rhs) * np.sqrt(wts)
    new = np.linalg.lstsq(A, b, rcond=None)[0]
    # Preserve ordering (a negative gap would flip rooms).
    for k in range(1, n):
        new[k] = max(new[k], new[k - 1] + 0.05)
    return new


def fuse(layout: dict, measurements: dict) -> tuple[dict, list[str]]:
    out = copy.deepcopy(layout)
    rooms = out["rooms"]
    xl = _grid([r["rect"][0] for r in rooms] + [r["rect"][0] + r["rect"][2] for r in rooms])
    yl = _grid([r["rect"][1] for r in rooms] + [r["rect"][1] + r["rect"][3] for r in rooms])
    xs, ys, log = [], [], []
    for r in rooms:
        x, y, w, h = r["rect"]
        tw, th, wt = w, h, W_ESTIMATE * TYPE_WEIGHT.get(r["type"], 1.0)
        m = measurements.get(r["id"], {})
        r["dims_source"] = "estimated"
        if m.get("ok") and m.get("dims_m"):
            mw, mh = match_axes(m["dims_m"], (w, h))
            ratios = (mw / w, mh / h)
            if all(ACCEPT_RATIO[0] <= q <= ACCEPT_RATIO[1] for q in ratios):
                tw, th, wt = mw, mh, m.get("weight", W_MEASURED)
                r["dims_source"] = m.get("source", "measured")
                r["measured"] = {"dims_m": [mw, mh], "height_m": m.get("height_m"),
                                 "outline_fraction": m.get("outline_fraction")}
                log.append(f"{r['id']}: estimate {w:.2f}x{h:.2f} -> {r['dims_source']} {mw:.2f}x{mh:.2f} m")
            else:
                log.append(f"{r['id']}: measurement {mw:.2f}x{mh:.2f} rejected (ratio "
                           f"{ratios[0]:.2f}, {ratios[1]:.2f} vs estimate)")
        elif m:
            log.append(f"{r['id']}: no reliable measurement, keeping estimate")
        xs.append((_idx(xl, x), _idx(xl, x + w), tw, wt))
        ys.append((_idx(yl, y), _idx(yl, y + h), th, wt))

    nxl, nyl = _solve_axis(xl, xs), _solve_axis(yl, ys)
    for r, (i, j, _, _), (k, l, _, _) in zip(rooms, xs, ys):
        r["rect"] = [round(nxl[i], 2), round(nyl[k], 2), round(nxl[j] - nxl[i], 2), round(nyl[l] - nyl[k], 2)]
        if r.get("polygon"):
            r["polygon"] = [[round(float(np.interp(px, xl, nxl)), 2), round(float(np.interp(py, yl, nyl)), 2)]
                            for px, py in r["polygon"]]
    for o in out.get("openings", []):
        o["wall"] = [[round(float(np.interp(px, xl, nxl)), 2), round(float(np.interp(py, yl, nyl)), 2)]
                     for px, py in o["wall"]]
    heights = [m["height_m"] for m in measurements.values() if m.get("ok") and m.get("height_m")]
    if heights:
        out["ceiling_height_m"] = round(float(np.median(heights)), 2)
    sources = sorted({m.get("source", "measured") for m in measurements.values() if m.get("ok")})
    label = " and ".join("Depth Anything 3 measurements" if s == "measured" else f"{s} size estimates" for s in sources) or "measurements"
    out["source"] = (layout.get("source", "") + f" | sizes fused with {label}").strip(" |")
    return out, log
