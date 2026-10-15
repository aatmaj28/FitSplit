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
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional

from pydantic import BaseModel, Field, field_validator

from ..llm import cache as llm_cache
from ..llm import text, usage
from .modules import (
    AUTO_LOAD_MODULES,
    LAZY_MODULES,
    build_compressed_profile_summary,
    extract_module_request,
    get_initial_system_prompt,
    get_module,
)

ENGINE_VERSION = "rm1"

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


def decide(conversation: list[dict], spurious: Callable[[str], bool] = lambda t: False) -> dict:
    """Both clones' last VRDs if present (any incompatible -> incompatible, both strong -> strong,
    else conditional); otherwise the keyword detector. `spurious` rejects an incompatible verdict
    whose reason the profiles contradict (checks.spurious_incompatible)."""
    last: dict[str, dict] = {}
    for m in conversation:
        v = parse_vrd(m["message"])
        if v and not (v["status"] == "incompatible" and spurious(m["message"])):
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


def analysis_user(a: "Agent", b: "Agent", conversation: list[dict]) -> str:
    conv_text = "\n".join(f"{m['speaker']}: {m['message']}" for m in conversation)
    return (f"## Profile A:\n{build_compressed_profile_summary(a.name, a.questionnaire)}\n\n"
            f"## Profile B:\n{build_compressed_profile_summary(b.name, b.questionnaire)}\n\n"
            f"## Conversation (all {len(conversation)} turns):\n{conv_text}\n")


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
    return s[:1500]


def turn_llm(system: str, window: list[dict]) -> tuple[str, str]:
    reply, provider = _cached_call("turn", system, window, json_mode=False, parse=_nonempty, max_tokens=1000, temperature=0.7)
    return str(reply), provider


def analysis_llm(system: str, user: str) -> tuple[dict, str]:
    value, provider = _cached_call("analysis", system, [{"role": "user", "content": user}], json_mode=True,
                                   parse=lambda d: Analysis.model_validate(d), max_tokens=1500, temperature=0.3)
    return value, provider


# ---------------------------------------------------------------- agents and the loop

class Agent:
    """One clone (server.py:273-343): system prompt = CORE + LIVING (+ injected modules), own history."""

    def __init__(self, user_id: str, name: str, questionnaire: dict, extra: str = ""):
        self.user_id, self.name, self.questionnaire = user_id, name, questionnaire
        self.history: list[dict] = []
        self.modules = set(AUTO_LOAD_MODULES)
        self.system_prompt = get_initial_system_prompt(name, questionnaire) + (f"\n\n{extra}" if extra else "")

    def inject(self, module: str) -> None:
        if module in self.modules:
            return
        self.modules.add(module)
        self.system_prompt += "\n\n" + get_module(module, self.name, self.questionnaire)

    def respond(self, message: str, llm: Callable[[str, list[dict]], tuple[str, str]]) -> tuple[str, str]:
        self.history.append({"role": "user", "content": message})
        content, provider = llm(self.system_prompt, self.history[-HISTORY_WINDOW:])
        self.history.append({"role": "assistant", "content": content})
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
    conversation: list[dict] = field(default_factory=list)
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
            reply, provider = speaker.respond(f"{phase['hint']}\n\n{current}", self.turn_llm)
            self.providers[provider] = self.providers.get(provider, 0) + 1
            msg = {"speaker": speaker.name, "speaker_id": "a" if speaker is self.a else "b", "message": reply,
                   "turn": turn_no, "phase": phase["name"], "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            self.conversation.append(msg)
            self.emit({"type": "agent_message", "data": msg})
            v = parse_vrd(reply)
            if (v and v["status"] == "incompatible") or detect_outcome(self.conversation[-3:])["status"] == "incompatible":
                early = decide(self.conversation, self.spurious)
                if early["status"] == "incompatible":
                    break
                early = None
                if (v and v["status"] == "incompatible") or detect_outcome([msg])["status"] == "incompatible":
                    self.ignored.append(turn_no)  # this reply's own verdict was rejected
            current = reply
            speaker, other = other, speaker
            phase_turns += 1
            if phase_turns >= phase["turns"]:
                if phase_idx == len(PHASES) - 1:
                    break  # conclusion done (fix: the original reset the counter first and never got here)
                phase_idx += 1
                phase_turns = 0
                new = PHASES[phase_idx]
                if new["name"] == "negotiation":
                    self.a.inject("DEALBREAKERS")
                    self.b.inject("DEALBREAKERS")
                if new["name"] == "conclusion":
                    for m in LAZY_MODULES:
                        self.a.inject(m)
                        self.b.inject(m)
                self.emit({"type": "phase_start", "phase": new["name"], "label": new["label"]})
            if turn_no >= TOTAL_PHASE_TURNS + 2:  # safety limit, as in the original
                break
        outcome = early or decide(self.conversation, self.spurious)
        self.emit({"type": "analyzing"})
        try:
            analysis, provider = self.analysis_llm(ANALYSIS_SYSTEM, analysis_user(self.a, self.b, self.conversation))
            self.providers[provider] = self.providers.get(provider, 0) + 1
        except text.TextError:
            analysis = None
        if analysis and outcome.get("reason") == "Outcome unclear from conversation":
            outcome = {**outcome, "status": analysis["recommendation"], "reason": None, "source": "analysis"}
        elif (analysis and outcome["status"] != "incompatible" and analysis.get("dealbreaker_detected")
              and analysis["recommendation"] == "incompatible" and not self.spurious(analysis.get("dealbreaker_detail") or "dealbreaker")):
            outcome = {"status": "incompatible", "reason": analysis.get("dealbreaker_detail") or "A dealbreaker came up",
                       "unresolved_topics": [], "source": "analysis"}
        return {"outcome": outcome, "analysis": analysis, "messages": self.conversation, "turns": len(self.conversation)}
