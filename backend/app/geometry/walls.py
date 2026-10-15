"""Wall mask extraction (solid / outline / auto) and wall polygons.

solid   : walls are thick filled strokes -> morphological opening removes text,
          door arcs, fixtures, dimension text and furniture outlines.
outline : walls are two thin parallel lines with white between them -> drop
          glyph-sized blobs first (text has the same stroke width as the wall
          lines in these plans), close to fill between the line pairs, then open.
auto    : run both; solid wins when it captures a comparable share of the ink (it never
          invents fill), otherwise the higher cleanliness score wins.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from typing import Sequence

import cv2
import numpy as np

Points = Sequence[tuple[float, float]]


def rect(k: int) -> np.ndarray:
    k = max(1, int(round(k)))
    return cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))


def threshold_dark(gray: np.ndarray, cfg: dict) -> tuple[np.ndarray, float]:
    """Binary ink mask (255 = dark) and the threshold used."""
    method = cfg.get("method", "otsu")
    if method == "fixed":
        t = float(cfg["fixed_value"])
        return np.where(gray < t, 255, 0).astype(np.uint8), t
    otsu, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    t = float(otsu + cfg.get("offset", 0))
    dark = gray < t
    if method == "adaptive":  # local contrast, but never count near-white paper as ink
        local = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV,
                                      int(cfg["adaptive_block"]) | 1, float(cfg["adaptive_c"]))
        dark = (local > 0) & (gray < 245)
    return np.where(dark, 255, 0).astype(np.uint8), t


def remove_small_components(mask: np.ndarray, min_area: int = 0, min_side: int = 0) -> np.ndarray:
    """Drop components with area < min_area or bounding-box longest side < min_side."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 1:
        return mask
    area = stats[:, cv2.CC_STAT_AREA]
    side = np.maximum(stats[:, cv2.CC_STAT_WIDTH], stats[:, cv2.CC_STAT_HEIGHT])
    keep = (area >= min_area) & (side >= min_side)
    keep[0] = False
    return np.where(keep[labels], 255, 0).astype(np.uint8)


def fill_small_holes(mask: np.ndarray, max_area: int, protect: Points = ()) -> np.ndarray:
    """Fill enclosed background pockets smaller than max_area px (not touching the border).
    Pockets containing a protected point (a room label) are rooms, not columns: kept open."""
    if max_area <= 0:
        return mask
    inv = cv2.bitwise_not(mask)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
    h, w = mask.shape
    x, y, bw, bh, area = (stats[:, i] for i in range(5))
    touches = (x == 0) | (y == 0) | (x + bw >= w) | (y + bh >= h)
    fill = (area < max_area) & ~touches
    for px, py in protect:
        if 0 <= int(py) < h and 0 <= int(px) < w:
            fill[labels[int(py), int(px)]] = False
    fill[0] = False
    out = mask.copy()
    out[fill[labels]] = 255
    return out


def solid_walls(dark: np.ndarray, cfg: dict, protect: Points = ()) -> np.ndarray:
    walls = cv2.morphologyEx(dark, cv2.MORPH_OPEN, rect(cfg["open_kernel_px"]))
    walls = remove_small_components(walls, min_area=cfg["min_component_area_px"])
    return fill_small_holes(walls, cfg["fill_holes_max_area_px"], protect)


def outline_walls(dark: np.ndarray, cfg: dict, protect: Points = ()) -> np.ndarray:
    lines = remove_small_components(dark, min_side=cfg["glyph_max_side_px"])
    filled = cv2.morphologyEx(lines, cv2.MORPH_CLOSE, rect(cfg["close_kernel_px"]))
    filled = fill_small_holes(filled, cfg["fill_holes_max_area_px"], protect)
    walls = cv2.morphologyEx(filled, cv2.MORPH_OPEN, rect(cfg["open_kernel_px"]))
    return remove_small_components(walls, min_area=cfg["min_component_area_px"])


