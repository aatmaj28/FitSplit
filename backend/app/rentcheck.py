"""AI check of a rent split's INPUTS (POST /api/rent-check).

The browser does the math (frontend/src/rentSplit.ts) and sends its inputs and results. One vision
call (floor plan image + those inputs; Gemini -> Claude -> Groq) checks what code can't see:
bedroom count, which bedroom really has a private bath, whether areas look right vs the drawing
(+-15%), and extras that make a split unfair (own balcony, walk-in closet). The model never
changes a number: its suggestions are limited to input toggles the user may apply, and an
explanation quoting any amount we didn't send is replaced by one written from a template.

Results are cached by an input key that the browser computes the same way (rentCheckKey in
frontend/src/rentCheck.ts), in data/rentcheck/<key>.json, and exported to
frontend/public/demo/rentcheck/ for offline demos (scripts/precompute-rentcheck.mjs).
"""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field

from .config import DATA_DIR, FLOORPLANS_DIR, PARSED_DIR
from .llm import usage
from .llm.vision import vision_json

CACHE_DIR = DATA_DIR / "rentcheck"
PROMPT_VERSION = "rc1"
CHECK_IDS = ("bedroom_count", "private_bath", "areas", "extras")


class NotCached(LookupError):
    pass


class PlanNotFound(LookupError):
    pass


class RentRow(BaseModel):
    room_id: str
    name: str
    bedroom_area: float
    private_bath: bool
    private_bath_area: float = 0
    share: int
    vs_even: int


class RentCheckRequest(BaseModel):
    plan: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
    method: Literal["fair", "size"]
    include_closets: bool
    rent: int = Field(gt=0)
    rows: list[RentRow] = Field(min_length=1, max_length=8)
    private_portion: Optional[float] = None
    shared_portion: Optional[float] = None
    shared_each: Optional[float] = None


# ----------------------------------------------------------------------------- input key

def _r10(x: float) -> int:
    return math.floor(x * 10 + 0.5)  # == JS Math.round(x * 10) for the positive areas used here


def key_string(req: RentCheckRequest) -> str:
    rows = sorted(req.rows, key=lambda r: r.room_id)
    body = ";".join(f"{r.room_id}:{_r10(r.bedroom_area)}:{int(r.private_bath)}:{_r10(r.private_bath_area)}:{r.share}" for r in rows)
    return f"{PROMPT_VERSION}|{req.plan}|{req.method}|{int(req.include_closets)}|{req.rent}|{body}"


def _fnv1a(data: bytes, seed: int) -> int:
    h = (0x811C9DC5 ^ seed) & 0xFFFFFFFF
    for b in data:
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def input_key(req: RentCheckRequest) -> str:
    """16 hex chars; same function in the browser (no crypto.subtle needed, works over plain http)."""
    data = key_string(req).encode()
    return f"{_fnv1a(data, 0):08x}{_fnv1a(data, 0x9E3779B9):08x}"


# ----------------------------------------------------------------------------- prompt

PROMPT = """You are double-checking the INPUTS of a roommate rent split for the apartment floor plan in the image.
Code already did all the math. Never compute, change or invent any number.

Listing: {listing}, rent ${rent:,}/month.
Split method: {method}
Attached closets counted in bedroom areas: {closets}.

Bedrooms as the roommates entered them (position = where the room's label is in the image, % from left / % from top):
{rows}

Other rooms on the plan: {others}

Look at the drawing and check:
1. "bedroom_count": does the plan show exactly {n} bedroom(s)?
2. "private_bath": is each bedroom's private-bath flag right? A private bath is a bathroom you can only reach through that bedroom.
3. "areas": does each bedroom's area look plausible for its printed dimensions and drawn size (within 15%)?
4. "extras": anything that makes one bedroom clearly better or worse that its area misses (its own balcony, a walk-in closet, no window). Only mention what you can see in the drawing.

Return ONLY this JSON (no markdown):
{{"checks": [{{"id": "bedroom_count" | "private_bath" | "areas" | "extras", "status": "pass" | "warn", "reason": "<one short sentence>"}}],
 "suggestions": [{{"action": "set_private_bath", "bedroom": <bedroom number>, "value": true | false, "reason": "<short>"}} | {{"action": "include_closets", "value": true | false, "reason": "<short>"}}],
 "explanation": "<2-3 friendly sentences for the roommates: who pays more or less than an even split and why. Quote only dollar amounts listed above.>"}}
Exactly one entry per check id. "suggestions" is [] when the inputs look right; only suggest changing the inputs above.
"""

METHODS = {
    "fair": "fair split: each bedroom's own area (plus its private bath) is private; that share of the rent is split by private area and the rest (shared space) equally",
    "size": "by room size only: the whole rent is split in proportion to bedroom area",
}


def _money(v: float) -> str:
    return f"${round(v):,}"


