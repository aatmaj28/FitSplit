"""Result + semantics caches under /data/parsed.

data/parsed/<name>[__variant].json   final output (variant = non-default params)
data/parsed/<name>[__variant]/       debug images
data/parsed/_semantics/<hash16>_<provider>.json   raw vision answers, reused offline

Results are looked up by image hash (+ the params that change the output), so a
renamed upload of a known plan is still a cache hit and the demo runs offline.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
from pathlib import Path
from typing import Optional

from PIL import Image

from .config import PARSED_DIR, PROVIDER_ORDER, SEMANTICS_CACHE_DIR
from .semantics.prompt import PROMPT_VERSION


def image_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cache_key(provider: Optional[str], wall_style: Optional[str], ppf: Optional[float]) -> str:
    return f"provider={provider or 'chain'}|wall_style={wall_style or 'auto'}|ppf={ppf if ppf else '-'}"


def variant_suffix(provider: Optional[str], wall_style: Optional[str], ppf: Optional[float]) -> str:
    parts = []
    if provider:
        parts.append(provider)
    if wall_style and wall_style != "auto":
        parts.append(wall_style)
    if ppf:
        parts.append(f"ppf{ppf:g}")
    return ("__" + "_".join(parts)) if parts else ""


def safe_name(filename: Optional[str]) -> str:
    stem = Path(filename or "upload").stem
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", stem).strip("._") or "upload"


def result_path(name: str) -> Path:
    return PARSED_DIR / f"{name}.json"


def find_result(img_hash: str, key: str) -> Optional[dict]:
    for p in sorted(PARSED_DIR.glob("*.json")):
        try:
            data = json.loads(p.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if data.get("image_hash") == img_hash and data.get("cache_key") == key:
            return data
    return None


def name_taken_by_other_image(name: str, img_hash: str) -> bool:
    p = result_path(name)
    if not p.exists():
        return False
    try:
        return json.loads(p.read_text()).get("image_hash") != img_hash
    except (OSError, json.JSONDecodeError):
        return False


def save_result(name: str, result: dict) -> Path:
    PARSED_DIR.mkdir(parents=True, exist_ok=True)
    p = result_path(name)
    p.write_text(json.dumps(result, indent=2))
    return p


def _semantics_path(img_hash: str, provider: str) -> Path:
    return SEMANTICS_CACHE_DIR / f"{img_hash[:16]}_{provider}.json"


def load_semantics(img_hash: str, provider: Optional[str], prefer: Optional[str] = None) -> Optional[dict]:
    """Cached vision answer for a forced provider, or the best one available for the chain
    (`prefer` first, e.g. the provider an existing result was built from)."""
    order = [provider] if provider else ([prefer] if prefer else []) + [p for p in PROVIDER_ORDER if p != prefer]
    for name in order:
        p = _semantics_path(img_hash, name)
        if not p.exists():
            continue
        try:
            data = json.loads(p.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if data.get("image_hash") == img_hash and data.get("prompt_version") == PROMPT_VERSION:
            return data
    return None


def save_semantics(img_hash: str, provider: str, payload: dict) -> None:
    SEMANTICS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _semantics_path(img_hash, provider).write_text(json.dumps(payload, indent=2))


def cached_plans() -> list[str]:
    return sorted(p.stem for p in PARSED_DIR.glob("*.json"))


_IMAGE_EXT = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp", "BMP": ".bmp", "GIF": ".gif", "TIFF": ".tif"}


def save_original(name: str, data: bytes) -> str:
    """Keep the uploaded bytes next to the result so /api/plans/{name}/image can serve them."""
    with Image.open(io.BytesIO(data)) as im:
        ext = _IMAGE_EXT.get(im.format or "", ".png")
    folder = PARSED_DIR / name
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("original.*"):
        old.unlink()
    (folder / f"original{ext}").write_bytes(data)
    return f"{name}/original{ext}"


def original_image_path(name: str) -> Optional[Path]:
    hits = sorted((PARSED_DIR / name).glob("original.*"))
    return hits[0] if hits else None
