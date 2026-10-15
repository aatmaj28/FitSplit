"""Clone negotiation engine, ported from Tanvi's (GitHub Tanvi-15) AI-Roommate-Finder
(backend/server.py: PHASES, detect_outcome, Agent, ChatRoom.run_conversation, ChatRoom.analyze).

Prompts, phases, the starter message, the 6-message history window and module injection are kept as
written. Deliberate changes (docs/DECISIONS.md, phase 3):
  1. turns go through app.llm.text (Groq gpt-oss-120b -> Groq llama-3.3-70b -> Gemini -> Claude Sonnet)
     and every completion is cached on disk, so a conversation never has to be regenerated;
  2. the conclusion phase really ends after its 2 turns: 13 turns as advertised (the original ran 15);
  3. the other clone's reply reaches the speaker once, with the phase hint (the original fed it twice);
  4. ACP verdicts (VRD:STRONG|CONDITIONAL|INCOMPATIBLE) are read first and the original keyword
     detector is the fallback; <<MOD:...>> tags and "no dealbreakers" no longer read as incompatible;
  5. the analysis sees the whole conversation (13 messages at most) and its JSON is validated;
  6. "Fill a room": a ROOM module tells every clone about the real room (size, exact rent share,
     private bath, whether the candidate's furniture fits); budget and same-gender rules are exact
     checks in code (checks.py) that run before any model call;
  7. an "incompatible" verdict blaming smoking, pets, gender or a budget that code already settled
     is ignored when the profiles show no such conflict (models sometimes invent one).
Engine rm2 (2026-10-15, after the clones kept asking for things already said; see memory.py):
  8. every turn's prompt says who is talking to whom, labels the other clone's message, and carries
     a memory of what each side has already stated (parsed from the ACP fields), the phase's open
     topics and any fact check from code; history keeps only "X's clone said: ...";
  9. a clone gets its own routines / social / lifestyle answers when the exploration phase starts,
     financial + dealbreakers at negotiation (and any module whose topic the other just raised),
     instead of only after asking for it;
 10. only conclusion-phase verdicts decide strong / conditional (clones emitted VRD:STRONG in their
     first message); an "incompatible" still ends the chat in any phase;
 11. a rejected invented dealbreaker becomes a FACT CHECK line both clones (and the analysis) see;
 12. each reply starts with a plain-English "SAY:" line for people; messages without one get a
     line from one cached narration call per conversation.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional

from pydantic import BaseModel, Field, field_validator

from ..llm import cache as llm_cache
from ..llm import text, usage
from . import memory
from .questionnaire import get_flexible_items, get_non_negotiables
from .modules import (
    AUTO_LOAD_MODULES,
    LAZY_MODULES,
    build_compressed_profile_summary,
    extract_module_request,
    get_initial_system_prompt,
    get_module,
)

ENGINE_VERSION = "rm2"

# ---------------------------------------------------------------- verbatim from server.py:98-144
PHASES = [
    {
        "name": "introduction",
        "label": "Phase 1 — Introduction",
        "turns": 3,         # total turns in this phase (both agents combined)
        "hint": (
            "[PHASE: INTRODUCTION] "
            "Focus on: who you are, location, budget range, and 1–2 top priorities. "
            "If location is clearly incompatible, say so and end politely now."
        ),
    },
    {
        "name": "exploration",
        "label": "Phase 2 — Lifestyle Exploration",
        "turns": 4,
        "hint": (
            "[PHASE: EXPLORATION] "
            "Go deeper on: sleep schedule, cleanliness, guests, WFH, daily routines. "
            "Share your own preferences and ask theirs. Note where you align and where friction exists."
        ),
    },
    {
        "name": "negotiation",
        "label": "Phase 3 — Negotiation",
        "turns": 4,
        "hint": (
            "[PHASE: NEGOTIATION] "
            "Address any friction points directly. Propose specific compromises on flexible items. "
            "If a non-negotiable conflict surfaces, acknowledge it honestly. "
            "Be concrete — 'I could do X if you're okay with Y.'"
        ),
    },
    {
        "name": "conclusion",
        "label": "Phase 4 — Conclusion",
        "turns": 2,
        "hint": (
            "[PHASE: CONCLUSION] "
            "Wrap up the conversation now. You MUST reach one of three verdicts: "
            "STRONG MATCH, CONDITIONAL MATCH (name the 1–2 unresolved topics), "
            "or INCOMPATIBLE (name the specific reason). "
            "Do not trail off. End naturally and conclusively."
        ),
    },
]

TOTAL_PHASE_TURNS = sum(p["turns"] for p in PHASES)  # = 13 turns max

# rm2: a clone's own answers arrive when its phase starts (the original waited for <<MOD:X>> and
# delivered it one turn late); a <<MOD:X>> request or a topic the other raises still loads it earlier
PHASE_MODULES = {
    "exploration": ("ROUTINES", "SOCIAL", "LIFESTYLE"),
    "negotiation": ("FINANCIAL", "DEALBREAKERS"),
    "conclusion": tuple(LAZY_MODULES),
}

# server.py:390-393
STARTER = "Hey! We've both been matched as potential roommates. Tell me a bit about yourself and what you're looking for?"
HISTORY_WINDOW = 6  # server.py:283

# server.py:517-541 (verbatim)
ANALYSIS_SYSTEM = """You are an expert roommate compatibility analyst.
Analyze the two profiles and their conversation. You MUST respond in the following
exact JSON format — no extra text, no markdown, just valid JSON:

