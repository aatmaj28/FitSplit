"""Export-only extra for the 3D view: wall openings.

Never used by segmentation, areas or scale: computed after the fact from the gap rays the pipeline
already has, and written to the JSON as `openings`. The rays of gaps.py (one per pixel row / column
across a gap between free wall ends) are grouped into rectangles. Mostly lined rays (glass lines
across the gap) = window; otherwise a door, or an "opening" when it is clearly wider than a door
(archway, open-plan boundary). Consumers should keep only openings with different spaces on their two
sides (a ray can cross a fixture such as a bathtub).
"""
from __future__ import annotations

import cv2
import numpy as np


def openings(gaps: list[dict], ppf: float, door_px: float, *, min_width_ft: float = 1.5,
             window_lined_share: float = 0.6) -> list[dict]:
    """Rectangles (processed px) from gap rays: {"kind", "axis", "rect": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], "width_px"}."""
    out: list[dict] = []
    for axis in ("h", "v"):
        rays = sorted((g for g in gaps if g["axis"] == axis), key=lambda g: (g["row"], g["span"][0]))
        groups: list[dict] = []
        for r in rays:
            a0, a1 = r["span"]
            for g in groups:
                overlap = min(a1, g["a1"]) - max(a0, g["a0"])
                if 0 <= r["row"] - g["r1"] <= 1 and overlap >= 0.5 * min(a1 - a0, g["a1"] - g["a0"]):
                    g["r1"], g["a0"], g["a1"] = r["row"], min(g["a0"], a0), max(g["a1"], a1)
                    g["kinds"].append(r["kind"])
                    break
            else:
                groups.append({"r0": r["row"], "r1": r["row"], "a0": a0, "a1": a1, "kinds": [r["kind"]]})
        for g in groups:
            width = g["a1"] - g["a0"]
            if g["r1"] - g["r0"] + 1 < 2 or width < min_width_ft * ppf:
                continue
            lined = g["kinds"].count("lined") / len(g["kinds"])
            kind = "window" if lined >= window_lined_share else ("door" if width <= door_px * 1.25 else "opening")
            # rows run across the wall's thickness; "h" rays are rows of the image, "v" rays its columns
            if axis == "h":
                x0, x1, y0, y1 = g["a0"], g["a1"], g["r0"], g["r1"] + 1
            else:
                x0, x1, y0, y1 = g["r0"], g["r1"] + 1, g["a0"], g["a1"]
            out.append({"kind": kind, "axis": axis, "rect": np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], float), "width_px": float(width)})
    return out
