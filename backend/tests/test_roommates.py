"""Roommate finder port: seed data vs the questionnaire, verdict parsing (with the fixes), the
13-turn phase loop and module injection, exact checks, group verdict, storage and the API.
Model calls are always faked."""
from __future__ import annotations

import json

import pytest

from app.roommates import engine, service
from app.roommates.checks import RoomContext, budget_check, gender_check, group_verdict
from app.roommates.questionnaire import get_all_questions, validate_questionnaire
from app.roommates.seed import PROFILES


def test_seed_profiles_use_exact_questionnaire_options():
    schema = get_all_questions()
    for p in PROFILES:
        assert validate_questionnaire(p["questionnaire"]) == [], p["id"]
        for section, fields in schema.items():
            for key, spec in fields.items():
                v = p["questionnaire"][section][key]
                opts = spec.get("options")
                if spec["type"] == "select" and isinstance(opts, list):
                    assert v in opts, (p["id"], section, key, v)
                if spec["type"] == "multiselect":
                    assert set(v) <= set(opts), (p["id"], key, set(v) - set(opts))
                    assert len(v) <= spec.get("max_select", 99)
    assert len(PROFILES) == 10 and len({p["school"] for p in PROFILES}) == 6


@pytest.mark.parametrize("msg,status,reason,topics", [
    ("PFR:[cln:4]\nVRD:[STRONG]|r=[aligned on cleanliness and budget]|open=[none]", "strong", "aligned on cleanliness and budget", []),
    ("VRD: CONDITIONAL | r=guests | open=quiet hours; cleaning rota", "conditional", "guests", ["quiet hours", "cleaning rota"]),
    ("so... vrd:[incompatible]|r=[smoking indoors]", "incompatible", "smoking indoors", []),
])
def test_parse_vrd(msg, status, reason, topics):
    v = engine.parse_vrd(msg)
    assert (v["status"], v["reason"], v["unresolved_topics"]) == (status, reason, topics)


def _msgs(*texts):
    return [{"speaker": "A" if i % 2 == 0 else "B", "speaker_id": "a" if i % 2 == 0 else "b", "message": t} for i, t in enumerate(texts)]


def test_detector_fixes():
    # the original read these as incompatible
    for text in ("CNF:[nzl:minor] <<MOD:DEALBREAKERS>>", "No dealbreakers on my side!", "I won't work from home much."):
        assert engine.detect_outcome(_msgs(text))["status"] != "incompatible", text
    assert engine.detect_outcome(_msgs("Smoking indoors is a dealbreaker for me."))["status"] == "incompatible"


def test_decide_prefers_vrd():
    assert engine.decide(_msgs("VRD:[STRONG]|r=x", "VRD:[STRONG]|r=y"))["status"] == "strong"
    assert engine.decide(_msgs("VRD:[STRONG]", "VRD:[CONDITIONAL]|open=[guests]"))["unresolved_topics"] == ["guests"]
    d = engine.decide(_msgs("VRD:[STRONG]", "VRD:[INCOMPATIBLE]|r=[noise]"))
    assert (d["status"], d["reason"], d["source"]) == ("incompatible", "noise", "vrd")
    assert engine.decide(_msgs("This sounds perfect, great fit!"))["source"] == "keywords"


class FakeLLM:
    """Scripted clone replies; records every window it is sent."""

    def __init__(self, replies=None):
        self.windows, self.systems, self.replies = [], [], list(replies or [])

    def turn(self, system, window):
        self.windows.append(window)
        self.systems.append(system)
        n = len(self.windows)
        return (self.replies.pop(0) if self.replies else f"PFR:[turn:{n}]"), "fake"

    def analysis(self, system, user):
        return {"scores": {"overall": 80, "finances": 70, "lifestyle": 85, "personality": 75, "logistics": 90}, "highlights": [],
                "concerns": [], "dealbreaker_detected": False, "dealbreaker_detail": "", "middle_ground": [],
                "recommendation": "strong", "recommendation_summary": "ok"}, "fake"

    def narrate(self, conversation):
        self.narrated = [m["turn"] for m in conversation if not m.get("say")]
        return [f"Turn {m['turn']} in plain words." for m in conversation], "fake"


