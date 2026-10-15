"""Load -> composite on white -> resize longest side to ~1600px -> grayscale."""
from __future__ import annotations

import io
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageOps


@dataclass
class Prepped:
    rgb: np.ndarray  # processed RGB, uint8 (h, w, 3)
    gray: np.ndarray  # processed grayscale, uint8 (h, w)
    scale: float  # processed_px = original_px * scale
    orig_w: int
    orig_h: int

    @property
    def w(self) -> int:
        return self.gray.shape[1]

    @property
    def h(self) -> int:
        return self.gray.shape[0]

    def png_bytes(self) -> bytes:
        ok, buf = cv2.imencode(".png", cv2.cvtColor(self.rgb, cv2.COLOR_RGB2BGR))
        if not ok:
            raise RuntimeError("PNG encode failed")
        return buf.tobytes()


def load_rgb(image_bytes: bytes) -> np.ndarray:
    try:
        im = Image.open(io.BytesIO(image_bytes))
        im.load()
    except (OSError, Image.DecompressionBombError) as e:
        raise ValueError(f"could not decode image: {e}") from e
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        im = Image.alpha_composite(Image.new("RGBA", im.size, (255, 255, 255, 255)), im)
    return np.array(im.convert("RGB"))


def preprocess(image_bytes: bytes, target_long_side: int = 1600) -> Prepped:
    rgb0 = load_rgb(image_bytes)
    h0, w0 = rgb0.shape[:2]
    scale = target_long_side / max(h0, w0)
    if abs(scale - 1.0) < 1e-3:
        rgb, scale = rgb0, 1.0
    else:
        interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR
        rgb = cv2.resize(rgb0, (round(w0 * scale), round(h0 * scale)), interpolation=interp)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    return Prepped(rgb=rgb, gray=gray, scale=scale, orig_w=w0, orig_h=h0)
