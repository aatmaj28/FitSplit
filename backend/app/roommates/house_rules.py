"""House rules a group's clones agreed on, merged from every pair's conversation (one cached text
call per group; Claude first in today's chain). Numbers the conversations never mention are dropped,
so a rule can't invent a time or an amount."""
from __future__ import annotations

import json
import re
from typing import Optional

from ..llm import text
from . import service
from .engine import _cached_call

TOPICS = ("quiet hours", "guests", "chores", "kitchen", "costs", "other")
SYSTEM = """You write the house rules a group of future roommates agreed on, from their AI clones'
conversations (one conversation per pair of roommates). Use only what the conversations say. Merge
overlapping agreements into one rule, keep the most specific version (times, numbers, apps), and
write each rule as one short friendly sentence (max 22 words) that applies to the whole home.
Topics: quiet hours, guests, chores, kitchen, costs, other. Put what is still not agreed in "open"
(use the verdicts' open topics and anything left unsettled), as short phrases.
Return JSON only: {"rules": [{"topic": "...", "text": "..."}], "open": ["..."]} with 3 to 6 rules
and 0 to 3 open items."""
_NUM = re.compile(r"\d[\d,.:]*")


def _nums(t: str) -> set[str]:
    return {n.replace(",", "").rstrip(".:") for n in _NUM.findall(t or "")}


def _user(names: list[str], recs: list[dict]) -> str:
    parts = [f"Roommates: {', '.join(names)}."]
    for r in recs:
        res = r.get("result") or {}
        lines = "\n".join(f"{i + 1}. {m['speaker'].split(' ')[0]}: {m.get('say') or m['message'][:300]}" for i, m in enumerate(r["messages"]))
        parts.append(f"## {r['a']['name'].split(' ')[0]} + {r['b']['name'].split(' ')[0]} ({res.get('status')})\n{lines}\n"
                     f"Open topics: {'; '.join(res.get('unresolved_topics') or []) or 'none'}")
    return "\n\n".join(parts)


def house_rules(members: list[str], ids: list[str]) -> dict:
    """members: profile ids of the group; ids: the pair negotiations (all complete)."""
    recs = [service.load_negotiation(i) for i in ids]
    missing = [i for i, r in zip(ids, recs) if not r or r.get("status") != "complete"]
    if missing:
        raise service.NotFound(f"conversations not finished: {', '.join(missing)}")
    names = [service.get_profile(m)["name"] for m in members]
    user = _user(names, recs)
    source = _nums(user)

    def parse(d: object) -> dict:
        if not isinstance(d, dict) or not isinstance(d.get("rules"), list):
            raise ValueError("need rules")
        rules = []
        for r in d["rules"]:
            topic = str((r or {}).get("topic", "")).strip().lower()
            t = " ".join(str((r or {}).get("text", "")).split())
            if topic in TOPICS and 3 <= len(t.split()) <= 30 and _nums(t) <= source:
                rules.append({"topic": topic, "text": t})
        if len(rules) < 2:
            raise ValueError("fewer than 2 usable rules")
        open_ = [" ".join(str(o).split())[:90] for o in (d.get("open") or []) if str(o).strip()][:3]
        return {"rules": rules[:6], "open": open_}

    value, provider = _cached_call("house_rules", SYSTEM, [{"role": "user", "content": user}], json_mode=True, parse=parse,
                                   max_tokens=1500, temperature=0.3)
    key = "+".join(sorted(members))
    out = {"key": key, "members": members, "negotiations": ids, **value, "provider": provider}
    (service.DATA / "house_rules").mkdir(parents=True, exist_ok=True)
    (service.DATA / "house_rules" / f"{key}.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))
    return out


def stored(key: str) -> Optional[dict]:
    try:
        return json.loads((service.DATA / "house_rules" / f"{key}.json").read_text())
    except FileNotFoundError:
        return None


__all__ = ["house_rules", "stored", "text"]
