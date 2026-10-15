"""Exact checks and room context for "Fill a room" (additions to the ported engine).

Budget is a hard rule in code, not a prompt: the open room's exact share (from the rent split)
against the candidate's max budget plus their stated flexibility. Same-gender-only preferences are
checked the same way. A failed hard check ends the match before any model call. The ROOM module
gives both clones the real room, so they negotiate about this room and this price.
"""
from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field

ROOM_VERSION = 2  # bump when room_module() changes: part of a fill-a-room negotiation's id

# budget_flexibility option -> dollars over budget_max the person accepts (questionnaire.py options)
FLEX = (("Hard limit", 0), ("~$100", 100), ("~$200", 200), ("Fairly flexible", 300))


class FurnitureFit(BaseModel):
    items: list[str] = Field(default_factory=list)  # "Queen bed", "Desk", ...
    all_fit: bool = True
    free_sqft: Optional[float] = None
    note: str = ""  # e.g. "Desk had to go in front of a doorway"


class RoomContext(BaseModel):
    """The open room, computed in the browser from the parsed plan, the rent split and the fit check."""
    plan: str
    unit_name: str
    rent_total: int
    beds: int
    room_id: str
    room_label: str  # "Bedroom 2 (DREAM)"
    area_sqft: float
    share: int  # exact monthly share of this room
    private_bath: bool
    furniture: Optional[FurnitureFit] = None  # the candidate's furniture in this room
    members: list[dict] = Field(default_factory=list)  # [{"profile_id", "name", "room_label", "share"}]


def budget_allowance(q: dict) -> tuple[int, int, str]:
    living = q.get("living", {})
    flex_text = living.get("budget_flexibility") or ""
    flex = next((v for k, v in FLEX if k in flex_text), 0 if not flex_text else 300)
    return int(living.get("budget_max") or 0), flex, flex_text


def budget_check(name: str, q: dict, share: int) -> dict:
    cap, flex, flex_text = budget_allowance(q)
    if share <= cap:
        return {"id": "budget", "ok": True, "hard": False, "detail": f"${share:,}/mo is within {name}'s ${cap:,} max"}
    if share <= cap + flex:
        return {"id": "budget", "ok": True, "hard": False,
                "detail": f"${share:,}/mo is ${share - cap:,} over {name}'s ${cap:,} max, inside their flex ({flex_text.lower()})"}
    over = "hard cap" if flex == 0 else f"max plus ${flex} flex"
    return {"id": "budget", "ok": False, "hard": True, "detail": f"${share:,}/mo is above {name}'s {over} (${cap + flex:,})"}


def gender_check(a_name: str, a: dict, b_name: str, b: dict) -> dict:
    la, lb = a.get("living", {}), b.get("living", {})
    ga, gb = la.get("gender"), lb.get("gender")
    for who, l, mine, theirs in ((a_name, la, ga, gb), (b_name, lb, gb, ga)):
        if l.get("roommate_gender") == "Same gender only" and mine and theirs and "Prefer not" not in f"{mine}{theirs}" and mine != theirs:
            return {"id": "gender", "ok": False, "hard": True, "detail": f"{who} wants a same-gender roommate"}
    return {"id": "gender", "ok": True, "hard": False, "detail": "No same-gender conflict"}


def spurious_incompatible(text: str, a: dict, b: dict, budget_settled: bool) -> bool:
    """A clone's "incompatible" that blames a hard rule the profiles show no conflict on (models
    sometimes invent one, e.g. "no smoking indoors" between two non-smokers). Exact rules only:
    smoking, pets, same-gender, and budget when code already settled it."""
    t = text.lower()
    if re.search(r"\b(noise|noisy|loud|part(y|ies)|guests?|sleep|clean\w*|quiet|schedule|music|drink\w*|mess\w*)\b", t):
        return False  # a lifestyle reason is in there too: the verdict stands
    la, lb = a.get("living", {}), b.get("living", {})
    reasons = []
    if "smok" in t:
        reasons.append(la.get("smoking") == "I smoke" or lb.get("smoking") == "I smoke")
    if re.search(r"\bpets?\b|allerg", t):
        reasons.append(la.get("pets") == "I have pets" or lb.get("pets") == "I have pets")
    if "gender" in t:
        reasons.append(not gender_check("a", a, "b", b)["ok"])
    if re.search(r"\b(budget|afford\w*|rent|price)\b|\$", t):
        reasons.append(not budget_settled)
    return bool(reasons) and not any(reasons)


