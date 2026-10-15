"""AI roommate finder: clones of students negotiate in 4 phases and end strong / conditional / incompatible.

The engine is a port of Tanvi's (GitHub Tanvi-15) AI-Roommate-Finder, github.com/Tanvi-15/AI-Roommate-Finder
(commit bd93b04, 2026-03-22):
    questionnaire.py   verbatim copy of shared/questionnaire.py (7 sections, 45 questions)
    modules.py         verbatim copy of shared/module_registry.py (ACP/1.0 clone prompts, lazy modules)
    engine.py          PHASES, detect_outcome, Agent, ChatRoom loop and analysis from backend/server.py,
                       with the fixes listed at the top of that file
Added for FitSplit: checks.py (exact budget / gender checks, ROOM module, group verdict for
"Fill a room"), service.py (local JSON storage instead of MongoDB/OAuth, background runs) and
api.py (REST + Server-Sent Events instead of WebSockets).
"""
