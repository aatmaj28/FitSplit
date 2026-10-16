"""Frames from an uploaded video or photos, ready for vision.

Video: sample ~2 fps with ffmpeg (imageio-ffmpeg's bundled binary, so iPhone .mov/HEVC works on any
laptop; HDR clips are tone mapped when the build supports it), drop blurry frames (Laplacian
variance) and near duplicates (dHash), keep at most MAX_FRAMES in walk order with timestamps.
Photos: HEIC via pillow-heif, EXIF rotation applied, the same quality filter, upload order kept.
Every kept frame is downscaled to VISION_SIDE px and saved as frames/fNNN.jpg in the job folder.
"""
from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np
from PIL import Image, ImageOps

VIDEO_EXT = {".mov", ".mp4", ".m4v", ".avi", ".webm", ".mkv", ".3gp", ".hevc"}
PHOTO_EXT = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".bmp", ".tif", ".tiff"}
SAMPLE_FPS = 2.0
MAX_FRAMES = 50
VISION_SIDE = 1024
BLUR_ABS = 25.0   # photos: Laplacian variance below this (at 1024 px) is blurry, unless the whole set is soft
BLUR_REL = 0.35   # below 35% of the clip's (or set's) median sharpness is a blurry, moving frame
MIN_SHARP = 2.0   # video: a window whose best frame is below this is blank or all blur
WINDOW_S = 1.5    # video: keep the sharpest frame of each window of the walk
DUP_BITS = 6      # dHash distance at or below this = a near duplicate of the last kept frame


@dataclass
class Frame:
    id: int                  # 1-based, walk order after filtering
    file: str                # "frames/f001.jpg", relative to the job folder
    t: Optional[float]       # seconds into the video (None for photos)
    source: str              # original file name
    sharpness: float
    hash: str                # dHash, 16 hex digits
    width: int
    height: int

    def to_dict(self) -> dict:
        return asdict(self)


def ffmpeg_exe() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def register_heif() -> None:
    try:
        import pillow_heif

        pillow_heif.register_heif_opener()
    except ImportError:  # HEIC then fails with a clear "cannot identify image" error
        pass


def kind_of(name: str) -> Optional[str]:
    ext = Path(name).suffix.lower()
    return "video" if ext in VIDEO_EXT else "photo" if ext in PHOTO_EXT else None


def sharpness(gray: np.ndarray) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def dhash(gray: np.ndarray) -> int:
    small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    bits = (small[:, 1:] > small[:, :-1]).flatten()
    return int(sum(1 << i for i, b in enumerate(bits) if b))


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def _is_hdr(path: Path) -> bool:
    """ffmpeg prints the stream info to stderr; HLG / PQ transfer = HDR (iPhone default)."""
    out = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(path)], capture_output=True, text=True, timeout=60)
    return bool(re.search(r"arib-std-b67|smpte2084|bt2020", out.stderr))


def sample_video(path: Path, tmp: Path, fps: float = SAMPLE_FPS, side: int = VISION_SIDE) -> list[tuple[Path, float]]:
    """JPEG frames at `fps`, longest side <= `side` (rotation from metadata applied by ffmpeg)."""
    tmp.mkdir(parents=True, exist_ok=True)
    scale = f"scale='if(gt(iw,ih),min({side},iw),-2)':'if(gt(iw,ih),-2,min({side},ih))'"
    chains = [f"fps={fps},{scale}"]
    if _is_hdr(path):  # tone map to SDR when the build has zscale; otherwise the plain chain below
        chains.insert(0, f"fps={fps},zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
                         f"tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,{scale}")
    last: Optional[subprocess.CompletedProcess] = None
    for vf in chains:
        for f in tmp.glob("raw_*.jpg"):
            f.unlink()
        last = subprocess.run([ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
                               "-vf", vf, "-q:v", "3", str(tmp / "raw_%05d.jpg")], capture_output=True, text=True, timeout=1800)
        if last.returncode == 0 and any(tmp.glob("raw_*.jpg")):
            break
    files = sorted(tmp.glob("raw_*.jpg"))
    if not files:
        raise ValueError(f"could not read video {path.name}: {(last.stderr if last else '').strip()[-300:]}")
    return [(f, round(i / fps, 2)) for i, f in enumerate(files)]


