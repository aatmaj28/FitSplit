"""Option C, step A: measure each room in metres from its own frames with Depth Anything 3.

Ported from Tanvi Deshpande's layout maker, github.com/Tanvi-15/Layout-maker (v2p/measure.py, with
_dominant_angle from v2p/plan.py and _world_points from v2p/recon_vggt.py), kept as written.

OPTIONAL and OFF by default: it needs torch and Depth Anything 3, which are not in FitSplit's
requirements. To enable it: `pip install -r backend/requirements-da3.txt`, clone
https://github.com/ByteDance-Seed/Depth-Anything-3 into backend/third_party/ and
`pip install --no-deps --ignore-requires-python -e backend/third_party/Depth-Anything-3`,
then set DA3_MEASURE=1. Without them, available() is False and the engines skip this step.

For every room in timeline.json:
  1. take that room's frames (all visits),
  2. DA3-LARGE-1.1 (any-view) -> camera poses + depth (up to scale),
  3. DA3METRIC-LARGE (monocular) -> metric depth = focal * out / 300, used to fix the scale,
  4. floor plane (RANSAC) -> gravity; floor/ceiling heights -> room height (sanity check),
  5. wall-height slab -> Manhattan-aligned histograms -> strongest wall on each side -> width x depth.

Run in its own process: torch must not be loaded alongside pycolmap (duplicate libomp).
"""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import types
from pathlib import Path

import cv2
import numpy as np

from ..frames import ffmpeg_exe

ANYVIEW = "depth-anything/DA3-LARGE-1.1"
METRIC = "depth-anything/DA3METRIC-LARGE"


def enabled() -> bool:
    return os.getenv("DA3_MEASURE", "0") == "1"


def available() -> bool:
    """Depth Anything 3 and torch are installed (and the user turned it on)."""
    return enabled() and all(importlib.util.find_spec(m) is not None for m in ("torch", "depth_anything_3"))


def _device():
    import torch
    return torch.device("mps" if torch.backends.mps.is_available() else
                        "cuda" if torch.cuda.is_available() else "cpu")


def load_models(device):
    sys.modules.setdefault("pycolmap", types.ModuleType("pycolmap"))  # DA3 imports it only for COLMAP export
    from depth_anything_3.api import DepthAnything3
    anyview = DepthAnything3.from_pretrained(ANYVIEW).to(device).eval()
    metric = DepthAnything3.from_pretrained(METRIC).to(device).eval()
    return anyview, metric


def _dominant_angle(img: np.ndarray) -> float:
    """Manhattan-world assumption: find the wall orientation (mod 90 deg) from image gradients."""
    gx = cv2.Sobel(img, cv2.CV_32F, 1, 0, ksize=5)
    gy = cv2.Sobel(img, cv2.CV_32F, 0, 1, ksize=5)
    mag = np.hypot(gx, gy).ravel()
    ang = np.mod(np.arctan2(gy, gx).ravel(), np.pi / 2)
    hist, edges = np.histogram(ang, bins=180, range=(0, np.pi / 2), weights=mag)
    hist = np.convolve(np.r_[hist[-3:], hist, hist[:3]], np.ones(7) / 7, "valid")
    return float(edges[np.argmax(hist)] + (edges[1] - edges[0]) / 2)


def _world_points(extr, intr, depth):
    """Unproject depth maps (S,H,W) with OpenCV-convention cam_from_world extrinsics (S,3,4)."""
    S, H, W = depth.shape
    u, v = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    pts = np.empty((S, H, W, 3), np.float32)
    for i in range(S):
        K, R, t = intr[i], extr[i, :, :3], extr[i, :, 3]
        x = (u - K[0, 2]) / K[0, 0] * depth[i]
        y = (v - K[1, 2]) / K[1, 1] * depth[i]
        cam = np.stack([x, y, depth[i]], -1)
        pts[i] = (cam - t) @ R  # R^T (X_cam - t)
    return pts