{
  "scores": {
    "overall": 0,
    "finances": 0,
    "lifestyle": 0,
    "personality": 0,
    "logistics": 0
  },
  "highlights": ["string", "string", "string"],
  "concerns": ["string", "string", "string"],
  "dealbreaker_detected": false,
  "dealbreaker_detail": "",
  "middle_ground": ["string", "string"],
  "recommendation": "strong|conditional|incompatible",
  "recommendation_summary": "string (2-3 sentences)"
}

Scores are 0-100. Be specific — reference actual details from profiles and conversation.
dealbreaker_detected is true only if a hard non-negotiable conflict was found.
middle_ground lists concrete compromises that could make a conditional match work.
recommendation must be exactly one of: strong, conditional, incompatible."""


# ---------------------------------------------------------------- verdict: keyword detector (server.py:149-219)

def detect_outcome(conversation: list[dict]) -> dict:
    """Original keyword detector on the last 3 messages, run on cleaned text (see _clean)."""
    tail = " ".join(_clean(m["message"]).lower() for m in conversation[-3:])

    incompatible_signals = [
        "difficult fit", "tough fit", "don't think we'd be a good fit",
        "doesn't seem like we're compatible", "not a great match",
        "dealbreaker", "won't work", "false hope", "hope you find someone",
        "vrd:incompatible", "vrd:[incompatible]",
        "cnf:loc:incompatible", "loc:incompatible", "location mismatch",
        "nn conflict", "non-negotiable conflict", "non negotiable conflict",
    ]
    conditional_signals = [
        "couple of things", "a few things", "weigh in on", "follow up",
        "worth exploring", "potential here", "discuss directly",
        "conditional", "unresolved"
    ]
    strong_signals = [
        "great fit", "really promising", "flag this as a match",
        "strong match", "sounds perfect", "really well", "love this",
        "so aligned", "think we'd work well"
    ]

    if any(s in tail for s in incompatible_signals):
        reason = _extract_reason(tail, "incompatible")
        return {"status": "incompatible", "reason": reason, "unresolved_topics": []}

    if any(s in tail for s in conditional_signals):
        topics = _extract_unresolved_topics(tail)
        return {"status": "conditional", "reason": None, "unresolved_topics": topics}

    if any(s in tail for s in strong_signals):
        return {"status": "strong", "reason": None, "unresolved_topics": []}

    return {"status": "conditional", "reason": "Outcome unclear from conversation", "unresolved_topics": []}


def _extract_reason(text: str, outcome_type: str) -> str:
    patterns = [
        r"think (.{10,80}) makes this",
        r"because (.{10,80})\.",
        r"due to (.{10,80})\.",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1).strip().capitalize()
    return "Incompatible preferences (see conversation for details)"


def _extract_unresolved_topics(text: str) -> list[str]:
    match = re.search(r"specifically (.{5,120}?)[\.\,\!]", text)
    if match:
        raw = match.group(1)
        topics = [t.strip() for t in re.split(r"\band\b", raw) if t.strip()]
        return topics[:2]
    return ["See conversation for details"]


_MOD_TAG = re.compile(r"<<\s*MOD:\s*\w+\s*>>", re.I)
_NEGATED = re.compile(r"\b(no|not a|isn't a|is not a|aren't any|without)\s+(dealbreakers?|nn conflicts?|non-negotiable conflicts?)", re.I)
_NOT_A_VERDICT = re.compile(r"won't work (from|remotely|late|at|on|weekends|nights|in)\b", re.I)


def _clean(message: str) -> str:
    """Fix for the original detector: protocol tags and phrases like "no dealbreakers" or
    "I won't work from home" are not verdicts."""
    return _NOT_A_VERDICT.sub(" ", _NEGATED.sub(" ", _MOD_TAG.sub(" ", message)))


_VRD = re.compile(r"VRD\s*:\s*\[?\s*(STRONG|CONDITIONAL|INCOMPATIBLE)\s*\]?(?:[^\n]*?\|\s*r\s*=\s*\[?([^|\]\n]*)\]?)?(?:[^\n]*?\|\s*open\s*=\s*\[?([^|\]\n]*)\]?)?", re.I)


def parse_vrd(message: str) -> Optional[dict]:
    """The protocol's own verdict line: VRD:[STRONG|CONDITIONAL|INCOMPATIBLE]|r=[reason]|open=[topics]."""
    found = list(_VRD.finditer(message or ""))
    if not found:
        return None
    m = found[-1]
    reason = (m.group(2) or "").strip(" .;") or None
    topics = [t.strip(" .") for t in re.split(r"[;,]|\band\b", m.group(3) or "") if t.strip(" .") and t.strip().lower() not in ("none", "n/a", "-")]
    return {"status": m.group(1).lower(), "reason": reason, "unresolved_topics": topics[:2]}