# non-negotiable option (questionnaire.py) -> words a verdict about it uses
NN_WORDS = {
    "No smoking indoors": r"smok|cigar|vap",
    "Non-smoking household only": r"smok|cigar|vap",
    "No pets": r"\bpets?\b|allerg|\bdogs?\b|\bcats?\b",
    "Must be okay with my pet(s)": r"\bpets?\b|allerg|\bdogs?\b|\bcats?\b",
    "No overnight guests": r"overnight|guests?",
    "Strict quiet hours (e.g., no noise after 10pm)": r"quiet|nois|loud",
    "Must keep kitchen very clean": r"kitchen|clean",
    "No parties ever": r"part(y|ies)",
    "Same gender roommate only": r"gender",
    "Budget hard cap (cannot exceed max)": r"budget|afford|rent|price|\$|\bcap\b",
}


def nn_conflict(text: str, a: dict, b: dict) -> bool:
    """Does a verdict's reason name one of either person's non-negotiables? Before the conclusion
    only such a conflict ends the chat; anything else is negotiable (engine rm2)."""
    t = text.lower()
    nns = (a.get("dealbreakers", {}).get("non_negotiables") or []) + (b.get("dealbreakers", {}).get("non_negotiables") or [])
    if (a.get("dealbreakers", {}).get("custom_dealbreaker") or b.get("dealbreakers", {}).get("custom_dealbreaker")):
        return True  # a free-text dealbreaker can be about anything
    return any(re.search(NN_WORDS.get(n, re.escape(n.lower())), t) for n in nns)


def negotiable_lines(text: str, a_name: str, a: dict, b_name: str, b: dict) -> list[str]:
    """Shown to both clones when an early "incompatible" names no non-negotiable."""
    def nn(q: dict) -> str:
        return "; ".join(q.get("dealbreakers", {}).get("non_negotiables") or []) or "none"

    def flex(q: dict) -> str:
        return "; ".join(q.get("dealbreakers", {}).get("flexible_on") or []) or "nothing listed"

    fa, fb = a_name.split(" ")[0], b_name.split(" ")[0]
    return [f"Before the conclusion only a non-negotiable ends the chat. {fa}'s non-negotiables: {nn(a)}; {fb}'s: {nn(b)}. "
            f"\"{text.strip()[:100]}\" is not one of them: negotiate it with FLX offers, or name it as an open topic in your final VRD.",
            f"Flexible by their own answers: {fa}: {flex(a)}; {fb}: {flex(b)}."]


def fact_check_lines(text: str, a_name: str, a: dict, b_name: str, b: dict, budget_settled: bool) -> list[str]:
    """What the profiles really say on the topics a rejected "incompatible" blamed (engine rm2 shows
    these to both clones and to the analysis, so they stop arguing about a conflict that isn't there)."""
    if not spurious_incompatible(text, a, b, budget_settled):
        return []
    t = text.lower()
    la, lb = a.get("living", {}), b.get("living", {})
    fa, fb = a_name.split(" ")[0], b_name.split(" ")[0]
    out = []
    if "smok" in t:
        out.append(f"Nobody in this home smokes ({fa}: {la.get('smoking')}; {fb}: {lb.get('smoking')}), so there is no smoking conflict.")
    if re.search(r"\bpets?\b|allerg", t):
        out.append(f"Nobody has a pet ({fa}: {la.get('pets')}; {fb}: {lb.get('pets')}). A no-pets rule is already met: liking pets is not having one.")
    if "gender" in t:
        out.append("Nobody's same-gender preference is broken, so there is no gender conflict.")
    if re.search(r"\b(budget|afford\w*|rent|price)\b|\$", t) and budget_settled:
        out.append("The budget is settled: code checked that the room's exact share fits the candidate's budget.")
    return out


# logistics both sides state exactly; a mismatch nobody is flexible on is still open after any chat
LOGISTICS = (("lease_type", "Lease length", "lease", "{a} wants a {va}, {b} a {vb}"),
             ("move_in_date", "Move-in date", "move_in", "{a} moves in {va}, {b} {vb}"))


def logistics_checks(a_name: str, a: dict, b_name: str, b: dict) -> list[dict]:
    """Soft checks (never end a match): a "strong" verdict is capped at "conditional" while one fails."""
    out = []
    for key, flex_item, cid, text in LOGISTICS:
        va, vb = a.get("living", {}).get(key), b.get("living", {}).get(key)
        if not va or not vb or va == vb or "No preference" in (va, vb) or "Flexible" in (va, vb):
            continue
        flexible = [n for n, q in ((a_name, a), (b_name, b)) if flex_item in (q.get("dealbreakers", {}).get("flexible_on") or [])]
        detail = text.format(a=a_name.split(" ")[0], b=b_name.split(" ")[0], va=va.lower(), vb=vb.lower())
        out.append({"id": cid, "ok": bool(flexible), "hard": False, "topic": flex_item.lower(),
                    "detail": detail + (f"; {flexible[0].split(' ')[0]} is flexible on it" if flexible else "; neither is flexible on it")})
    return out


