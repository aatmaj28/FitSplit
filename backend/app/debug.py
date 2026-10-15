"""Debug images written next to each parsed JSON (processed-image coordinates)."""
from __future__ import annotations

import colorsys
from pathlib import Path

import cv2
import numpy as np

_FONT = cv2.FONT_HERSHEY_SIMPLEX


def _palette(n: int) -> list[tuple[int, int, int]]:
    cols = []
    for i in range(max(n, 1)):
        r, g, b = colorsys.hsv_to_rgb((i * 0.618034) % 1.0, 0.65, 0.95)
        cols.append((int(b * 255), int(g * 255), int(r * 255)))  # BGR
    return cols


def _faded(rgb: np.ndarray) -> np.ndarray:
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    return (bgr.astype(np.float32) * 0.45 + 255 * 0.55).astype(np.uint8)


def _text(img: np.ndarray, lines: list[str], center: tuple[int, int], scale: float = 0.55) -> None:
    sizes = [cv2.getTextSize(t, _FONT, scale, 2)[0] for t in lines]
    lh = max(s[1] for s in sizes) + 6
    y = int(center[1] - lh * len(lines) / 2 + lh)
    for t, (tw, _) in zip(lines, sizes):
        org = (int(center[0] - tw / 2), y)
        cv2.putText(img, t, org, _FONT, scale, (255, 255, 255), 4, cv2.LINE_AA)
        cv2.putText(img, t, org, _FONT, scale, (20, 20, 20), 1, cv2.LINE_AA)
        y += lh


def write_debug_images(out_dir: Path, rgb: np.ndarray, walls_3d: np.ndarray, closed: np.ndarray,
                       wall_polys: list[dict], rooms: list[dict], gap_mask: np.ndarray) -> list[str]:
    """rooms: dicts with mask (bool), name, area_sqft, label_px, status."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_dir / "wall_mask.png"), walls_3d)
    cv2.imwrite(str(out_dir / "closed_mask.png"), closed)

    # walls overlay: polygons (with holes) filled on the original
    img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR).copy()
    fill = img.copy()
    for p in wall_polys:
        rings = [p["outer"].astype(np.int32)] + [h.astype(np.int32) for h in p["holes"]]
        cv2.fillPoly(fill, rings, (40, 40, 230))
    img = cv2.addWeighted(fill, 0.55, img, 0.45, 0)
    for p in wall_polys:
        cv2.polylines(img, [p["outer"].astype(np.int32)], True, (0, 0, 160), 2, cv2.LINE_AA)
        for h in p["holes"]:
            cv2.polylines(img, [h.astype(np.int32)], True, (0, 120, 255), 1, cv2.LINE_AA)
    cv2.putText(img, f"{len(wall_polys)} wall polygons", (12, 28), _FONT, 0.8, (0, 0, 160), 2, cv2.LINE_AA)
    cv2.imwrite(str(out_dir / "walls_overlay.png"), img)

    # rooms overlay: colored regions + name/area labels, gap fills in magenta
    base = _faded(rgb)
    color_layer = base.copy()
    cols = _palette(len(rooms))
    for r, c in zip(rooms, cols):
        if r["mask"] is not None:
            color_layer[r["mask"]] = c
    img = cv2.addWeighted(color_layer, 0.55, base, 0.45, 0)
    img[walls_3d > 0] = (70, 70, 70)
    img[(gap_mask > 0) & (walls_3d == 0)] = (200, 0, 200)
    for r, c in zip(rooms, cols):
        if r["mask"] is not None:
            m = np.where(r["mask"], 255, 0).astype(np.uint8)
            cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(img, cnts, -1, tuple(int(v * 0.6) for v in c), 2, cv2.LINE_AA)
    for r in rooms:
        x, y = r["label_px"]
        cv2.circle(img, (x, y), 5, (0, 0, 0), -1)
        area = f"{r['area_sqft']:.0f} sqft" if r.get("area_sqft") is not None else r["status"]
        flag = "" if r["status"] == "ok" else f" [{r['status']}]"
        _text(img, [r["name"].replace("\n", " ")[:22], area + flag], (x, y + 26))
    cv2.imwrite(str(out_dir / "rooms_overlay.png"), img)
    return ["wall_mask.png", "closed_mask.png", "walls_overlay.png", "rooms_overlay.png"]
