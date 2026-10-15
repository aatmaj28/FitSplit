"""Local JSON storage and the negotiation runner (replaces the original's MongoDB, OAuth sessions
and in-memory WebSocket rooms).

    data/roommates/profiles.json            student profiles (seeded ones are marked "sample": true)
    data/roommates/negotiations/<id>.json   finished negotiations: events, messages, verdict, analysis

A negotiation's id is a hash of everything that shapes it (engine version, both profiles, the room
context), so asking again for the same pair and room returns the stored conversation instead of
calling a model. Live runs happen in a worker thread; their events are buffered in memory for the
SSE stream (api.py) and the record is written to disk when it finishes.
"""
from __future__ import annotations

import hashlib
import json
import threading
from datetime import datetime, timezone
from typing import Callable, Literal, Optional

from ..config import DATA_DIR
from .checks import ROOM_VERSION, RoomContext, exact_checks, group_verdict, room_module, spurious_incompatible
from .engine import ENGINE_VERSION, Agent, Negotiation
from .questionnaire import validate_questionnaire

DATA = DATA_DIR / "roommates"
PROFILES = DATA / "profiles.json"
NEGOTIATIONS = DATA / "negotiations"

_lock = threading.Lock()
_one_at_a_time = threading.Semaphore(1)  # live runs queue up: one model conversation at a time (rate limits)
RUNNING: dict[str, dict] = {}  # id -> live record (until finished and saved)
VERDICT_VERSION = 3  # bump when verdict logic changes (turns stay cached, verdicts are recomputed)


class NotFound(LookupError):
    pass


# ---------------------------------------------------------------- profiles

def load_profiles() -> list[dict]:
    try:
        return json.loads(PROFILES.read_text())
    except FileNotFoundError:
        return []


def get_profile(pid: str) -> dict:
    p = next((p for p in load_profiles() if p["id"] == pid), None)
    if p is None:
        raise NotFound(f"no profile {pid!r}")
    return p


def save_profile(profile: dict) -> dict:
    errors = validate_questionnaire(profile.get("questionnaire") or {})
    if errors:
        raise ValueError(" ".join(errors))
    with _lock:
        profiles = [p for p in load_profiles() if p["id"] != profile["id"]]
        profiles.append(profile)
        DATA.mkdir(parents=True, exist_ok=True)
        PROFILES.write_text(json.dumps(profiles, indent=2, ensure_ascii=False))
    return profile


# ---------------------------------------------------------------- negotiations

def negotiation_id(a: dict, b: dict, room: Optional[RoomContext]) -> str:
    parts = [ENGINE_VERSION, VERDICT_VERSION, a["id"], a["name"], a["questionnaire"], b["id"], b["name"], b["questionnaire"],
             room.model_dump() if room else None]
    if room:
        parts.append(ROOM_VERSION)
    return "n_" + hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]


def load_negotiation(nid: str) -> Optional[dict]:
    if nid in RUNNING:
        return RUNNING[nid]
    try:
        return json.loads((NEGOTIATIONS / f"{nid}.json").read_text())
    except FileNotFoundError:
        return None


def _save(rec: dict) -> None:
    NEGOTIATIONS.mkdir(parents=True, exist_ok=True)
    (NEGOTIATIONS / f"{rec['id']}.json").write_text(json.dumps(rec, indent=2, ensure_ascii=False))


def _emit(rec: dict, event: dict) -> None:
    with _lock:
        rec["events"].append({**event, "seq": len(rec["events"])})


BACKGROUND = True  # tests run negotiations inline
RUNNER: Callable[[Negotiation], dict] = lambda n: n.run()  # tests swap in a fake model


