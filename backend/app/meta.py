"""/data/floorplans/meta.json: total_sqft, rent, beds, baths per image filename."""
from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

from .config import FLOORPLANS_DIR, META_PATH


def load_meta() -> dict[str, dict]:
    try:
        data = json.loads(META_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return {k: v for k, v in data.items() if isinstance(v, dict)}


@lru_cache(maxsize=256)
def _file_hash(path: str, mtime: float) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def lookup_meta(filename: Optional[str], image_hash: str) -> tuple[Optional[dict], Optional[str]]:
    """Match by filename (or stem), else by identical image bytes in /data/floorplans."""
    meta = load_meta()
    if not meta:
        return None, None
    if filename:
        base = Path(filename).name
        if base in meta:
            return meta[base], base
        stem = Path(base).stem
        for key in meta:
            if Path(key).stem == stem:
                return meta[key], key
    for key in meta:
        p = FLOORPLANS_DIR / key
        if p.is_file() and _file_hash(str(p), p.stat().st_mtime) == image_hash:
            return meta[key], key
    return None, None
