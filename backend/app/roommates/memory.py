"""What each clone already knows (our addition to the ported engine, engine version rm2).

Why the clones asked for things the other had already said (docs/notes/roommate_engine_analysis.md):
  - each clone only sees its last 6 history entries, so by turn 8 or so the other's introduction
    (budget, move-in, location) has scrolled out of view;
  - the other clone's reply arrived as an unlabelled "user" message behind the phase hint, so models
    echoed it, called the other person "User", or answered with the other's values;
  - a clone's own routines / social / lifestyle answers only reached it after it asked for that
    module, and only on its next turn, so it guessed (often by mirroring the other's values).

This module keeps a running record of the ACP fields each clone has stated, and builds every turn's
prompt from it: who is speaking to whom, what the other has already told you (never ask again), what
you have already shared, which of this phase's topics are still open, any fact check from code, and
the other clone's message, clearly labelled.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# ACP field keys (and the variants models write) -> topic
TOPIC_KEYS: dict[str, tuple[str, ...]] = {
    "location": ("loc", "location", "city", "neighborhood"),
    "move-in date": ("mv", "movein", "move_in", "move-in", "movein_date"),
    "budget": ("bd", "budget", "rent", "bd_flex", "budget_flex", "share"),
    "room": ("rm", "room", "roomtype", "room_type", "bath", "bathroom", "offered"),
    "lease length": ("lease", "lease_type"),
    "smoking": ("smk", "smoking"),
    "pets": ("pet", "pets"),
    "drinking": ("drink", "drinking"),
    "sleep": ("slp", "sleep", "slp_sched", "sleep_schedule", "wake", "bedtime"),
    "cleanliness": ("cln", "cleanliness", "clean", "clean_sched", "cleaning", "chores"),
    "guests": ("gwk", "guests", "guests_per_week", "overnight_guests", "notice", "parties", "social"),
    "noise": ("nzl", "noise", "noise_level", "quiet", "quiet_hours"),
    "work from home": ("wfh", "work_from_home", "sched", "schedule"),
    "cooking": ("cook", "cooking", "kitchen"),
    "money": ("usp", "utilities", "groc", "groceries", "dep", "deposit", "pay", "payments"),
    "priorities": ("pri", "priorities"),
    "non-negotiables": ("nn", "non_negotiables"),
}
KEY_TOPIC = {k: t for t, ks in TOPIC_KEYS.items() for k in ks}

# the profile module that holds a clone's own answers for a topic
TOPIC_MODULE = {
    "sleep": "ROUTINES", "cleanliness": "ROUTINES", "cooking": "ROUTINES",
    "guests": "SOCIAL", "noise": "SOCIAL",
    "work from home": "LIFESTYLE",
    "money": "FINANCIAL",
    "non-negotiables": "DEALBREAKERS",
}
# what each phase is about (Tanvi's phase hints), for "still open"
PHASE_TOPICS = {
    "introduction": ("location", "budget", "move-in date", "smoking", "pets", "non-negotiables", "priorities"),
    "exploration": ("sleep", "cleanliness", "guests", "noise", "work from home"),
    "negotiation": ("money", "cooking"),
    "conclusion": (),
}

_STMT = re.compile(r"\b(HI|PFR|CNF|FLX|VRD)\s*:", re.I)
_SAY = re.compile(r"^\s*[*_]*\s*SAY\s*[*_]*\s*:\s*[*_]*\s*(.+?)\s*$", re.I | re.M)


def say_line(reply: str) -> str | None:
    """The reply's plain-English line ("SAY: ..."), cleaned; None if it has none."""
    m = _SAY.search(reply or "")
    if not m:
        return None
    s = m.group(1).strip().strip('"“”').strip()
    s = _STMT.split(s)[0].strip(" |-")  # a model sometimes runs the ACP statements onto the same line
    return s[:240] if len(s.split()) >= 3 else None


def statements(message: str) -> list[tuple[str, str]]:
    """[(type, body)] of the ACP statements in a message (SAY lines and module tags skipped)."""
    text = re.sub(r"<<\s*MOD:\s*\w+\s*>>", " ", _SAY.sub(" ", message or ""))
    out = []
    for line in text.splitlines():
        starts = list(_STMT.finditer(line))
        for i, m in enumerate(starts):
            end = starts[i + 1].start() if i + 1 < len(starts) else len(line)
            out.append((m.group(1).upper(), line[m.end():end].strip()))
    return out


def fields(body: str) -> list[tuple[str, str]]:
    """key/value pairs of one statement body: "a=1|b=2", "[a:1,b:2]", "a=x|y,b=2" or "a:status(detail)"."""
    s = body.strip()
    if s.startswith("[") and s.endswith("]"):
        s = s[1:-1]
    # split only where a new "key=" / "key:" starts, so values keep their own | , ; ("loc=Fenway|Mission Hill,mv=...")
    chunks = re.split(r"[|,;]\s*(?=[A-Za-z_\-]{1,18}\s*[:=])", s)
    out = []
    for chunk in chunks:
        c = chunk.strip().strip("[]").strip()
        m = re.match(r"^([A-Za-z_\-]{1,18})\s*[:=]\s*(.+)$", c, re.S)
        if m:
            out.append((m.group(1).lower(), m.group(2).strip().strip("[]").strip()))
    return out


def stated(message: str) -> dict[str, dict[str, str]]:
    """Facts a message states about its speaker: HI / PFR / FLX fields, {topic: {key: value}}."""
    facts: dict[str, dict[str, str]] = {}
    for kind, body in statements(message):
        if kind not in ("HI", "PFR", "FLX"):
            continue
        for key, value in fields(body):
            topic = KEY_TOPIC.get(key)
            if topic and value and value.lower() not in ("?", "unknown", "n/a"):
                facts.setdefault(topic, {})[f"{key} offer" if kind == "FLX" else key] = value[:80]  # an offer doesn't replace the answer
    return facts