def _agents(b="ananya"):
    p = {x["id"]: x for x in PROFILES}
    return (engine.Agent("priya", "Priya", p["priya"]["questionnaire"]), engine.Agent(b, p[b]["name"].split()[0], p[b]["questionnaire"]))


def _neg(a, b, llm, **kw):
    return engine.Negotiation(a, b, turn_llm=llm.turn, analysis_llm=llm.analysis, narrate=llm.narrate, **kw)


def test_loop_runs_13_turns_with_phase_modules():
    a, b = _agents()
    llm, events = FakeLLM(), []
    out = _neg(a, b, llm, emit=events.append).run()
    assert out["turns"] == 13 and [m["speaker_id"] for m in out["messages"]].count("a") == 7
    phases = [e["phase"] for e in events if e["type"] == "phase_start"]
    assert phases == ["introduction", "exploration", "negotiation", "conclusion"]  # no duplicate conclusion events
    assert [m["phase"] for m in out["messages"]] == ["introduction"] * 3 + ["exploration"] * 4 + ["negotiation"] * 4 + ["conclusion"] * 2
    # rm2: own answers arrive when the phase starts (exploration: routines / social / lifestyle; negotiation: financial + dealbreakers)
    assert all(f"## MOD:{m}" in llm.systems[3] for m in ("ROUTINES", "SOCIAL", "LIFESTYLE")) and "## MOD:ROUTINES" not in llm.systems[2]
    assert "## MOD:DEALBREAKERS" in llm.systems[7] and "## MOD:DEALBREAKERS" not in llm.systems[6] and "## MOD:FINANCIAL" in llm.systems[7]
    assert all(f"## MOD:{m}" in llm.systems[11] for m in engine.LAZY_MODULES)
    assert all(len(w) <= engine.HISTORY_WINDOW and w[0]["role"] == "user" for w in llm.windows)
    # turn 2 (B): the other clone's reply arrives once, labelled, with the phase hint (the original sent it twice, unlabelled)
    assert [m["role"] for m in llm.windows[1]] == ["user"]
    assert 'Priya\'s clone just said:\n"""\nPFR:[turn:1]\n"""' in llm.windows[1][0]["content"] and llm.windows[1][0]["content"].startswith("[PHASE: INTRODUCTION]")
    assert engine.STARTER in llm.windows[0][0]["content"] and "The app opened the chat with:" in llm.windows[0][0]["content"]
    # history keeps only who said what; the memory block is rebuilt for the current turn
    assert llm.windows[2][0]["content"] == f"Ananya's clone said:\n{engine.STARTER}" or llm.windows[2][0]["content"].startswith("Ananya's clone said:")
    # no SAY lines from the fake clones: one narration call fills them
    assert llm.narrated == list(range(1, 14)) and all(m["say"] == f"Turn {m['turn']} in plain words." for m in out["messages"])
    # no verdict lines -> keywords say unclear -> the analysis recommendation decides
    assert out["outcome"]["source"] == "analysis" and out["outcome"]["status"] == "strong"


def test_requested_module_is_injected_for_next_turn():
    a, b = _agents()
    llm = FakeLLM(["HI:[loc:Boston] <<MOD:FINANCIAL>>"])
    _neg(a, b, llm).run()
    assert "## MOD:FINANCIAL — Priya" not in llm.systems[0] and "## MOD:FINANCIAL — Priya" in llm.systems[2]


def test_incompatible_vrd_stops_early():
    a, b = _agents()
    llm = FakeLLM(["HI:[loc:Boston]", "CNF:[smk:conflict] VRD:[INCOMPATIBLE]|r=[smoking indoors]|open=[none]"])
    out = _neg(a, b, llm).run()
    assert out["turns"] == 2 and out["outcome"]["status"] == "incompatible" and out["outcome"]["reason"] == "smoking indoors"


