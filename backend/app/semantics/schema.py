"""Pydantic schema for the vision model's answer, plus a feet/inches parser.

The models are asked for strict JSON, but we stay lenient on details that are
easy to repair (type synonyms, 0-1000 coordinates, numbers as strings) and strict
on structure (missing rooms / label points fail validation -> retry / fallback).
"""
from __future__ import annotations

import re
from fractions import Fraction
from typing import Optional

from pydantic import BaseModel, Field, field_validator

ROOM_TYPES = ("bedroom", "bathroom", "kitchen", "living", "dining", "closet", "balcony", "foyer", "other")

_TYPE_SYNONYMS = {
    "bed": "bedroom", "bedrooms": "bedroom", "master": "bedroom", "master bedroom": "bedroom",
    "primary bedroom": "bedroom", "sleeping": "bedroom",
    "bath": "bathroom", "full bath": "bathroom", "half bath": "bathroom", "powder": "bathroom",
    "powder room": "bathroom", "wc": "bathroom", "toilet": "bathroom", "restroom": "bathroom",
    "living room": "living", "living/dining": "living", "family": "living", "family room": "living",
    "great room": "living", "lounge": "living",
    "dining room": "dining", "kitchenette": "kitchen",
    "walk-in closet": "closet", "walk in closet": "closet", "wic": "closet", "pantry": "closet",
    "wardrobe": "closet", "linen": "closet",
    "terrace": "balcony", "patio": "balcony", "deck": "balcony", "porch": "balcony",
    "entry": "foyer", "entrance": "foyer", "entryway": "foyer", "vestibule": "foyer",
}


def normalize_room_type(value: object) -> str:
    t = str(value or "").strip().lower()
    if t in ROOM_TYPES:
        return t
    if t in _TYPE_SYNONYMS:
        return _TYPE_SYNONYMS[t]
    return "other"


def _num(value: object) -> Optional[float]:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    m = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    return float(m.group()) if m else None


class SemRoom(BaseModel):
    name: str
    type: str
    label_center: list[float] = Field(description="[x, y] normalized 0..1 (0,0 = top-left)")
    dims_text: Optional[str] = None
    width_ft: Optional[float] = None
    length_ft: Optional[float] = None
    has_private_bath: Optional[bool] = None

    @field_validator("type", mode="before")
    @classmethod
    def _type(cls, v: object) -> str:
        return normalize_room_type(v)

    @field_validator("label_center", mode="before")
    @classmethod
    def _center(cls, v: object) -> list[float]:
        if isinstance(v, dict):
            v = [v.get("x"), v.get("y")]
        if not isinstance(v, (list, tuple)) or len(v) != 2:
            raise ValueError("label_center must be [x, y]")
        x, y = (_num(c) for c in v)
        if x is None or y is None:
            raise ValueError("label_center values must be numbers")
        if max(x, y) > 1.0:  # model answered in 0-1000 (Gemini habit) or percent
            div = 1000.0 if max(x, y) > 100.0 else 100.0
            x, y = x / div, y / div
        return [min(max(x, 0.0), 1.0), min(max(y, 0.0), 1.0)]

    @field_validator("width_ft", "length_ft", mode="before")
    @classmethod
    def _ft(cls, v: object) -> Optional[float]:
        n = _num(v)
        return n if n and n > 0 else None

    @field_validator("dims_text", mode="before")
    @classmethod
    def _dims_text(cls, v: object) -> Optional[str]:
        s = str(v).strip() if v is not None else ""
        return s or None


class Semantics(BaseModel):
    is_3d_render: bool = False
    rooms: list[SemRoom]
    total_sqft: Optional[float] = None
    beds: Optional[float] = None
    baths: Optional[float] = None

    @field_validator("total_sqft", "beds", "baths", mode="before")
    @classmethod
    def _numbers(cls, v: object) -> Optional[float]:
        return _num(v)


# --------------------------------------------------------------------------- dims

_QUOTES = {
    "’": "'", "‘": "'", "′": "'", "`": "'", "´": "'",
    "”": '"', "“": '"', "″": '"', "''": '"',
}
_FRACTION_CHARS = {"½": "1/2", "¼": "1/4", "¾": "3/4"}
# a number with an optional fraction: 7, 7.5, 7-1/2, 7 1/2, 1/2
_NUM = r"(?:\d+(?:\.\d+)?(?:\s*[- ]\s*\d+\s*/\s*\d+)?|\d+\s*/\s*\d+)"
_SIDE = re.compile(
    rf"^\s*(?:(?P<ft>{_NUM})\s*')?\s*-?\s*(?:(?P<inch>{_NUM})\s*\"?)?\s*[a-z]*\s*$", re.IGNORECASE
)


def _to_float(token: str) -> float:
    token = token.strip()
    parts = re.split(r"\s*[- ]\s*(?=\d+\s*/)", token)  # "7-1/2" -> ["7", "1/2"]
    return float(sum(Fraction(p.replace(" ", "")) for p in parts))


def _parse_side(side: str) -> Optional[float]:
    s = side.strip()
    if not s:
        return None
    if "'" not in s and '"' not in s:  # bare number -> feet ("15 x 11")
        m = re.fullmatch(rf"\s*({_NUM})\s*[a-z]*\s*", s, re.IGNORECASE)
        return _to_float(m.group(1)) if m else None
    m = _SIDE.match(s)
    if not m or (m.group("ft") is None and m.group("inch") is None):
        return None
    ft = _to_float(m.group("ft")) if m.group("ft") else 0.0
    inch = _to_float(m.group("inch")) if m.group("inch") else 0.0
    if m.group("ft") is None and '"' not in s:
        return None
    return ft + inch / 12.0


def parse_dims_text(text: Optional[str]) -> Optional[tuple[float, float]]:
    """Parse printed room dimensions into decimal feet, keeping the printed order.

    "17'10\" x 10'10\"" -> (17.83, 10.83); "7-1/2' x 5'" -> (7.5, 5.0);
    "11'3\"w x 11'1\"h" -> (11.25, 11.08); "15' x 11'" -> (15.0, 11.0)
    """
    if not text:
        return None
    s = text
    for k, v in _QUOTES.items():
        s = s.replace(k, v)
    for k, v in _FRACTION_CHARS.items():
        s = s.replace(k, " " + v)
    sides = re.split(r"\s*[x×X\*]\s*(?=\d)", s)
    if len(sides) != 2:
        return None
    try:
        a, b = _parse_side(sides[0]), _parse_side(sides[1])
    except (ValueError, ZeroDivisionError):
        return None
    if not a or not b or a > 200 or b > 200:
        return None
    return round(a, 2), round(b, 2)