def decide(conversation: list[dict], spurious: Callable[[str], bool] = lambda t: False, ignored: frozenset[int] | set[int] = frozenset()) -> dict:
    """Both clones' last VRDs if present (any incompatible -> incompatible, both strong -> strong,
    else conditional); otherwise the keyword detector. Strong / conditional count only from the
    conclusion phase. `spurious` rejects an incompatible verdict whose reason the profiles
    contradict (checks.spurious_incompatible)."""
    last: dict[str, dict] = {}
    for m in conversation:
        if m.get("turn") in ignored:
            continue  # a verdict the engine already set aside (invented, or not about a non-negotiable)
        v = parse_vrd(m["message"])
        if not v or (v["status"] == "incompatible" and spurious(v["reason"] or m["message"])):
            continue
        if v["status"] != "incompatible" and m.get("phase", "conclusion") != "conclusion":
            continue  # a provisional verdict (models add one to every message); only the conclusion decides
        last[m["speaker_id"]] = v
    if last:
        vs = list(last.values())
        if any(v["status"] == "incompatible" for v in vs):
            v = next(v for v in vs if v["status"] == "incompatible")
            return {**v, "reason": v["reason"] or "A non-negotiable conflict came up", "source": "vrd"}
        if len(vs) == 2 and all(v["status"] == "strong" for v in vs):
            return {"status": "strong", "reason": None, "unresolved_topics": [], "source": "vrd"}
        topics = [t for v in vs for t in v["unresolved_topics"]]
        return {"status": "conditional" if any(v["status"] == "conditional" for v in vs) else vs[-1]["status"],
                "reason": next((v["reason"] for v in vs if v["reason"]), None),
                "unresolved_topics": list(dict.fromkeys(topics))[:2], "source": "vrd"}
    kw = detect_outcome(conversation)
    if kw["status"] == "incompatible" and spurious(" ".join(m["message"] for m in conversation[-3:])):
        kw = {"status": "conditional", "reason": "Outcome unclear from conversation", "unresolved_topics": []}
    return {**kw, "source": "keywords"}


# ---------------------------------------------------------------- analysis (server.py:497-566)

class Analysis(BaseModel):
    scores: dict[str, int] = Field(default_factory=dict)
    highlights: list[str] = Field(default_factory=list)
    concerns: list[str] = Field(default_factory=list)
    dealbreaker_detected: bool = False
    dealbreaker_detail: str = ""
    middle_ground: list[str] = Field(default_factory=list)
    recommendation: str
    recommendation_summary: str = ""

    @field_validator("scores", mode="before")
    @classmethod
    def _scores(cls, v):
        keys = ("overall", "finances", "lifestyle", "personality", "logistics")
        if not isinstance(v, dict) or not all(k in v for k in keys):
            raise ValueError(f"scores must have {keys}")
        return {k: max(0, min(100, int(round(float(v[k]))))) for k in keys}

    @field_validator("recommendation")
    @classmethod
    def _rec(cls, v):
        v = str(v).strip().lower()
        if v not in ("strong", "conditional", "incompatible"):
            raise ValueError("recommendation must be strong, conditional or incompatible")
        return v