def _ctx(req: RentCheckRequest) -> dict:
    path = PARSED_DIR / f"{req.plan}.json"
    if not path.exists():
        raise PlanNotFound(req.plan)
    plan = json.loads(path.read_text())
    rooms = {r["id"]: r for r in plan["rooms"]}
    missing = [r.room_id for r in req.rows if r.room_id not in rooms]
    if missing:
        raise ValueError(f"unknown room ids for {req.plan}: {missing}")
    return {"plan": plan, "rooms": rooms, "w": plan["image_size"]["w"], "h": plan["image_size"]["h"]}


def build_prompt(req: RentCheckRequest, ctx: dict) -> str:
    unit = ctx["plan"].get("unit") or {}
    n = len(req.rows)
    even = req.rent / n
    lines = []
    for i, row in enumerate(req.rows, 1):
        room = ctx["rooms"][row.room_id]
        x, y = room.get("label_point") or (0, 0)
        diff = "the same as an even split" if row.vs_even == 0 else \
            f"{_money(abs(row.vs_even))} {'more' if row.vs_even > 0 else 'less'} than an even split of {_money(even)}"
        bath = f"yes ({round(row.private_bath_area)} sq ft bathroom counted as private)" if row.private_bath and req.method == "fair" \
            else ("yes" if row.private_bath else "no")
        lines.append(f'- Bedroom {i} "{row.name}": label at {round(100 * x / ctx["w"])}% / {round(100 * y / ctx["h"])}%; '
                     f'printed dims {room.get("printed_dims_text") or "not printed"}; area used {round(row.bedroom_area)} sq ft; '
                     f"private bath: {bath}; pays {_money(row.share)}/month ({diff}).")
    bed_ids = {r.room_id for r in req.rows}
    others = [f'{r["name"]} ({r["type"]}, {round(100 * r["label_point"][0] / ctx["w"])}% / {round(100 * r["label_point"][1] / ctx["h"])}%)'
              for r in ctx["plan"]["rooms"] if r["id"] not in bed_ids and r.get("label_point")]
    listing = ", ".join(x for x in [
        f"{unit['beds']} bed" if unit.get("beds") is not None else None,
        f"{unit['baths']} bath" if unit.get("baths") is not None else None,
        f"{unit['total_sqft']:,} sq ft total" if unit.get("total_sqft") else None,
    ] if x) or "unit details unknown"
    return PROMPT.format(listing=listing, rent=req.rent, method=METHODS[req.method],
                         closets="yes" if req.include_closets else "no", rows="\n".join(lines),
                         others="; ".join(others) or "none", n=n)


# ----------------------------------------------------------------------------- validation

class Check(BaseModel):
    id: Literal["bedroom_count", "private_bath", "areas", "extras"]
    status: Literal["pass", "warn"]
    reason: str


class Suggestion(BaseModel):
    action: Literal["set_private_bath", "include_closets"]
    room_id: Optional[str] = None
    value: bool
    reason: str
    label: str  # button text, written by code


class RentCheck(BaseModel):
    key: str
    plan: str
    verdict: Literal["ok", "warn"]
    checks: list[Check]
    suggestions: list[Suggestion]
    explanation: str
    explanation_source: Literal["ai", "template"]
    provider: str
    model: str
    checked_at: str
    inputs: dict  # what was checked: method, closets, rent, bedrooms (for the UI and the cache files)


_STATUS = {"pass": "pass", "ok": "pass", "yes": "pass", "warn": "warn", "warning": "warn", "fail": "warn", "no": "warn"}


def parse_reply(text: str) -> dict:
    """Loose structural parse (raises ValueError -> one retry); semantic cleanup happens in finalize()."""
    from .llm.text import extract_json

    data = extract_json(text)
    if not isinstance(data, dict) or not isinstance(data.get("checks"), list) or not data["checks"]:
        raise ValueError("expected an object with a non-empty 'checks' list")
    return data


def _amounts(text: str) -> list[float]:
    return [float(m.replace(",", "")) for m in re.findall(r"\$\s?(\d[\d,]*(?:\.\d+)?)", text)]


def _areas(text: str) -> list[float]:
    return [float(m.replace(",", "")) for m in re.findall(r"(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s?ft|square feet|sf\b)", text, re.I)]


def explanation_ok(text: str, req: RentCheckRequest, ctx: dict) -> bool:
    n = len(req.rows)
    money = {req.rent, round(req.rent / n)} | {r.share for r in req.rows} | {abs(r.vs_even) for r in req.rows}
    for v in (req.private_portion, req.shared_portion, req.shared_each):
        if v is not None:
            money.add(round(v))
    unit = ctx["plan"].get("unit") or {}
    areas = {round(r.bedroom_area) for r in req.rows} | {round(r.private_bath_area) for r in req.rows if r.private_bath}
    areas |= {round(r.bedroom_area + r.private_bath_area) for r in req.rows}
    if unit.get("total_sqft"):
        areas.add(round(unit["total_sqft"]))
    near = lambda v, pool: any(abs(v - p) <= 1 for p in pool)  # noqa: E731
    return all(near(v, money) for v in _amounts(text)) and all(near(v, areas) for v in _areas(text))