def test_budget_and_gender_checks():
    q = {"living": {"budget_max": 1400, "budget_flexibility": "Hard limit — cannot go over"}}
    assert budget_check("R", q, 1360)["ok"] and not budget_check("R", q, 1401)["ok"]
    q2 = {"living": {"budget_max": 1400, "budget_flexibility": "Can flex up to ~$100"}}
    within = budget_check("R", q2, 1488)
    assert within["ok"] and "inside their flex" in within["detail"] and not budget_check("R", q2, 1501)["ok"]
    a = {"living": {"gender": "Woman", "roommate_gender": "Same gender only"}}
    assert not gender_check("A", a, "B", {"living": {"gender": "Man"}})["ok"]
    assert gender_check("A", a, "B", {"living": {"gender": "Woman"}})["ok"]


def test_group_verdict_rules():
    r = [{"member": "Sofia", "status": "strong"}, {"member": "Arjun", "status": "incompatible"}, {"member": "Kai", "status": "conditional"}]
    assert group_verdict(r, "all")["match"] is False and "Arjun said no" in group_verdict(r, "all")["summary"]
    assert group_verdict(r, "majority")["match"] is True and group_verdict(r, "majority")["status"] == "conditional"
    assert group_verdict(r[:1], "all")["status"] == "strong"


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "DATA", tmp_path)
    monkeypatch.setattr(service, "PROFILES", tmp_path / "profiles.json")
    monkeypatch.setattr(service, "NEGOTIATIONS", tmp_path / "negotiations")
    monkeypatch.setattr(service, "BACKGROUND", False)
    monkeypatch.setattr(service, "RUNNING", {})
    (tmp_path / "profiles.json").write_text(json.dumps(PROFILES))
    llm = FakeLLM()
    calls = []

    def runner(neg):
        calls.append(neg)
        neg.turn_llm, neg.analysis_llm, neg.narrate = llm.turn, llm.analysis, llm.narrate
        return neg.run()

    monkeypatch.setattr(service, "RUNNER", runner)
    return calls


ROOM = RoomContext(plan="jvue_3bed", unit_name="JVUE 3 bed", rent_total=4200, beds=3, room_id="r5", room_label="Bedroom 2 (DREAM)",
                   area_sqft=196.1, share=1360, private_bath=False,
                   members=[{"profile_id": "arjun", "name": "Arjun Reddy", "room_label": "Bedroom 1", "share": 1352},
                            {"profile_id": "sofia", "name": "Sofia Alvarez", "room_label": "Bedroom 3", "share": 1488}])


def test_budget_dealbreaker_ends_before_any_model_call(store):
    rec = service.start("kavya", "arjun", ROOM)
    assert store == [] and rec["status"] == "complete"
    assert rec["result"]["status"] == "incompatible" and rec["result"]["source"] == "exact_check"
    assert "$1,360/mo is above Kavya Nair's hard cap ($1,250)" == rec["result"]["reason"]


def test_fill_room_passes_room_context_and_caches(store):
    out = service.fill_room("rohan", ["arjun", "sofia"], ROOM, "all")
    assert len(store) == 2 and out["group"]["members"] == 2
    cand_prompt = store[0].a.system_prompt
    assert "## MOD:ROOM — Rohan Mehta" in cand_prompt and "share:$1,360/mo" in cand_prompt and "current_roommates:Arjun Reddy, Sofia Alvarez" in cand_prompt
    assert "you_pay:$1,352/mo" in store[0].b.system_prompt
    checks = service.load_negotiation(out["negotiations"][0]["id"])["checks"]
    assert next(c for c in checks if c["id"] == "budget")["ok"]
    again = service.fill_room("rohan", ["arjun", "sofia"], ROOM, "all")
    assert len(store) == 2 and [n["id"] for n in again["negotiations"]] == [n["id"] for n in out["negotiations"]]