def score_walls(walls: np.ndarray, dark: np.ndarray, run_px: int = 60) -> dict:
    """Cleanliness of a wall mask, 0..1 per term.

    ink:       share of the ink that ended up inside walls (outline-as-solid loses most of it)
    straight:  share of wall pixels on long horizontal/vertical runs (text blobs are not)
    connected: share of wall pixels in the largest component (real walls form one network)
    """
    n = int(np.count_nonzero(walls))
    if n == 0:
        return {"score": 0.0, "ink": 0.0, "straight": 0.0, "connected": 0.0}
    ink = np.count_nonzero(walls & dark) / max(1, np.count_nonzero(dark))
    h = cv2.morphologyEx(walls, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (run_px, 1)))
    v = cv2.morphologyEx(walls, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, run_px)))
    straight = np.count_nonzero((h | v) & walls) / n
    _, _, stats, _ = cv2.connectedComponentsWithStats(walls, connectivity=8)
    connected = stats[1:, cv2.CC_STAT_AREA].max() / n if len(stats) > 1 else 0.0
    score = ink * straight * connected
    return {"score": round(float(score), 4), "ink": round(float(ink), 3),
            "straight": round(float(straight), 3), "connected": round(float(connected), 3)}


@dataclass
class WallResult:
    mask: np.ndarray  # 255 = wall
    dark: np.ndarray  # 255 = ink darker than the wall threshold
    ink: np.ndarray  # 255 = any visible line (incl. light gray window glass / fixtures)
    style: str  # style actually used
    threshold: float
    scores: dict = field(default_factory=dict)
    thickness_px: float = 0.0  # median wall thickness


def wall_thickness_px(mask: np.ndarray) -> float:
    """Median full thickness along the wall medial axis (2 x distance at ridge pixels)."""
    if not np.any(mask):
        return 0.0
    dt = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    ridge = (dt >= cv2.dilate(dt, np.ones((3, 3), np.uint8)) - 1e-6) & (dt > 1)
    vals = 2 * dt[ridge]
    return float(np.median(vals)) if vals.size else 0.0


def extract_walls(gray: np.ndarray, cfg: dict, style: str = "auto", protect: Points = ()) -> WallResult:
    """protect: room label points (px); enclosed pockets holding one are never filled."""
    dark, t = threshold_dark(gray, cfg["threshold"])
    candidates = {}
    if style in ("solid", "auto"):
        candidates["solid"] = solid_walls(dark, cfg["solid"], protect)
    if style in ("outline", "auto"):
        candidates["outline"] = outline_walls(dark, cfg["outline"], protect)
    if not candidates:
        raise ValueError(f"wall_style must be solid|outline|auto, got {style!r}")
    scores = {k: score_walls(m, dark) for k, m in candidates.items()}
    if len(candidates) == 1:
        chosen = next(iter(candidates))
    else:
        ratio = scores["solid"]["ink"] / max(scores["outline"]["ink"], 1e-6)
        scores["solid_ink_ratio"] = round(ratio, 3)
        if ratio >= cfg["auto_solid_ink_ratio"]:
            chosen = "solid"
        else:
            chosen = max(("solid", "outline"), key=lambda k: scores[k]["score"])
    mask = candidates[chosen]
    ink = np.where(gray < cfg["threshold"]["ink_max_gray"], 255, 0).astype(np.uint8)
    return WallResult(mask=mask, dark=dark, ink=ink, style=chosen, threshold=t, scores=scores,
                      thickness_px=wall_thickness_px(mask))


def mask_polygons(mask: np.ndarray, epsilon_px: float, min_area_px: float) -> list[dict]:
    """Outer contour + holes for every component (walls form rings around rooms, so the
    holes matter: extruding only the outer contour would fill the rooms in)."""
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return []
    hierarchy = hierarchy[0]
    polys = []
    for i, c in enumerate(contours):
        if hierarchy[i][3] != -1:  # holes are collected under their parent
            continue
        if cv2.contourArea(c) < min_area_px:
            continue
        outer = cv2.approxPolyDP(c, epsilon_px, True).reshape(-1, 2)
        holes = []
        child = hierarchy[i][2]
        while child != -1:
            hc = contours[child]
            if cv2.contourArea(hc) >= min_area_px:
                holes.append(cv2.approxPolyDP(hc, epsilon_px, True).reshape(-1, 2))
            child = hierarchy[child][0]
        if len(outer) >= 3:
            polys.append({"outer": outer, "holes": [h for h in holes if len(h) >= 3]})
    return polys