def start(a_id: str, b_id: str, room: Optional[RoomContext] = None, *, background: Optional[bool] = None,
          runner: Optional[Callable[[Negotiation], dict]] = None) -> dict:
    """Start (or return the stored) negotiation between profile a and profile b.
    With a room, a is the candidate for that room and b a current roommate ("Fill a room")."""
    background = BACKGROUND if background is None else background
    runner = runner or RUNNER
    a, b = get_profile(a_id), get_profile(b_id)
    nid = negotiation_id(a, b, room)
    with _lock:
        existing = load_negotiation(nid)
        if existing and existing["status"] in ("running", "complete"):
            return existing
        rec = {"id": nid, "engine": ENGINE_VERSION, "mode": "fill" if room else "find",
               "a": {"id": a["id"], "name": a["name"]}, "b": {"id": b["id"], "name": b["name"]},
               "room": room.model_dump() if room else None, "status": "running", "events": [], "messages": [],
               "checks": [], "result": None, "analysis": None, "providers": {},
               "created": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        RUNNING[nid] = rec
    work = lambda: _run(rec, a, b, room, runner)  # noqa: E731
    if background:
        threading.Thread(target=work, name=f"negotiation-{nid}", daemon=True).start()
    else:
        work()
    return rec


def _run(rec: dict, a: dict, b: dict, room: Optional[RoomContext], runner) -> None:
    try:
        checks = exact_checks(a, b, room) if room else exact_checks(a, b, None)
        rec["checks"] = checks
        _emit(rec, {"type": "checks", "checks": checks})
        hard = next((c for c in checks if c["hard"] and not c["ok"]), None)
        if hard:  # no model call needed: an exact rule already says no
            rec["result"] = {"status": "incompatible", "reason": hard["detail"], "unresolved_topics": [], "source": "exact_check"}
        else:
            extra_a = room_module(a["name"], room, "candidate", [m["name"] for m in room.members]) if room else ""
            extra_b = room_module(b["name"], room, "member", [a["name"]] + [m["name"] for m in room.members if m["name"] != b["name"]]) if room else ""
            neg = Negotiation(Agent(a["id"], a["name"], a["questionnaire"], extra_a), Agent(b["id"], b["name"], b["questionnaire"], extra_b),
                              emit=lambda e: _emit(rec, e),
                              spurious=lambda t: spurious_incompatible(t, a["questionnaire"], b["questionnaire"], room is not None))
            with _one_at_a_time:
                out = runner(neg)
            result = out["outcome"]
            soft = [c for c in checks if not c["ok"] and not c["hard"] and c.get("topic")]
            if soft and result["status"] == "strong":  # the clones agreed, but the profiles still disagree on this
                result = {"status": "conditional", "source": "exact_check",
                          "reason": f"The clones agreed on everything else, but {soft[0]['topic']} is still open: {soft[0]['detail']}.",
                          "unresolved_topics": [c["topic"] for c in soft][:2]}
            rec.update(messages=out["messages"], analysis=out["analysis"], result=result, providers=neg.providers,
                       ignored_verdicts=neg.ignored)
        rec["status"] = "complete"
        _emit(rec, {"type": "complete", "result": rec["result"], "analysis": rec["analysis"], "checks": rec["checks"]})
        _save(rec)
    except Exception as e:  # noqa: BLE001 - surface any failure to the stream; nothing is saved, so it can be retried
        rec["status"] = "error"
        rec["error"] = " ".join(str(e).split())[:300]
        _emit(rec, {"type": "error", "message": rec["error"]})
    finally:
        with _lock:
            if rec["status"] == "complete":
                RUNNING.pop(rec["id"], None)


def fill_room(candidate: str, members: list[str], room: RoomContext, rule: Literal["all", "majority"] = "all",
              background: Optional[bool] = None) -> dict:
    recs = [start(candidate, m, room, background=background) for m in members]
    return fill_room_status(recs, rule)


def fill_room_status(recs: list[dict], rule: Literal["all", "majority"] = "all") -> dict:
    done = all(r["status"] == "complete" for r in recs)
    out = {"negotiations": [{"member": r["b"], "id": r["id"], "status": r["status"],
                             "verdict": (r.get("result") or {}).get("status")} for r in recs], "group": None}
    if done:
        out["group"] = group_verdict([{"member": r["b"]["name"], "status": r["result"]["status"]} for r in recs], rule)
    return out


# ---------------------------------------------------------------- find roommates: groups from pairwise results

RANK = {"strong": 2, "conditional": 1, "incompatible": 0}


def best_groups(profile_ids: list[str], size: int) -> list[dict]:
    """Groups of `size` where every pair has a finished, non-incompatible negotiation (find mode)."""
    from itertools import combinations

    profiles = {p["id"]: p for p in load_profiles() if p["id"] in profile_ids}
    pair: dict[frozenset, dict] = {}
    for f in NEGOTIATIONS.glob("*.json") if NEGOTIATIONS.exists() else []:
        rec = json.loads(f.read_text())
        if rec.get("mode") != "find" or rec.get("status") != "complete":
            continue
        k = frozenset((rec["a"]["id"], rec["b"]["id"]))
        if k <= set(profiles):
            pair[k] = rec
    groups = []
    for combo in combinations(sorted(profiles), size):
        recs = [pair.get(frozenset(p)) for p in combinations(combo, 2)]
        if any(r is None or r["result"]["status"] == "incompatible" for r in recs):
            continue
        score = sum(RANK[r["result"]["status"]] * 100 + ((r.get("analysis") or {}).get("scores") or {}).get("overall", 50) for r in recs)
        budgets = [profiles[p]["questionnaire"]["living"] for p in combo]
        groups.append({"members": list(combo), "score": score, "pairs": [{"id": r["id"], "a": r["a"]["id"], "b": r["b"]["id"],
                                                                           "status": r["result"]["status"]} for r in recs],
                       "budget_min": sum(int(l.get("budget_min") or 0) for l in budgets),
                       "budget_max": sum(int(l.get("budget_max") or 0) for l in budgets), "beds": size})
    return sorted(groups, key=lambda g: -g["score"])
