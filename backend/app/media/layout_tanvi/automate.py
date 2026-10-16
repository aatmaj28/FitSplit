"""Workflow A, automated: the video's contact sheets -> her timeline + whole-apartment layout.

Tanvi Deshpande's layout maker (github.com/Tanvi-15/Layout-maker) does this step by hand: Claude, in
a chat, reads the time-stamped sheets and writes timeline.json and layout.json (her README: "a
Gemini/Claude API step can automate it later"). This module is that API step. The prompt is built
from her own instructions: README step 3, the format notes in v2p/layout.py, her JSON schema
(SCHEMA), her sizing cues (doors about 0.8 m, windows 0.8-0.9 m, a queen bed about 1.5 x 2.0 m)
and one of her finished layouts (apt2, a different apartment) as the example, as her README points
the reader to a full example. One vision call reads every sheet; the answer is cached by the sheet
images like every other FitSplit model call.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Optional

from pydantic import BaseModel, Field, field_validator

from .. import vision_multi
from ..frames import kind_of
from .schema import OPENING_TYPES, ROOM_TYPES, SCHEMA, validate
from .sheets import make_sheets

EXAMPLE = json.loads((Path(__file__).with_name("example_layout.json")).read_text())
MAX_TOKENS = 16000
TIMEOUT_S = 300.0  # one answer holds the whole apartment and its timeline

PROMPT = f"""The images above are contact sheets of a handheld walkthrough video of one apartment: one tile
per second of video, in order, each stamped with its time ("16s"). Read every sheet, the way a
person drawing the floor plan frame by frame would, and write two things.

1. timeline: which seconds show which room, one segment per continuous stretch:
   {{"t": [start_s, end_s], "room": "<room id>", "label": "<what you see>", "objects": ["..."]}}
   Use the same room id every time the walker comes back to a room. Use "outside_front" for the
   street side before the unit and "outside" for anything else outside it.

2. layout: the whole apartment as a schematic floor plan.
   - Coordinates are metres: x across the building, y depth from the front (street) side, so y
     grows toward the back.
   - Each room: id (the timeline's ids), type (one of {", ".join(ROOM_TYPES)}), label, rect
     [x, y, w, h] (its bounding box), confidence 0-1, evidence_s (seconds that show it), features.
   - polygon (optional): the exact outline for bays, L shapes and angled walls, as [[x, y], ...]
     inside its rect.
   - Rooms that share a wall share that x or y line, and rooms never overlap.
   - openings: each door, open passage, window and bay window as a segment [[x1, y1], [x2, y2]] on
     the wall it sits in, type one of {", ".join(OPENING_TYPES)}, with the rooms it joins.
   - Sizes are estimates from visual cues: doors are about 0.8 m wide, windows about 0.8-0.9 m, a
     queen bed about 1.5 x 2.0 m. Count how many fit along each wall.
   - notes: what the video can't confirm.

An example layout written the same way, for a different apartment:
{json.dumps(EXAMPLE, separators=(",", ":"))}

The layout follows this JSON schema:
{json.dumps(SCHEMA, separators=(",", ":"))}

Return JSON only: {{"timeline": {{"segments": [...]}}, "layout": {{"units": "m", "rooms": [...], "openings": [...], "notes": "..."}}}}"""


class Segment(BaseModel):
    t: list[float]
    room: str
    label: str = ""
    objects: list[str] = Field(default_factory=list)

    @field_validator("t", mode="before")
    @classmethod
    def _t(cls, v):
        a, b = (float(x) for x in list(v)[:2])
        return [min(a, b), max(a, b)]


class Room(BaseModel):
    id: str
    type: str
    label: str
    rect: list[float]
    confidence: float = 0.5
    evidence_s: list[float] = Field(default_factory=list)
    features: list[str] = Field(default_factory=list)
    polygon: Optional[list[list[float]]] = None

    @field_validator("type", mode="before")
    @classmethod
    def _type(cls, v):
        v = str(v or "").strip().lower().replace(" ", "_")
        return v if v in ROOM_TYPES else "other"

    @field_validator("rect")
    @classmethod
    def _rect(cls, v):
        if len(v) != 4 or v[2] <= 0 or v[3] <= 0:
            raise ValueError("rect must be [x, y, w, h] with a positive size")
        return [round(float(x), 3) for x in v]


class Opening(BaseModel):
    type: str
    wall: list[list[float]]
    rooms: list[str] = Field(default_factory=list)

    @field_validator("type", mode="before")
    @classmethod
    def _type(cls, v):
        v = str(v or "").strip().lower().replace(" ", "_")
        return v if v in OPENING_TYPES else "opening"


class Layout(BaseModel):
    units: str = "m"
    rooms: list[Room]
    openings: list[Opening] = Field(default_factory=list)
    notes: str = ""


def prompt_for(stamps: str) -> str:
    """Photo uploads get the same instructions with photo numbers instead of seconds."""
    if stamps == "seconds":
        return PROMPT
    return PROMPT.replace('one tile\nper second of video, in order, each stamped with its time ("16s")',
                          'one tile\nper photo, in upload order, each stamped with its number ("#16"); use those numbers where seconds are asked for')


def parse_answer(text: str) -> dict:
    """{"timeline", "layout", "problems"}; her validate() problems are kept as warnings, a layout
    with fewer than two rooms or broken rooms is rejected (the chain retries once)."""
    data = json.loads(text[text.find("{"): text.rfind("}") + 1])
    lay = Layout.model_validate(data.get("layout") or {})
    if len(lay.rooms) < 2:
        raise ValueError("a layout needs at least two rooms")
    segs = [Segment.model_validate(s) for s in (data.get("timeline") or {}).get("segments", [])]
    layout = lay.model_dump(exclude_none=True)
    ids = {r["id"] for r in layout["rooms"]}
    for o in layout["openings"]:  # an opening may name the outside; only rooms on the plan count
        o["rooms"] = [r for r in o["rooms"] if r in ids]
    layout["openings"] = [o for o in layout["openings"] if len(o["wall"]) == 2 and all(len(p) == 2 for p in o["wall"])]
    return {"timeline": {"segments": [s.model_dump() for s in segs]}, "layout": layout, "problems": validate(layout)}


def read_layout(job: dict, d: Path, progress: Callable[[float, str], None] = lambda p, m: None) -> dict:
    """Her Workflow A on a FitSplit media job: sheets from the uploaded video (or the photos), one
    vision call, her timeline + layout. Stored on the job as job["tanvi"]."""
    inputs = [d / "input" / i["name"] for i in job["inputs"]]
    video = next((p for p in inputs if kind_of(p.name) == "video" and p.exists()), None)
    if video is not None:
        sheets = make_sheets(video=video)
    else:  # photos, or the video is gone: the kept frames, numbered
        sheets = make_sheets(photos=[d / f["file"] for f in job["frames"]])
    progress(0.1, f"reading the whole apartment from {len(sheets)} contact sheets (Tanvi's method)")
    images = [(s["label"], s["jpeg"]) for s in sheets]
    stamps = "seconds" if video is not None else "photo numbers"
    out, provider = vision_multi.vision_multi_json(images, prompt_for(stamps), parse_answer, kind="tanvi_layout",
                                                   max_tokens=MAX_TOKENS, timeout_s=TIMEOUT_S)
    out["provider"] = provider
    out["sheets"] = len(sheets)
    out["stamps"] = stamps
    return out