def analysis_user(a: "Agent", b: "Agent", conversation: list[dict], checks: Optional[list[str]] = None) -> str:
    conv_text = "\n".join(f"{m['speaker']}: {m['message']}" for m in conversation)
    rules = "\n".join(f"- {x.name}: non-negotiables: {'; '.join(get_non_negotiables(x.questionnaire)) or 'none'}; "
                      f"flexible on: {'; '.join(get_flexible_items(x.questionnaire)) or 'nothing listed'}; "
                      f"moves in {memory.move_in_phrase(x.questionnaire.get('living', {}).get('move_in_date'))}; "
                      f"wants a {str(x.questionnaire.get('living', {}).get('lease_type') or '?').lower()}" for x in (a, b))
    facts = ("## Non-negotiables and flexibility (from the profiles; only a conflict with a listed non-negotiable is a dealbreaker):\n"
             + rules + "\n\n")
    if checks:
        facts += ("## Fact check (verified by code from both profiles; a conflict the clones claimed against these is not real):\n"
                  + "\n".join(f"- {c}" for c in checks) + "\n\n")
    return (f"## Profile A:\n{build_compressed_profile_summary(a.name, a.questionnaire)}\n\n"
            f"## Profile B:\n{build_compressed_profile_summary(b.name, b.questionnaire)}\n\n"
            f"{facts}## Conversation (all {len(conversation)} turns):\n{conv_text}\n")


# ---------------------------------------------------------------- LLM calls (cached)

def _cached_call(kind: str, system: str, messages: list[dict], **kwargs) -> tuple[object, str]:
    key = llm_cache.key_of([ENGINE_VERSION, kind, system, messages])
    hit = llm_cache.get("roommates", key)
    if hit is not None:
        return hit["value"], "cache"
    with usage.purpose("roommates"):
        res = text.complete(system, messages, **kwargs)
    value = res.value.model_dump() if isinstance(res.value, BaseModel) else res.value
    llm_cache.put("roommates", key, value, provider=res.provider, model=res.model)
    return value, res.provider


def _nonempty(t: object) -> str:
    s = str(t or "").strip()
    if not s:
        raise ValueError("empty reply")
    return s[:4000]  # a long (Claude) reply keeps its last statements and VRD


def turn_llm(system: str, window: list[dict]) -> tuple[str, str]:
    # 1800: Claude Sonnet writes longer turns than the Groq models (1000 truncated it); not part of the cache key
    reply, provider = _cached_call("turn", system, window, json_mode=False, parse=_nonempty, max_tokens=1800, temperature=0.7)
    return str(reply), provider


def analysis_llm(system: str, user: str) -> tuple[dict, str]:
    # 3000: Claude's analysis JSON ran past 1500 tokens; not part of the cache key
    value, provider = _cached_call("analysis", system, [{"role": "user", "content": user}], json_mode=True,
                                   parse=lambda d: Analysis.model_validate(d), max_tokens=3000, temperature=0.3)
    return value, provider


NARRATE_SYSTEM = """You turn a roommate-matching chat between two AI clones into plain English for a human reader.
The clones write a compact protocol (ACP): HI intro, PFR preferences, CNF friction, FLX offer, VRD verdict.
Fields: loc location, mv move-in, bd budget, rm room, smk smoking, pet pets, slp sleep, cln cleanliness 1-5,
gwk guests per week, wfh work from home, nzl noise, usp utilities, groc groceries, dep deposit, nn non-negotiables.
For EACH numbered message write one short, friendly sentence (max 25 words) in first person, as that speaker,
saying what the message means. Use only facts in that message: no new numbers, names or details.
Return JSON: {"lines": ["...", "..."]} with exactly one line per message, in order."""

_NUM = re.compile(r"\d[\d,.]*")


def _numbers(t: str) -> set[str]:
    return {n.replace(",", "").rstrip(".") for n in _NUM.findall(t or "")}