def exact_checks(candidate: dict, member: dict, room: Optional[RoomContext]) -> list[dict]:
    """candidate / member: profiles {"name", "questionnaire"}. Without a room ("find roommates") the
    two also have to agree on lease terms; with a room the unit's lease is a given."""
    checks = [gender_check(candidate["name"], candidate["questionnaire"], member["name"], member["questionnaire"])]
    if room is None:
        checks += logistics_checks(candidate["name"], candidate["questionnaire"], member["name"], member["questionnaire"])
    if room:
        checks.insert(0, budget_check(candidate["name"], candidate["questionnaire"], room.share))
        if room.furniture is not None:
            f = room.furniture
            checks.append({"id": "furniture", "ok": f.all_fit, "hard": False,
                           "detail": (f"{', '.join(f.items) or 'Their furniture'} fits in {room.room_label}" if f.all_fit
                                      else f"Not all of {candidate['name']}'s furniture fits in {room.room_label}") + (f" ({f.note})" if f.note else "")})
        want_bath = candidate["questionnaire"].get("living", {}).get("bathroom_preference")
        if want_bath == "Private bathroom" and not room.private_bath:
            checks.append({"id": "bathroom", "ok": False, "hard": False, "detail": f"{candidate['name']} prefers a private bathroom; {room.room_label} shares one"})
    return checks


def room_module(name: str, room: RoomContext, role: Literal["candidate", "member"], other_names: list[str]) -> str:
    """Extra system-prompt module (our addition, ACP style like the originals)."""
    bath = "yes" if room.private_bath else "no(shared)"
    lines = [f"## MOD:ROOM — {name}", f"unit:{room.unit_name}|rent_total:${room.rent_total:,}/mo|beds:{room.beds}"]
    if role == "candidate":
        lines.append(f"offered:{room.room_label}|{round(room.area_sqft)}sqft|share:${room.share:,}/mo(fair split, exact)|private_bath:{bath}")
        lines.append(f"budget_check:PASSED(code verified ${room.share:,}/mo fits your budget)")
        if room.furniture is not None:
            f = room.furniture
            lines.append(f"your_furniture:{';'.join(f.items) or 'none'}|fits:{'YES' if f.all_fit else 'NO'}"
                         + (f"|free_floor:{round(f.free_sqft)}sqft" if f.free_sqft is not None else "") + (f"|note:{f.note}" if f.note else ""))
        lines.append(f"current_roommates:{', '.join(other_names) or 'none'}")
        lines.append("You are applying for THIS room at THIS price. Use these exact numbers; never invent other rents or sizes. "
                     "Budget is settled: never call it a mismatch; negotiate lifestyle (sleep, guests, noise, cleaning, smoking, pets).")
    else:
        mine = next((m for m in room.members if m.get("name") == name), None)
        if mine:
            lines.append(f"your_room:{mine.get('room_label', '?')}|you_pay:${int(mine.get('share', 0)):,}/mo")
        lines.append(f"open_room:{room.room_label}|{round(room.area_sqft)}sqft|share:${room.share:,}/mo|private_bath:{bath}")
        lines.append(f"budget:SETTLED(code verified the candidate can pay ${room.share:,}/mo; your own budget range does not apply, you keep your room)")
        if room.furniture is not None:
            lines.append(f"candidate_furniture_fits:{'YES' if room.furniture.all_fit else 'NO'}")
        lines.append(f"other_roommates:{', '.join(other_names) or 'none'}")
        lines.append("You already live here and are meeting a candidate for the open room. The rent share is fixed by the fair split. "
                     "Do not compare budget ranges; judge lifestyle fit (sleep, guests, noise, cleaning, smoking, pets) and your non-negotiables.")
    return "\n".join(lines)


def group_verdict(results: list[dict], rule: Literal["all", "majority"] = "all") -> dict:
    """results: [{"member", "status"}] for the candidate vs each current roommate."""
    ok = [r for r in results if r["status"] in ("strong", "conditional")]
    if rule == "all":
        match = len(ok) == len(results) and bool(results)
    else:
        match = len(ok) * 2 > len(results)
    if not match:
        status = "no_match"
    elif all(r["status"] == "strong" for r in results):
        status = "strong"
    else:
        status = "conditional"
    no = [r["member"] for r in results if r not in ok]
    return {"match": match, "status": status, "rule": rule, "approvals": len(ok), "members": len(results),
            "summary": ("Everyone agreed" if len(ok) == len(results) else f"{len(ok)} of {len(results)} roommates agreed")
                       + ("" if match else f"; not a match ({', '.join(no)} said no)")}