def test_api_and_stream(store, client):
    r = client.post("/api/roommates/negotiations", json={"a": "priya", "b": "ananya"})
    assert r.status_code == 200 and r.json()["status"] == "complete"
    nid = r.json()["id"]
    body = client.get(f"/api/roommates/negotiations/{nid}/stream").text
    assert body.count("event: agent_message") == 13 and "event: complete" in body
    assert client.get("/api/roommates/negotiations/n_missing").status_code == 404
    assert client.post("/api/roommates/negotiations", json={"a": "priya", "b": "nobody"}).status_code == 404
    groups = client.post("/api/roommates/groups", json={"profile_ids": ["priya", "ananya"], "size": 2}).json()
    assert groups[0]["members"] == ["ananya", "priya"] and groups[0]["budget_max"] == 2850
    assert client.get("/api/roommates/questionnaire").json()["sections"]["living"]


def test_room_module_settles_budget_for_both_sides():
    from app.roommates.checks import room_module

    cand = room_module("Rohan Mehta", ROOM, "candidate", ["Arjun Reddy", "Sofia Alvarez"])
    member = room_module("Sofia Alvarez", ROOM, "member", ["Rohan Mehta", "Arjun Reddy"])
    assert "budget_check:PASSED" in cand and "never call it a mismatch" in cand
    assert "budget:SETTLED" in member and "Do not compare budget ranges" in member and "you_pay:$1,488/mo" in member


def test_usage_log_redacts_account_ids():
    from app.llm.usage import redact

    assert redact("429 ... in organization `org_01exampleexampleexample` service tier") == "429 ... in organization `org_…` service tier"
    assert redact("bad key gsk_abcdefghijklmnop") == "bad key gsk_…"


def test_spurious_incompatible_guard():
    from app.roommates.checks import spurious_incompatible

    p = {x["id"]: x["questionnaire"] for x in PROFILES}
    # two non-smokers "disagreeing" about smoking: invented conflict
    assert spurious_incompatible("VRD:[INCOMPATIBLE]|r=[No smoking indoors is a hard non-negotiable]", p["rohan"], p["sofia"], True)
    # a real smoker: the verdict stands
    assert not spurious_incompatible("VRD:[INCOMPATIBLE]|r=[smoking indoors]", p["jake"], p["arjun"], True)
    # budget already settled by code in fill-a-room, but not in find mode
    assert spurious_incompatible("VRD:INCOMPATIBLE|r=Budget mismatch", p["rohan"], p["sofia"], True)
    assert not spurious_incompatible("VRD:INCOMPATIBLE|r=Budget mismatch", p["rohan"], p["sofia"], False)
    # a lifestyle reason alongside: never second-guessed; "different" is not "rent"
    assert not spurious_incompatible("VRD:INCOMPATIBLE|r=smoking and loud parties", p["rohan"], p["sofia"], True)
    assert not spurious_incompatible("VRD:INCOMPATIBLE|r=different expectations", p["rohan"], p["sofia"], True)


def test_spurious_verdict_does_not_stop_the_chat():
    a, b = _agents()
    llm = FakeLLM(["HI:[loc:Boston]", "VRD:[INCOMPATIBLE]|r=[no smoking indoors]"])
    neg = _neg(a, b, llm, spurious=lambda t: "smoking" in t.lower())
    out = neg.run()
    assert out["turns"] == 13 and neg.ignored == [2] and out["outcome"]["status"] == "strong"


def test_analysis_dealbreaker_overrides_soft_verdict():
    a, b = _agents()
    llm = FakeLLM(["VRD:[CONDITIONAL]|open=[smoking]"] * 13)

    def analysis(system, user):
        v, _ = FakeLLM().analysis(system, user)
        return {**v, "dealbreaker_detected": True, "dealbreaker_detail": "Jake smokes indoors", "recommendation": "incompatible"}, "fake"

    out = engine.Negotiation(a, b, turn_llm=llm.turn, analysis_llm=analysis, narrate=llm.narrate).run()
    assert (out["outcome"]["status"], out["outcome"]["source"]) == ("incompatible", "analysis")