def narrate_user(conversation: list[dict]) -> str:
    return "Messages:\n" + "\n\n".join(f"{i + 1}. {m['speaker']}:\n{m['message']}" for i, m in enumerate(conversation))


def narrate_llm(conversation: list[dict]) -> tuple[list[Optional[str]], str]:
    """One plain-English line per message; a line quoting a number its message doesn't contain is dropped."""
    n = len(conversation)

    def parse(d: object) -> list[str]:
        lines = d.get("lines") if isinstance(d, dict) else None
        if not isinstance(lines, list) or len(lines) != n:
            raise ValueError(f"need exactly {n} lines")
        return [str(x).strip() for x in lines]

    lines, provider = _cached_call("narrate", NARRATE_SYSTEM, [{"role": "user", "content": narrate_user(conversation)}],
                                   json_mode=True, parse=parse, max_tokens=3000, temperature=0.3)
    out: list[Optional[str]] = []
    for line, m in zip(lines, conversation):
        ok = 3 <= len(line.split()) <= 40 and _numbers(line) <= _numbers(m["message"])
        out.append(line[:240] if ok else None)
    return out, provider


def fill_says(conversation: list[dict], narrate=narrate_llm) -> Optional[str]:
    """Give every message a "say" line: its own SAY: line, else the narration's. Returns the provider used."""
    if all(m.get("say") for m in conversation):
        return None
    lines, provider = narrate(conversation)
    for m, line in zip(conversation, lines):
        if not m.get("say") and line:
            m["say"] = line
    return provider


# ---------------------------------------------------------------- agents and the loop

class Agent:
    """One clone (server.py:273-343): system prompt = CORE + LIVING (+ injected modules), own history."""

    def __init__(self, user_id: str, name: str, questionnaire: dict, extra: str = ""):
        self.user_id, self.name, self.questionnaire = user_id, name, questionnaire
        self.history: list[dict] = []
        self.modules = set(AUTO_LOAD_MODULES)
        self.system_prompt = (get_initial_system_prompt(name, questionnaire) + "\n\n" + memory.field_notes(questionnaire)
                              + (f"\n\n{extra}" if extra else ""))

    def inject(self, module: str) -> None:
        if module in self.modules:
            return
        self.modules.add(module)
        self.system_prompt += "\n\n" + get_module(module, self.name, self.questionnaire)

    def respond(self, prompt: str, llm: Callable[[str, list[dict]], tuple[str, str]], record: Optional[str] = None) -> tuple[str, str]:
        """prompt: this turn's full message (memory + the other's labelled reply); record: what stays in
        history ("X's clone said: ..."). The window starts with a user message and holds at most
        HISTORY_WINDOW messages including this one."""
        past = self.history[-(HISTORY_WINDOW - 1):]
        if past and past[0]["role"] == "assistant":
            past = past[1:]
        content, provider = llm(self.system_prompt, [*past, {"role": "user", "content": prompt}])
        self.history += [{"role": "user", "content": record or prompt}, {"role": "assistant", "content": content}]
        mod = extract_module_request(content)
        if mod:
            self.inject(mod)
        return content, provider