def load_photo(path: Path, side: int = VISION_SIDE) -> Image.Image:
    register_heif()
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im.thumbnail((side, side), Image.LANCZOS)
    return im


def _measure(img_path: Path) -> tuple[float, int]:
    gray = cv2.imread(str(img_path), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise ValueError(f"unreadable frame {img_path.name}")
    return sharpness(gray), dhash(gray)


def select(cands: list[dict], *, video: bool, max_frames: int = MAX_FRAMES) -> list[dict]:
    """Video: the sharpest frame of each WINDOW_S window of the walk (so every part of it is
    covered), unless the window is all blur next to the rest of the clip. Sharpness is relative to
    the clip: compressed or tone-mapped HDR footage is soft all over, so a fixed floor would keep
    almost nothing. Photos: drop the ones much blurrier than the set. Then drop near duplicates of
    the last kept frame (keeping the sharper one) and thin evenly to max_frames, in order."""
    if not cands:
        return []
    median = float(np.median([c["sharp"] for c in cands]))
    if video:
        floor = max(MIN_SHARP, BLUR_REL * median)
        windows: dict[int, dict] = {}
        for c in cands:
            w = int((c["t"] or 0.0) // WINDOW_S)
            if w not in windows or c["sharp"] > windows[w]["sharp"]:
                windows[w] = c
        pool = sorted(windows.values(), key=lambda c: c["order"])
    else:
        floor = min(BLUR_ABS, BLUR_REL * median)
        pool = cands
    kept: list[dict] = []
    for c in pool:
        if c["sharp"] < floor:
            continue
        if kept and hamming(c["hash"], kept[-1]["hash"]) <= DUP_BITS:
            if c["sharp"] > kept[-1]["sharp"]:
                kept[-1] = c
            continue
        kept.append(c)
    if not kept:  # everything looked soft: keep the sharpest few rather than nothing
        kept = sorted(cands, key=lambda c: -c["sharp"])[: min(len(cands), 8)]
        kept.sort(key=lambda c: c["order"])
    if len(kept) > max_frames:
        idx = sorted(set(np.linspace(0, len(kept) - 1, max_frames).round().astype(int).tolist()))
        kept = [kept[i] for i in idx]
    return kept


def extract(inputs: list[Path], job_dir: Path, progress: Callable[[float, str], None] = lambda p, d: None,
            max_frames: int = MAX_FRAMES) -> tuple[list[Frame], dict]:
    """Kept frames (saved under job_dir/frames) and stats for the step detail."""
    frames_dir, tmp = job_dir / "frames", job_dir / "_tmp"
    shutil.rmtree(frames_dir, ignore_errors=True)
    shutil.rmtree(tmp, ignore_errors=True)
    frames_dir.mkdir(parents=True)
    tmp.mkdir(parents=True)
    cands: list[dict] = []
    videos = [p for p in inputs if kind_of(p.name) == "video"]
    photos = [p for p in inputs if kind_of(p.name) == "photo"]
    for v in videos:
        progress(0.1, f"reading {v.name}")
        for f, t in sample_video(v, tmp / v.stem):
            cands.append({"path": f, "t": t, "source": v.name})
    for i, p in enumerate(photos):
        progress(0.1 + 0.6 * i / max(1, len(photos)), f"reading {p.name}")
        out = tmp / f"photo_{i:04d}.jpg"
        load_photo(p).save(out, "JPEG", quality=92)
        cands.append({"path": out, "t": None, "source": p.name})
    for i, c in enumerate(cands):
        c["order"] = i
        c["sharp"], c["hash"] = _measure(c["path"])
    progress(0.8, f"filtering {len(cands)} frames")
    kept = select(cands, video=bool(videos), max_frames=max_frames)
    frames = []
    for i, c in enumerate(kept, 1):
        name = f"frames/f{i:03d}.jpg"
        with Image.open(c["path"]) as im:
            im = im.convert("RGB")
            im.save(job_dir / name, "JPEG", quality=86)
            w, h = im.size
        frames.append(Frame(i, name, c["t"], c["source"], round(c["sharp"], 1), f"{c['hash']:016x}", w, h))
    shutil.rmtree(tmp, ignore_errors=True)
    stats = {"sampled": len(cands), "kept": len(frames), "videos": len(videos), "photos": len(photos)}
    return frames, stats