def test_lease_mismatch_caps_a_strong_verdict(store):
    from app.roommates.checks import logistics_checks

    p = {x["id"]: x for x in PROFILES}
    checks = logistics_checks(p["priya"]["name"], p["priya"]["questionnaire"], p["meera"]["name"], p["meera"]["questionnaire"])
    lease = next(c for c in checks if c["id"] == "lease")
    assert not lease["ok"] and "1-year lease" in lease["detail"] and "6-month lease" in lease["detail"]
    # Ananya lists lease length as flexible: fine
    assert all(c["ok"] for c in logistics_checks("A", p["ananya"]["questionnaire"], "M", p["meera"]["questionnaire"]) if c["id"] == "lease")
    rec = service.start("priya", "meera")  # the fake clones agree on everything ("strong" by analysis)
    assert rec["result"]["status"] == "conditional" and rec["result"]["source"] == "exact_check"
    assert "lease length" in rec["result"]["unresolved_topics"]


# ---------------------------------------------------------------- engine rm2: the clones use what the other said

def test_memory_keeps_the_others_facts_past_the_history_window():
    a, b = _agents()
    llm = FakeLLM(["SAY: Hi, I'm Priya from Fenway.\nHI:loc=Boston/Fenway|bd=1100-1450|mv=1-3 months"])
    out = _neg(a, b, llm).run()
    assert out["messages"][0]["say"] == "Hi, I'm Priya from Fenway."
    late = llm.windows[9]  # Ananya's 5th turn: Priya's intro left her window long ago...
    assert not any("HI:loc=Boston" in m["content"] for m in late[:-1])
    # ...but the memory block still tells her, so she never has to ask again
    assert "ALREADY TOLD YOU by Priya" in late[-1]["content"] and "bd=1100-1450" in late[-1]["content"]
    first = llm.windows[1][-1]["content"]
    assert "STILL OPEN" in first and "ask Priya about smoking, pets, non-negotiables, priorities" in first
    assert "Your HI must state loc, mv, bd, smk, pet and nn" in first and "YOUR non-negotiables are exactly: No smoking indoors; No pets" in first


def test_a_topic_the_other_raises_loads_your_module_before_you_reply():
    a, b = _agents()
    llm = FakeLLM(["PFR:usp=Split equally|dep=500"])
    _neg(a, b, llm).run()
    assert "## MOD:FINANCIAL — Ananya" in llm.systems[1]  # turn 2, still in the introduction phase


def test_a_provisional_verdict_does_not_decide():
    a, b = _agents()
    replies = ["HI:loc=Boston VRD:STRONG|r=All initial criteria align|open=none"] + [f"PFR:[turn:{n}]" for n in range(2, 12)] \
        + ["VRD:CONDITIONAL|r=guests|open=guest policy", "VRD:CONDITIONAL|r=guests|open=guest policy"]
    out = _neg(a, b, FakeLLM(replies)).run()
    assert out["outcome"]["status"] == "conditional" and out["outcome"]["unresolved_topics"] == ["guest policy"]
    # only the turn-1 VRD: the conclusion said nothing, so it is unclear (analysis decides), never the early "strong"
    out = _neg(a, b, FakeLLM(replies[:1])).run()
    assert out["outcome"]["source"] == "analysis"


