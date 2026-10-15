"""Disk cache for LLM results, so nothing is ever generated twice:
data/llm/cache/<purpose>/<sha256 of the key parts>.json"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional

from .usage import LLM_DIR

CACHE_DIR = LLM_DIR / "cache"


def key_of(parts: Any) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def get(purpose: str, key: str) -> Optional[dict]:
    path = CACHE_DIR / purpose / f"{key}.json"
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def put(purpose: str, key: str, value: Any, **meta: Any) -> dict:
    entry = {"value": value, "created": datetime.now(timezone.utc).isoformat(timespec="seconds"), **meta}
    path = CACHE_DIR / purpose / f"{key}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entry, indent=2, ensure_ascii=False))
    return entry