@dataclass
class Negotiation:
    a: Agent
    b: Agent
    emit: Callable[[dict], None] = lambda e: None
    turn_llm: Callable[[str, list[dict]], tuple[str, str]] = turn_llm
    analysis_llm: Callable[[str, str], tuple[dict, str]] = analysis_llm
    spurious: Callable[[str], bool] = lambda t: False  # see decide()
    fact_check: Callable[[str], list[str]] = lambda t: []  # code's correction for a rejected verdict
    nn_conflict: Callable[[str], bool] = lambda t: True  # does a verdict's reason name a non-negotiable? (checks.nn_conflict)
    negotiable: Callable[[str], list[str]] = lambda t: []  # code's note when an early verdict names none
    narrate: Callable[[list[dict]], tuple[list[Optional[str]], str]] = narrate_llm
    conversation: list[dict] = field(default_factory=list)
    memory: memory.Memory = field(default_factory=memory.Memory)
    providers: dict[str, int] = field(default_factory=dict)
    ignored: list[int] = field(default_factory=list)  # turns whose "incompatible" was rejected

    def run(self) -> dict:
        """ChatRoom.run_conversation + analyze, with the fixes listed at the top of this file."""
        phase_idx, phase_turns, turn_no = 0, 0, 0
        speaker, other = self.a, self.b
        current = STARTER
        early: Optional[dict] = None
        self.emit({"type": "phase_start", "phase": PHASES[0]["name"], "label": PHASES[0]["label"]})
        while True:
            turn_no += 1
            phase = PHASES[phase_idx]
            sid, oid = ("a", "b") if speaker is self.a else ("b", "a")
            for topic in memory.mentioned(current):  # the other raised it: have your own answers first
                if topic in memory.TOPIC_MODULE:
                    speaker.inject(memory.TOPIC_MODULE[topic])
            prompt = memory.turn_prompt(hint=phase["hint"], turn=turn_no, total=TOTAL_PHASE_TURNS, phase=phase["name"],
                                        me=speaker.name, other=other.name, mine=self.memory.told[sid], theirs=self.memory.told[oid],
                                        checks=self.memory.checks, incoming=current, opening=turn_no == 1,
                                        nn=get_non_negotiables(speaker.questionnaire), flex=get_flexible_items(speaker.questionnaire))
            reply, provider = speaker.respond(prompt, self.turn_llm, record=memory.compact(other.name, current))
            self.providers[provider] = self.providers.get(provider, 0) + 1
            msg = {"speaker": speaker.name, "speaker_id": sid, "message": reply, "say": memory.say_line(reply),
                   "turn": turn_no, "phase": phase["name"], "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            self.conversation.append(msg)
            self.memory.add(sid, reply)
            self.emit({"type": "agent_message", "data": msg})
            v = parse_vrd(reply)
            if (v and v["status"] == "incompatible") or detect_outcome(self.conversation[-3:])["status"] == "incompatible":
                reason = (v or {}).get("reason") or reply
                # before the conclusion only a non-negotiable ends the chat (rm2); anything else is negotiated
                binding = phase["name"] == "conclusion" or self.nn_conflict(reason)
                early = decide(self.conversation, self.spurious, set(self.ignored)) if binding else None
                if early and early["status"] == "incompatible":
                    break
                early = None
                if (v and v["status"] == "incompatible") or detect_outcome([msg])["status"] == "incompatible":
                    self.ignored.append(turn_no)  # this reply's own verdict was rejected
                    for line in (self.fact_check(reason) if binding else self.negotiable(reason)):
                        self.memory.fact(line)
            current = reply
            speaker, other = other, speaker
            phase_turns += 1
            if phase_turns >= phase["turns"]:
                if phase_idx == len(PHASES) - 1:
                    break  # conclusion done (fix: the original reset the counter first and never got here)
                phase_idx += 1
                phase_turns = 0
                new = PHASES[phase_idx]
                for m in PHASE_MODULES.get(new["name"], ()):
                    self.a.inject(m)
                    self.b.inject(m)
                self.emit({"type": "phase_start", "phase": new["name"], "label": new["label"]})
            if turn_no >= TOTAL_PHASE_TURNS + 2:  # safety limit, as in the original
                break
        outcome = early or decide(self.conversation, self.spurious, set(self.ignored))
        self.emit({"type": "analyzing"})
        try:
            analysis, provider = self.analysis_llm(ANALYSIS_SYSTEM, analysis_user(self.a, self.b, self.conversation, self.memory.checks))
            self.providers[provider] = self.providers.get(provider, 0) + 1
        except text.TextError:
            analysis = None
        try:
            provider = fill_says(self.conversation, self.narrate)
            if provider:
                self.providers[provider] = self.providers.get(provider, 0) + 1
        except text.TextError:
            pass  # the chat still shows the protocol statements
        if analysis and outcome.get("reason") == "Outcome unclear from conversation":
            outcome = {**outcome, "status": analysis["recommendation"], "reason": None, "source": "analysis"}
        elif (analysis and outcome["status"] != "incompatible" and analysis.get("dealbreaker_detected")
              and analysis["recommendation"] == "incompatible" and not self.spurious(analysis.get("dealbreaker_detail") or "dealbreaker")
              and self.nn_conflict(analysis.get("dealbreaker_detail") or "")):  # rm2: only a real non-negotiable overrides the clones
            outcome = {"status": "incompatible", "reason": analysis.get("dealbreaker_detail") or "A dealbreaker came up",
                       "unresolved_topics": [], "source": "analysis"}
        return {"outcome": outcome, "analysis": analysis, "messages": self.conversation, "turns": len(self.conversation)}