def test_a_rejected_dealbreaker_becomes_a_fact_check_for_both_clones():
    from app.roommates.checks import fact_check_lines, spurious_incompatible

    p = {x["id"]: x for x in PROFILES}
    a, b = _agents("kavya")
    pa, pk = p["priya"]["questionnaire"], p["kavya"]["questionnaire"]
    llm = FakeLLM(["HI:loc=Boston", "CNF:pet:conflict(you love pets) VRD:INCOMPATIBLE|r=Pet preference conflicts with my allergy"])
    neg = _neg(a, b, llm, spurious=lambda t: spurious_incompatible(t, pa, pk, False),
               fact_check=lambda t: fact_check_lines(t, "Priya Sharma", pa, "Kavya Nair", pk, False))
    out = neg.run()
    assert out["turns"] == 13 and neg.ignored == [2]
    assert "FACT CHECK" not in llm.windows[1][-1]["content"]
    for w in (llm.windows[2], llm.windows[3]):  # both clones see it from the next turn on
        assert "FACT CHECK" in w[-1]["content"] and "Nobody has a pet" in w[-1]["content"] and "liking pets is not having one" in w[-1]["content"]
    assert fact_check_lines("VRD:INCOMPATIBLE|r=smoking indoors", "Jake Thompson", p["jake"]["questionnaire"], "Priya Sharma", pa, False) == []


def test_narration_drops_lines_with_invented_numbers(monkeypatch):
    conv = [{"speaker": "Priya", "turn": 1, "message": "HI:bd=1100-1450"}, {"speaker": "Ananya", "turn": 2, "message": "PFR:cln=4", "say": "Mine."}]
    monkeypatch.setattr(engine, "_cached_call", lambda *a, **k: (["My budget is $1,100 to $1,450 a month.", "I keep things at a 4, and pay a $500 deposit."], "fake"))
    lines, _ = engine.narrate_llm(conv)
    assert lines == ["My budget is $1,100 to $1,450 a month.", None]  # "$500" is not in the second message
    engine.fill_says(conv, engine.narrate_llm)
    assert conv[0]["say"].startswith("My budget") and conv[1]["say"] == "Mine."  # a clone's own SAY line wins


def test_say_line_parsing():
    from app.roommates.memory import mentioned, say_line, stated

    assert say_line("SAY: I sleep early and keep things tidy.\nPFR:slp=Early bird|cln=4") == "I sleep early and keep things tidy."
    assert say_line("**SAY:** Sounds good to me! PFR:cln=4") == "Sounds good to me!"
    assert say_line("PFR:cln=4") is None and say_line("SAY: ok") is None
    assert stated("PFR:[slp:Early bird, cln:5, gwk:0]") == {"sleep": {"slp": "Early bird"}, "cleanliness": {"cln": "5"}, "guests": {"gwk": "0"}}
    assert mentioned("CNF:pet:conflict(loves pets|allergic)") == {"pets"}


def test_an_early_verdict_that_names_no_non_negotiable_does_not_end_the_chat():
    from app.roommates.checks import negotiable_lines, nn_conflict

    p = {x["id"]: x for x in PROFILES}
    a, b = _agents("meera")
    pa, pm = p["priya"]["questionnaire"], p["meera"]["questionnaire"]
    llm = FakeLLM(["HI:loc=Boston"] + [f"PFR:[turn:{n}]" for n in range(2, 8)] + ["VRD:INCOMPATIBLE|r=Social frequency and noise levels are fundamental mismatches"])
    neg = _neg(a, b, llm, nn_conflict=lambda t: nn_conflict(t, pa, pm), negotiable=lambda t: negotiable_lines(t, "Priya Sharma", pa, "Meera Patel", pm))
    out = neg.run()
    assert out["turns"] == 13 and neg.ignored == [8]
    note = llm.windows[8][-1]["content"]
    assert "only a non-negotiable ends the chat" in note and "Meera: Noise levels; Guest frequency; Chore split style" in note
    assert out["outcome"]["status"] != "incompatible"  # the set-aside verdict doesn't decide either
    # a real non-negotiable (smoking) still ends it at once, as does any verdict in the conclusion
    assert nn_conflict("Jake smokes", pa, p["jake"]["questionnaire"]) and not nn_conflict("guests and noise", pa, pm)
    llm = FakeLLM(["HI:loc=Boston", "VRD:INCOMPATIBLE|r=I smoke indoors"])
    assert _neg(a, b, llm, nn_conflict=lambda t: nn_conflict(t, pa, pm)).run()["turns"] == 2