def mentioned(message: str) -> set[str]:
    """Topics a message touches at all (any statement type), e.g. to load the profile module first."""
    out = set()
    for _, body in statements(message):
        for key, _ in fields(body):
            if key in KEY_TOPIC:
                out.add(KEY_TOPIC[key])
        head = re.match(r"^\[?([A-Za-z_\-]{1,18})\s*:", body.strip())
        if head and head.group(1).lower() in KEY_TOPIC:  # CNF:pet:conflict(...)
            out.add(KEY_TOPIC[head.group(1).lower()])
    return out


@dataclass
class Memory:
    """What each speaker ("a" / "b") has stated so far: {speaker: {topic: {key: latest value}}}."""
    told: dict[str, dict[str, dict[str, str]]] = field(default_factory=lambda: {"a": {}, "b": {}})
    checks: list[str] = field(default_factory=list)  # fact-check lines from code, shown to both clones

    def add(self, speaker_id: str, message: str) -> None:
        for topic, kv in stated(message).items():
            self.told[speaker_id].setdefault(topic, {}).update(kv)

    def fact(self, line: str) -> None:
        if line not in self.checks:
            self.checks.append(line)

    @staticmethod
    def render(facts: dict[str, dict[str, str]]) -> str:
        return " | ".join(f"{t}: " + "; ".join(f"{k}={v}" for k, v in kv.items()) for t, kv in facts.items())


MOVE_IN_PHRASE = {"ASAP": "as soon as possible", "Within 1 month": "within a month from now", "1–3 months": "1–3 months from now",
                  "3–6 months": "3–6 months from now", "Flexible": "whenever suits"}


def move_in_phrase(value: object) -> str:
    return MOVE_IN_PHRASE.get(str(value or ""), str(value or "?"))


def field_notes(questionnaire: dict) -> str:
    """Our system-prompt addition: the clones read "mv=1–3 months" (move in within 1-3 months) as a
    1-3 month stay and argued about lease length over it."""
    living = questionnaire.get("living", {})
    return ("## FIELD NOTES (read these fields right)\n"
            f"mv = WHEN you move in: you move in {move_in_phrase(living.get('move_in_date'))}. It is NOT how long you stay.\n"
            f"lease = how long you sign for: yours is a {str(living.get('lease_type') or '?').lower()}.\n"
            "In SAY lines write \"move in within 1–3 months\", never \"for 1–3 months\".")


def _first(name: str) -> str:
    return name.split(" ")[0]


def turn_prompt(*, hint: str, turn: int, total: int, phase: str, me: str, other: str, mine: dict[str, dict[str, str]],
                theirs: dict[str, dict[str, str]], checks: list[str], incoming: str, opening: bool, nn: list[str] = (),
                flex: list[str] = ()) -> str:
    """One turn's user message: phase hint, memory, fact checks, then the other clone's labelled message."""
    me1, other1 = _first(me), _first(other)
    known = Memory.render(theirs) or "nothing yet"
    shared = ", ".join(mine) or "nothing yet"
    topics = PHASE_TOPICS.get(phase, ())
    open_ask = [t for t in topics if t not in theirs]
    open_share = [t for t in topics if t not in mine]
    lines = [
        hint,
        f"[TURN {turn} of {total}] You are {me}'s clone. You are talking to {other}'s clone.",
        "",
        f"ALREADY TOLD YOU by {other1} (use it; never ask about these again): {known}",
        f"ALREADY SHARED by you (don't repeat these): {shared}",
    ]
    if topics:
        lines.append(f"STILL OPEN in this phase: ask {other1} about {', '.join(open_ask) or 'nothing (all answered)'}; "
                     f"share yours on {', '.join(open_share) or 'nothing (all shared)'}.")
    if phase == "introduction" and "smoking" not in mine:
        lines.append("Your HI must state loc, mv, bd, smk, pet and nn, so a dealbreaker shows up now, not in turn 7.")
    lines.append(f"YOUR non-negotiables are exactly: {'; '.join(nn) or 'none'}. Only a conflict with one of these (or one of "
                 f"{other1}'s) is INCOMPATIBLE; anything else is negotiable: offer a middle ground (FLX) instead. "
                 f"You told the app you are flexible on: {'; '.join(flex) or 'nothing in particular'}.")
    if checks:
        lines += ["FACT CHECK (verified by code from both profiles, overrides anything said before):", *[f"- {c}" for c in checks]]
    lines += [
        "",
        ("The app opened the chat with:" if opening else f"{other1}'s clone just said:"),
        '"""', incoming.strip(), '"""',
        "",
        f"Reply as {me1}'s clone, in first person, about YOUR OWN profile only (your CORE and MOD sections). "
        f"Never copy {other1}'s lines or present {other1}'s answers as yours. React to what {other1} just said, "
        "and don't restate what you already shared unless it changed.",
        "Format: first line `SAY: ` + one plain-English sentence (max 30 words) telling a human reader the substance of "
        "this message: the concrete facts you share, what you ask, or what you offer (no small talk, no greetings after turn 2); "
        "then 1-3 ACP statements. "
        + ("Give your VRD now." if phase == "conclusion" else "No VRD yet, unless a non-negotiable conflict ends the chat now."),
    ]
    return "\n".join(lines)


def compact(other: str, incoming: str) -> str:
    """How a past turn is kept in a clone's history: just who said what (the memory block is rebuilt each turn)."""
    return f"{_first(other)}'s clone said:\n{incoming.strip()}"
