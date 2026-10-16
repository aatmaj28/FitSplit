"""Listing description from the photo tags: a full version and a short one for syndication.

One cached text call (Claude first in TEXT_CHAIN_ORDER). The model only gets facts from the tags;
an answer quoting a number that isn't in those facts, or any money amount, is rejected and a plain
template is used instead, so nothing is made up."""
from __future__ import annotations

import json
import re
from typing import Optional

from ..llm import cache, text, usage
from .vocab import BY_ID

SYSTEM = """You write apartment rental listing descriptions in a friendly, professional tone.
Use ONLY the facts given. Do not invent sizes, prices, distances, neighborhood details or amenities.
Never mention money. Return JSON only: {"full": "...", "short": "..."}.
"full": 3 short paragraphs, at most 110 words in total. "short": one sentence for syndication, at
most 30 words."""
_NUM = re.compile(r"\d+(?:[.,]\d+)?")


def facts(amenities: list[dict], rooms: dict[str, int], tags: list[dict], listing: Optional[dict] = None) -> dict:
    floors = sorted({t["flooring"] for t in tags if t["flooring"] != "unknown"})
    light = sum(1 for t in tags if t["natural_light"] == "bright")
    f = {
        "rooms_seen": sorted(r for r in rooms if r != "other"),
        "amenities": [a["label"] for a in amenities if a["confidence"] >= 0.6],
        "flooring": floors,
        "bright_rooms": light >= 2,
        "condition_notes": list(dict.fromkeys(t["condition"] for t in tags if t["condition"]))[:6],
    }
    if listing:
        f["listing"] = {k: listing[k] for k in ("title", "beds", "baths") if listing.get(k) is not None}
    return f


def _template(f: dict) -> dict:
    title = (f.get("listing") or {}).get("title", "This apartment")
    am = f["amenities"]
    feats = ", ".join(a.lower() for a in am[:6]) if am else "a practical layout"
    full = (f"{title} is ready for its next renters. Highlights include {feats}."
            + (" The rooms get plenty of natural light." if f["bright_rooms"] else "")
            + " Take the walkthrough to see every room before you visit.")
    short = f"{title}: {feats}." if am else f"{title}, ready to rent."
    return {"full": full, "short": short[:200], "source": "template"}


def describe(amenities: list[dict], rooms: dict[str, int], tags: list[dict], listing: Optional[dict] = None) -> dict:
    f = facts(amenities, rooms, tags, listing)
    allowed = set(_NUM.findall(json.dumps(f)))

    def parse(v: object) -> dict:
        if not isinstance(v, dict) or not isinstance(v.get("full"), str) or not isinstance(v.get("short"), str):
            raise ValueError("need full and short")
        full, short = " ".join(v["full"].split()) if "\n\n" not in v["full"] else v["full"].strip(), " ".join(v["short"].split())
        if "$" in full + short:
            raise ValueError("no money amounts")
        bad = [n for n in _NUM.findall(full + " " + short) if n not in allowed]
        if bad:
            raise ValueError(f"numbers not in the facts: {bad[:3]}")
        if not (40 <= len(full) <= 1200 and 10 <= len(short) <= 260):
            raise ValueError("length")
        return {"full": full, "short": short}

    key = cache.key_of(["describe-v1", SYSTEM, f])
    hit = cache.get("media", key)
    if hit is not None:
        return {**hit["value"], "source": "cache"}
    try:
        with usage.purpose("media"):
            res = text.complete(SYSTEM, "Facts:\n" + json.dumps(f, indent=1), parse=parse, json_mode=True, max_tokens=900, temperature=0.4)
    except text.TextError:
        return _template(f)
    cache.put("media", key, res.value, provider=res.provider, model=res.model)
    return {**res.value, "source": res.provider}


__all__ = ["describe", "facts", "BY_ID"]