def _dense_frames(video: Path, segs, out_dir: Path, fps: float = 8.0) -> list[Path]:
    """Re-decode a briefly-seen room at a higher frame rate (more views of the same walls)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for k, (a, b) in enumerate(segs):
        subprocess.run([ffmpeg_exe(), "-loglevel", "error", "-y", "-ss", str(a), "-to", str(b + 1),
                        "-i", str(video), "-vf", f"fps={fps}", "-q:v", "2",
                        str(out_dir / f"seg{k}_%04d.jpg")], check=True)
        paths += sorted(out_dir.glob(f"seg{k}_*.jpg"))
    return paths


def room_frames(timeline: dict, frame_dir: Path, fps: float, video: Path | None = None, max_frames: int = 40,
                min_frames: int = 24) -> dict[str, list[Path]]:
    frames = sorted(frame_dir.glob("*.jpg"))
    out: dict[str, list[Path]] = {}
    segs: dict[str, list] = {}
    for seg in timeline["segments"]:
        a, b = seg["t"]
        idx = range(int(a * fps), min(int((b + 1) * fps), len(frames)))
        out.setdefault(seg["room"], []).extend(frames[i] for i in idx)
        segs.setdefault(seg["room"], []).append((a, b))
    for room, fs in out.items():
        if len(fs) < min_frames and video is not None and video.exists():
            out[room] = _dense_frames(video, segs[room], frame_dir.parent / "frames_dense" / room)
    for room, fs in out.items():
        if len(fs) > max_frames:  # subsample evenly, keep all visits represented
            keep = np.linspace(0, len(fs) - 1, max_frames).round().astype(int)
            out[room] = [fs[i] for i in keep]
    return out


def _ransac_floor(pts, up0, cam_h_med, iters=300, tol=0.03, rng=None):
    """Plane with normal near up0, below the cameras, supported by the most points."""
    rng = rng or np.random.default_rng(0)
    h = pts @ up0
    cand = pts[h < cam_h_med - 0.3 * np.ptp(h)] if np.ptp(h) > 0 else pts
    if len(cand) < 100:
        return up0
    best, best_n = 0, up0
    for _ in range(iters):
        s = cand[rng.choice(len(cand), 3, replace=False)]
        n = np.cross(s[1] - s[0], s[2] - s[0])
        if np.linalg.norm(n) < 1e-9:
            continue
        n /= np.linalg.norm(n)
        if n @ up0 < 0:
            n = -n
        if n @ up0 < np.cos(np.radians(25)):
            continue
        inl = np.abs((cand - s[0]) @ n) < tol * np.ptp(h)
        if inl.sum() > best:
            best, best_n = inl.sum(), n
    return best_n


def _floor_ceiling_extreme(h, cam_h, rel=0.25):
    """Floor = LOWEST strong horizontal layer below the cameras, ceiling = HIGHEST above.

    (The densest layer can be a countertop or table in kitchens.)
    """
    span = np.percentile(h, 99.5) - np.percentile(h, 0.5)
    bins = np.arange(np.percentile(h, 0.5), np.percentile(h, 99.5) + span / 150, span / 150)
    hist, edges = np.histogram(h, bins=bins)
    hist = np.convolve(hist, np.ones(3) / 3, "same")
    centers = (edges[:-1] + edges[1:]) / 2

    def extreme(mask, pick):
        if not mask.any():
            return None
        strong = mask & (hist >= rel * hist[mask].max())
        return centers[strong][pick] if strong.any() else None

    floor = extreme(centers < cam_h, 0)
    ceil = extreme(centers > cam_h, -1)
    return (floor if floor is not None else np.percentile(h, 2),
            ceil if ceil is not None else np.percentile(h, 98))


def _walls_from_histogram(v, res=0.02, snap=0.35):
    """Room extent along one axis -> (lo, hi, strength).

    The room's observed points end at its walls: start from the 2nd/98th percentile
    of the wall slab, then snap each end to the strongest wall peak (an edge-on
    wall is a sharp histogram spike) within `snap` metres, if there is one.
    Strength = how much the snapped peaks stand out (low = no clear wall found).
    """
    lo0, hi0 = np.percentile(v, 2), np.percentile(v, 98)
    bins = np.arange(np.percentile(v, 0.2) - res, np.percentile(v, 99.8) + 2 * res, res)
    hist, edges = np.histogram(v, bins=bins)
    hist = np.convolve(hist, np.ones(5) / 5, "same")
    centers = (edges[:-1] + edges[1:]) / 2
    base = max(np.median(hist[hist > 0]), 1)

    def snap_to_peak(x0):
        near = np.abs(centers - x0) <= snap
        if not near.any():
            return x0, 0.0
        k = np.flatnonzero(near)[np.argmax(hist[near])]
        return float(centers[k]), float(hist[k] / base)

    (lo, s_lo), (hi, s_hi) = snap_to_peak(lo0), snap_to_peak(hi0)
    if hi - lo < 0.5:
        return None
    return lo, hi, min(s_lo, s_hi)


def measure_room(anyview, metric, frames: list[Path]) -> dict:
    import torch

    with torch.no_grad():
        paths = [str(p) for p in frames]
        pa = anyview.inference(paths)
        pm = metric.inference(paths)
    depth, conf = pa.depth, pa.conf
    extr, intr = pa.extrinsics, pa.intrinsics
    if pm.depth.shape != depth.shape:
        pm_depth = np.stack([cv2.resize(d, depth.shape[:0:-1]) for d in pm.depth])
    else:
        pm_depth = pm.depth

    # Metric scale: per-pixel ratio of metric depth to any-view depth, robust median.
    focal = (intr[:, 0, 0] + intr[:, 1, 1]) / 2
    metric_depth = focal[:, None, None] * pm_depth / 300.0
    good = conf > np.percentile(conf, 40)
    scale = float(np.median(metric_depth[good] / np.maximum(depth[good], 1e-6)))

    pts = _world_points(extr, intr, depth) * scale
    keep = good & (depth * scale > 0.35)  # drop fingers/hand right in front of the lens
    P = pts[keep]
    C = np.array([-e[:, :3].T @ e[:, 3] for e in extr]) * scale
    U = np.array([-e[:, :3].T @ np.array([0.0, 1.0, 0.0]) for e in extr])
    if len(P) > 400_000:
        P = P[np.random.default_rng(0).choice(len(P), 400_000, replace=False)]

    up0 = U.mean(0)
    up0 /= np.linalg.norm(up0)
    up = _ransac_floor(P, up0, np.median(C @ up0))
    h, cam_h = P @ up, C @ up
    floor, ceil = _floor_ceiling_extreme(h, np.median(cam_h))
    height = float(ceil - floor)

    # Horizontal basis and wall slab.
    a = np.array([1.0, 0, 0]) if abs(up[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = np.cross(up, a)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(up, e1)
    slab = P[(h > floor + 0.3 * height) & (h < floor + 0.8 * height)]
    xy = np.c_[slab @ e1, slab @ e2]

    # Manhattan alignment from a density image of the slab.
    res = 0.02
    o = xy.min(0)
    shape = tuple(np.ceil((xy.max(0) - o) / res).astype(int)[::-1] + 1)
    img = np.zeros(shape, np.float32)
    ij = ((xy - o) / res).astype(int)
    np.add.at(img, (ij[:, 1], ij[:, 0]), 1)
    theta = _dominant_angle(cv2.GaussianBlur(img, (0, 0), 1.5))
    R = np.array([[np.cos(-theta), -np.sin(-theta)], [np.sin(-theta), np.cos(-theta)]])
    xy = xy @ R.T

    wx = _walls_from_histogram(xy[:, 0])
    wy = _walls_from_histogram(xy[:, 1])
    out = {"frames": len(frames), "scale": round(scale, 4), "height_m": round(height, 2),
           "points": int(len(P)), "conf_median": round(float(np.median(conf)), 3)}
    if wx and wy:
        # Quality: share of wall-slab points lying on the box outline (a clean room is ~1.0).
        d = np.minimum.reduce([np.abs(xy[:, 0] - wx[0]), np.abs(xy[:, 0] - wx[1]),
                               np.abs(xy[:, 1] - wy[0]), np.abs(xy[:, 1] - wy[1])])
        inside = ((xy[:, 0] > wx[0] - 0.15) & (xy[:, 0] < wx[1] + 0.15) &
                  (xy[:, 1] > wy[0] - 0.15) & (xy[:, 1] < wy[1] + 0.15))
        out.update(dims_m=[round(wx[1] - wx[0], 2), round(wy[1] - wy[0], 2)],
                   outline_fraction=round(float(np.mean((d < 0.15) & inside)), 2))
    height_ok = 2.2 <= height <= 3.2
    # Few frames -> few walls seen; a high outline score from two walls means nothing.
    out["ok"] = bool(wx and wy and height_ok and len(frames) >= 12 and out.get("outline_fraction", 0) >= 0.6)
    return out


def measure_all(video: Path, timeline: dict, work_dir: Path, fps: float = 3.0) -> dict:
    """Her measure_all: frames at `fps` from the video, then every room in the timeline."""
    import torch

    frame_dir = work_dir / "da3_frames"
    frame_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run([ffmpeg_exe(), "-loglevel", "error", "-y", "-i", str(video), "-vf", f"fps={fps}", "-q:v", "2",
                    str(frame_dir / "frame_%05d.jpg")], check=True)
    per_room = room_frames(timeline, frame_dir, fps, video=video)
    device = _device()
    anyview, metric = load_models(device)
    results = {}
    for room, frames in per_room.items():
        if len(frames) < 4:
            results[room] = {"frames": len(frames), "ok": False, "reason": "too few frames"}
            continue
        try:
            results[room] = measure_room(anyview, metric, frames)
        except Exception as e:  # noqa: BLE001 - one bad room shouldn't stop the rest
            results[room] = {"frames": len(frames), "ok": False, "reason": repr(e)}
        if device.type == "mps":
            torch.mps.empty_cache()
    return results
