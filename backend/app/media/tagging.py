"""Photo tagging: what each frame shows, and the listing-level amenity checklist.

Frames go to the vision chain BATCH at a time (several images per request, cached by image hash).
Per frame: room type, amenities from vocab.AMENITIES, flooring, wall color, light, condition,
reference objects (later used for sizing) and a short caption. Unknown values are dropped by
validation instead of trusted."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Callable, Optional

from pydantic import BaseModel, Field, field_validator

from . import vision_multi
from .vocab import AMENITIES, BY_ID, FLOORING, OBJECTS, ROOM_TYPES

BATCH = 10

PROMPT = f"""You are tagging photos of one apartment for its rental listing. The photos above are
labelled "Photo N". For EVERY photo return one entry; use only what is clearly visible in that photo,
never guess.

- room_type: one of {", ".join(ROOM_TYPES)}
- amenities: ids from this list that are clearly visible in THIS photo:
  {"; ".join(f"{a['id']} ({a['label']})" for a in AMENITIES)}
- flooring: one of {", ".join(FLOORING)}
- wall_color: the main wall paint as "#rrggbb", or null if no painted wall is visible
- natural_light: bright, some or dim
- windows: number of windows visible
- condition: at most 12 words (e.g. "updated, clean", "older cabinets, worn floor")
- objects: visible reference objects from: {", ".join(OBJECTS)}
- caption: at most 12 words, plain and factual

Return JSON only:
{{"frames": [{{"frame": 3, "room_type": "kitchen", "amenities": ["dishwasher"], "flooring": "tile",
"wall_color": "#efe9df", "natural_light": "some", "windows": 1, "condition": "updated, clean",
"objects": ["fridge", "stove", "kitchen counter"], "caption": "Galley kitchen with white cabinets"}}]}}"""


class FrameTag(BaseModel):
    frame: int
    room_type: str = "other"
    amenities: list[str] = Field(default_factory=list)
    flooring: str = "unknown"
    wall_color: Optional[str] = None
    natural_light: str = "some"
    windows: int = 0
    condition: str = ""
    objects: list[str] = Field(default_factory=list)
    caption: str = ""

    @field_validator("room_type", mode="before")
    @classmethod
    def _room(cls, v):
        v = str(v or "").strip().lower().replace("living room", "living").replace("bath", "bathroom").replace("bathroomroom", "bathroom")
        return v if v in ROOM_TYPES else "other"

    @field_validator("amenities", mode="before")
    @classmethod
    def _amen(cls, v):
        return [a for a in dict.fromkeys(str(x).strip().lower() for x in (v or [])) if a in BY_ID]

    @field_validator("flooring", mode="before")
    @classmethod
    def _floor(cls, v):
        v = str(v or "").strip().lower()
        return v if v in FLOORING else "unknown"

    @field_validator("wall_color", mode="before")
    @classmethod
    def _color(cls, v):
        v = str(v or "").strip().lower()
        return v if re.fullmatch(r"#[0-9a-f]{6}", v) else None

    @field_validator("natural_light", mode="before")
    @classmethod
    def _light(cls, v):
        v = str(v or "").strip().lower()
        return v if v in ("bright", "some", "dim") else "some"

    @field_validator("windows", mode="before")
    @classmethod
    def _windows(cls, v):
        try:
            return max(0, min(12, int(v)))
        except (TypeError, ValueError):
            return 0

    @field_validator("objects", mode="before")
    @classmethod
    def _objects(cls, v):
        return [o for o in dict.fromkeys(str(x).strip().lower() for x in (v or [])) if o in OBJECTS]

    @field_validator("condition", "caption", mode="before")
    @classmethod
    def _short(cls, v):
        return " ".join(str(v or "").split())[:120]


def parse_batch(ids: list[int]) -> Callable[[str], list[FrameTag]]:
    def parse(text: str) -> list[FrameTag]:
        data = json.loads(text[text.find("{"): text.rfind("}") + 1])
        tags = {t.frame: t for t in (FrameTag.model_validate(x) for x in data.get("frames", []))}
        missing = [i for i in ids if i not in tags]
        if len(missing) > len(ids) // 3:  # a few gaps are tolerated (left untagged); most missing is a bad answer
            raise ValueError(f"missing frames {missing}")
        return [tags[i] for i in ids if i in tags]
    return parse


def tag_frames(job_dir: Path, frames: list[dict], progress: Callable[[float, str], None] = lambda p, d: None) -> tuple[list[dict], dict]:
    """[FrameTag dict] for the frames (walk order) and {provider: calls} for the step detail."""
    out: list[dict] = []
    providers: dict[str, int] = defaultdict(int)
    batches = [frames[i:i + BATCH] for i in range(0, len(frames), BATCH)]
    for b, batch in enumerate(batches):
        progress(b / max(1, len(batches)), f"photos {batch[0]['id']}-{batch[-1]['id']} of {len(frames)}")
        images = [(f"Photo {f['id']}", vision_multi.jpeg(job_dir / f["file"])) for f in batch]
        tags, provider = vision_multi.vision_multi_json(images, PROMPT, parse_batch([f["id"] for f in batch]), kind="tags")
        providers[provider] += 1
        out += [t.model_dump() for t in tags]
    return out, dict(providers)


def checklist(tags: list[dict]) -> list[dict]:
    """Listing-level amenities: each with confidence and the frames that prove it. Seen in more frames
    = more confident; flooring and light add the matching floor / light tags."""
    ev: dict[str, list[int]] = defaultdict(list)
    for t in tags:
        for a in t["amenities"]:
            ev[a].append(t["frame"])
        floor = {"hardwood": "hardwood_floors", "carpet": "carpet", "tile": "tile_floors", "stone": "tile_floors"}.get(t["flooring"])
        if floor and t["frame"] not in ev[floor]:
            ev[floor].append(t["frame"])
        if "ceiling fan" in t["objects"] and t["frame"] not in ev["ceiling_fan"]:
            ev["ceiling_fan"].append(t["frame"])
    bright = [t["frame"] for t in tags if t["natural_light"] == "bright" and t["windows"] > 0]
    if len(bright) >= 2:
        ev["natural_light"] += [f for f in bright if f not in ev["natural_light"]]
    out = []
    for a in AMENITIES:
        frames = sorted(set(ev.get(a["id"], [])))
        if not frames:
            continue
        conf = round(min(0.95, 0.6 + 0.12 * (len(frames) - 1)), 2)
        out.append({"id": a["id"], "label": a["label"], "group": a["group"], "filter": a["filter"],
                    "confidence": conf, "evidence": frames})
    return out


def insight(amenities: list[dict], existing: list[str]) -> dict:
    """Found tags the listing didn't have, and how many of them are common renter filters."""
    have = set(existing)
    new = [a for a in amenities if a["id"] not in have]
    return {"new_tags": [a["id"] for a in new], "new_filter_matches": sum(1 for a in new if a["filter"]),
            "filters": [a["id"] for a in new if a["filter"]]}


def rooms_seen(tags: list[dict]) -> dict[str, int]:
    """Room types with how many frames show them (rooms are grouped properly in the walkthrough step)."""
    seen: dict[str, int] = defaultdict(int)
    for t in tags:
        seen[t["room_type"]] += 1
    return dict(seen)