def test_analysis_override_needs_a_real_non_negotiable():
    from app.roommates.checks import nn_conflict

    p = {x["id"]: x for x in PROFILES}
    a, b = _agents("meera")
    pa, pm = p["priya"]["questionnaire"], p["meera"]["questionnaire"]
    llm = FakeLLM(["VRD:[CONDITIONAL]|open=[lease]"] * 13)
    seen = []

    def analysis(system, user):
        seen.append(user)
        v, _ = FakeLLM().analysis(system, user)
        return {**v, "dealbreaker_detected": True, "dealbreaker_detail": "The lease term is a hard non-negotiable", "recommendation": "incompatible"}, "fake"

    out = engine.Negotiation(a, b, turn_llm=llm.turn, analysis_llm=analysis, narrate=llm.narrate, nn_conflict=lambda t: nn_conflict(t, pa, pm)).run()
    assert out["outcome"]["status"] == "conditional"  # the lease is in nobody's non-negotiables
    assert "Meera: non-negotiables: Non-smoking household only; flexible on: Noise levels; Guest frequency; Chore split style" in seen[0]


def test_field_notes_tell_move_in_from_lease_length():
    a, b = _agents("meera")
    assert "you move in 1–3 months from now. It is NOT how long you stay" in a.system_prompt and "yours is a 1-year lease" in a.system_prompt
    assert "you move in within a month from now" in b.system_prompt and "yours is a 6-month lease" in b.system_prompt
    seen = []
    llm = FakeLLM()
    engine.Negotiation(a, b, turn_llm=llm.turn, analysis_llm=lambda s, u: (seen.append(u), llm.analysis(s, u))[1], narrate=llm.narrate).run()
    assert "Meera: non-negotiables: Non-smoking household only; flexible on: Noise levels; Guest frequency; Chore split style; moves in within a month from now; wants a 6-month lease" in seen[0]


def test_a_conditional_verdict_also_lists_code_verified_open_points(store, monkeypatch):
    llm = FakeLLM(["HI:loc=Boston"] * 11 + ["VRD:CONDITIONAL|r=guests|open=guest policy"] * 2)

    def runner(neg):
        neg.turn_llm, neg.analysis_llm, neg.narrate = llm.turn, llm.analysis, llm.narrate
        return neg.run()

    monkeypatch.setattr(service, "RUNNER", runner)
    rec = service.start("priya", "meera")
    assert rec["result"]["status"] == "conditional" and rec["result"]["unresolved_topics"] == ["lease length", "guest policy"]


def test_house_rules_merge_pairs_and_drop_invented_numbers(store, monkeypatch):
    from app.roommates import engine as eng
    from app.roommates import house_rules as hr

    recs = [service.start("priya", "ananya"), service.start("priya", "meera"), service.start("ananya", "meera")]
    for r in recs:
        r["messages"][0]["say"] = "Quiet after 11:30 pm, and we split utilities on Splitwise."
        service._save(r)
    seen = []

    def fake(kind, system, messages, **kw):
        seen.append(messages[0]["content"])
        return kw["parse"]({"rules": [{"topic": "quiet hours", "text": "Shared spaces go quiet after 11:30 pm."},
                                      {"topic": "costs", "text": "Utilities are split on Splitwise."},
                                      {"topic": "guests", "text": "At most 47 guests, home by 58 pm."}],  # 47 and 58 appear nowhere
                            "open": ["lease length"]}), "fake"

    monkeypatch.setattr(hr, "_cached_call", fake)
    out = hr.house_rules(["priya", "ananya", "meera"], [r["id"] for r in recs])
    assert [r["topic"] for r in out["rules"]] == ["quiet hours", "costs"] and out["open"] == ["lease length"]
    assert out["key"] == "ananya+meera+priya" and hr.stored("ananya+meera+priya")["rules"] == out["rules"]
    assert "## Priya + Ananya" in seen[0] and "Open topics:" in seen[0]
    assert eng  # engine import stays used