def template_explanation(req: RentCheckRequest) -> str:
    rows = list(enumerate(req.rows, 1))
    n = len(rows)
    if n == 1:
        return f"There is one bedroom, so its roommate pays the full {_money(req.rent)}."
    even = req.rent / n
    (ti, top), (li, low) = max(rows, key=lambda r: r[1].share), min(rows, key=lambda r: r[1].share)
    if top.share == low.share:
        return f"Every bedroom pays {_money(top.share)}, the same as an even split."
    biggest = max(r.bedroom_area for _, r in rows)
    why = ["it is the biggest bedroom"] if top.bedroom_area >= biggest else ["of its size"]
    if top.private_bath and req.method == "fair":
        why.append("it has its own bathroom")
    out = [f"Bedroom {ti} ({top.name}) pays {_money(top.share)}, {_money(abs(top.vs_even))} more than an even "
           f"{_money(even)} split, because {' and '.join(why)}.",
           f"Bedroom {li} ({low.name}) pays {_money(low.share)}, {_money(abs(low.vs_even))} less, as the smallest room."]
    out.append("Shared space (living room, kitchen, halls) is split equally." if req.method == "fair"
               else "The whole rent follows bedroom size.")
    return " ".join(out)


def finalize(raw: dict, req: RentCheckRequest, ctx: dict, provider: str, model: str) -> RentCheck:
    checks: dict[str, Check] = {}
    for c in raw.get("checks") or []:
        if not isinstance(c, dict):
            continue
        cid, status = str(c.get("id", "")).strip(), _STATUS.get(str(c.get("status", "")).strip().lower())
        if cid in CHECK_IDS and status and cid not in checks:
            checks[cid] = Check(id=cid, status=status, reason=" ".join(str(c.get("reason") or "").split())[:240])
    ordered = [checks[c] for c in CHECK_IDS if c in checks]

    suggestions: list[Suggestion] = []
    for s in raw.get("suggestions") or []:
        if not isinstance(s, dict) or not isinstance(s.get("value"), bool):
            continue
        reason = " ".join(str(s.get("reason") or "").split())[:200]
        if s.get("action") == "set_private_bath":
            try:
                i = int(s.get("bedroom"))
            except (TypeError, ValueError):
                continue
            if not 1 <= i <= len(req.rows) or req.rows[i - 1].private_bath == s["value"]:
                continue  # unknown bedroom, or already the current input
            row = req.rows[i - 1]
            label = f"Turn private bath {'on' if s['value'] else 'off'} for Bedroom {i}"
            suggestions.append(Suggestion(action="set_private_bath", room_id=row.room_id, value=s["value"], reason=reason, label=label))
        elif s.get("action") == "include_closets" and s["value"] != req.include_closets:
            label = "Include attached closets" if s["value"] else "Don't count attached closets"
            suggestions.append(Suggestion(action="include_closets", value=s["value"], reason=reason, label=label))
    seen, unique = set(), []
    for s in suggestions:
        if (s.action, s.room_id) not in seen:
            seen.add((s.action, s.room_id))
            unique.append(s)

    explanation = " ".join(str(raw.get("explanation") or "").split())
    source: Literal["ai", "template"] = "ai"
    if not explanation or len(explanation) > 600 or not explanation_ok(explanation, req, ctx):
        explanation, source = template_explanation(req), "template"
    verdict: Literal["ok", "warn"] = "warn" if any(c.status == "warn" for c in ordered) or unique else "ok"
    return RentCheck(
        key=input_key(req), plan=req.plan, verdict=verdict, checks=ordered, suggestions=unique,
        explanation=explanation, explanation_source=source, provider=provider, model=model,
        checked_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        inputs={"method": req.method, "include_closets": req.include_closets, "rent": req.rent,
                "bedrooms": [{"room_id": r.room_id, "name": r.name, "area": round(r.bedroom_area), "private_bath": r.private_bath,
                              "share": r.share} for r in req.rows]},
    )


# ----------------------------------------------------------------------------- run

def cached(key: str) -> Optional[RentCheck]:
    try:
        return RentCheck.model_validate_json((CACHE_DIR / f"{key}.json").read_text())
    except FileNotFoundError:
        return None


def check(req: RentCheckRequest, *, cache_only: bool = False) -> tuple[RentCheck, bool]:
    """Returns (result, from_cache)."""
    key = input_key(req)
    hit = cached(key)
    if hit:
        return hit, True
    if cache_only:
        raise NotCached(key)
    ctx = _ctx(req)
    image_path = FLOORPLANS_DIR / ctx["plan"]["source_image"]
    if not image_path.exists():
        image_path = PARSED_DIR / req.plan / "original.png"
    image = image_path.read_bytes()
    mime = "image/jpeg" if image_path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    with usage.purpose("rent_check"):
        res = vision_json(image, mime, build_prompt(req, ctx), parse_reply)
    result = finalize(res.value, req, ctx, res.provider, res.model)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    (CACHE_DIR / f"{key}.json").write_text(result.model_dump_json(indent=2))
    return result, False
