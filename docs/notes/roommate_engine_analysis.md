# AI-Roommate-Finder: engine analysis for the FastAPI port

Source: `external/AI-Roommate-Finder` (GitHub `Tanvi-15/AI-Roommate-Finder`). This is a read-only static analysis dated 2026-10-15. Nothing in the repo was run, installed or modified. Every `file:line` reference points into that checkout, using the line numbers an editor shows.

Privacy and secrets: no personal data was copied. `data/users.json` is described by schema only, with placeholder values. The clone contains no `.env` file, so environment variables are listed by name only (section 10).

---

## 0. Key facts

- **Questionnaire.** 7 sections, 45 questions, 17 of them required. The README says "50+", which is wrong. There are two copies of the schema:
  - Python, `shared/questionnaire.py`. This is the canonical copy, used by Streamlit and by validation.
  - React, `frontend/src/pages/Questionnaire.tsx`. It has the same keys, types and required flags, but 28 of the 45 fields use shorter answer strings.
- **Clone.** A clone is an LLM system prompt that the code calls "ACP/1.0", built from the questionnaire.
  - At the start it holds two modules, CORE and LIVING.
  - Five "lazy" modules are added when the agent's own reply contains `<<MOD:NAME>>`.
  - Some modules are also added by force: DEALBREAKERS when negotiation starts, and all five when conclusion starts.
- **Negotiation.**
  - Agent A (the user who clicked "like") always speaks first, and the two agents strictly alternate.
  - Phases advance only by turn count: 3/4/4/2 turns, 13 in total as advertised.
  - Because of a bug, the conclusion phase actually runs 4 turns. A full chat is therefore **15 turns** (A speaks 8 times, B 7 times) and is ended by a safety limit.
  - A chat can end early only when a keyword detector flags "incompatible".
- **LLM calls per negotiation.** One per turn (at most 15) plus 1 analysis call, so **at most 16**.
  - Every call uses Groq `llama-3.3-70b-versatile` (env `GROQ_MODEL`), `temperature=0.7`, `max_tokens=500`.
  - JSON mode is never used, and the app adds no retries of its own. The Groq SDK retries twice by default.
- **Verdict.**
  - The stored `status` (`strong` / `conditional` / `incompatible`) comes from **keyword substring matching on the last 3 chat messages** (`detect_outcome`). It does not come from the LLM.
  - The single analysis call returns 0-100 scores (`overall`, `finances`, `lifestyle`, `personality`, `logistics`) and its own `recommendation`. These are stored and displayed, but they never affect `status`.
  - There are **no numeric thresholds** anywhere.
- **Dealbreakers and budget.** These are enforced **by prompt text only**. The only checks in code are:
  - candidate pre-filtering on same city or metro area, and on a two-way "Same gender only" preference;
  - the keyword detector.

---

## 1. Overview

### 1.1 Architecture

```
React SPA (Vite, shadcn)  --REST, cookie JWT-->  FastAPI  backend/server.py  --pymongo-->  MongoDB
  pages/*.tsx, lib/api.ts                          |  in-memory: agents{}, chat_rooms{}, connections{}
  (AgentChat page exists but nothing links to it)  |  Agent  (one LLM persona per user)
                                                   |  ChatRoom (phased loop, verdict, analysis)
Streamlit app.py (legacy UI)  --REST + WS-->       |  shared/clone.py -> shared/module_registry.py (prompts)
  also imports shared/database.py directly         |  shared/groq_client.py --> Groq chat.completions
```

### 1.2 Data flow: questionnaire, clone, negotiation, result

1. **Profile.** The questionnaire is stored as a nested dict, `user.questionnaire[section][field]`.
   - React saves the whole form with `PUT /auth/me {questionnaire}` on every Next/Back/Finish (`Questionnaire.tsx:304-314, 354-375`).
   - Streamlit runs `validate_questionnaire` and then calls `save_user` directly (`app.py:374-391`).
2. **Discovery.** `GET /users/candidates` returns profiles in the same city or metro area that pass the gender preference check in both directions. Profiles already liked or passed are excluded (`server.py:991-1101`).
3. **Like.** `POST /matches/like {target_email}` saves the interaction, then starts `asyncio.create_task(_run_background_negotiation(me, target))` and returns at once (`server.py:790-838`).
4. **Clones.** `Agent(user_id=email, name, questionnaire)` builds its system prompt with `generate_clone_prompt` (CORE+LIVING) (`server.py:285-292`, `clone.py:26-44`).
5. **Negotiation.** `ChatRoom.run_conversation(delay=1.0)` runs alternating turns through the phases. Modules are appended to each agent's system prompt as needed, and the keyword incompatibility check runs after every turn (`server.py:373-495`).
6. **Verdict.** `detect_outcome(conversation)` produces `{status, reason, unresolved_topics}` (`server.py:149-219`).
7. **Analysis.** `ChatRoom.analyze()` makes one LLM call with two compressed profiles and the last 10 messages, and returns `{"structured": bool, "data": ...}` (`server.py:497-566`).
8. **Persist.** `save_match(room, analysis)` upserts a match record (`match_id = room_id`) into the `matches` collection (`server.py:588-608`).
9. **Results.** `GET /matches?user_id=<email>` serves the My Matches page. **Both** users see the match, even though only one of them clicked like.

The manual path is driven only by Streamlit. React has the page but no route reaches it.
- `POST /agents` for A and for B.
- Optionally, `POST /agents/{id}/validate` (3 LLM calls per clone).
- `POST /rooms`.
- WebSocket `/ws/{room_id}`: send `{"action":"start"}` and watch the live stream; then send `{"action":"analyze"}`, which runs `save_match`.
- On this path a match record is saved **only if** Analyze is clicked.

### 1.3 File map

| File | Lines | Implements |
|---|---|---|
| `shared/questionnaire.py` | 7-15 | `CITY_OPTIONS` (31 cities) |
| | 17-110, 116-137, 143-188, 194-225, 231-262, 268-284, 290-346 | The 7 section dicts: living, financial, routines, social, lifestyle, personality, dealbreakers |
| | 353-363 / 366-376 | `get_all_questions()` (section key mapped to dict) / `get_section_labels()` |
| | 379-401 | Accessors: `get_non_negotiables`, `get_flexible_items`, `get_top_priorities`, `get_budget_flexibility` (default `"No preference"`), `get_user_gender` (default `"Prefer not to say"`) |
| | 404-415 / 418-460 | `get_required_fields()` (unused) / `validate_questionnaire()` (called only by Streamlit) |
| `shared/module_registry.py` | 39-44 / 51-72 | `ACP_FIELD_TABLE` / `ACP_PROTOCOL` prompt constants |
| | 79-137 | `build_core` (CORE persona module) |
| | 140-247 | `build_living`, `build_financial`, `build_routines`, `build_social`, `build_lifestyle`, `build_dealbreakers` |
| | 254-268 | `MODULE_BUILDERS`, `AUTO_LOAD_MODULES=["CORE","LIVING"]`, `LAZY_MODULES` |
| | 271-293 | `get_module()`, `get_initial_system_prompt()` (CORE + `"\n\n"` + LIVING) |
| | 296-307 | `extract_module_request()` (`<<MOD:NAME>>` regex) |
| | 310-335 | `build_compressed_profile_summary()` (profile text for the analysis prompt) |
| `shared/clone.py` | 26-44 / 47-53 | `generate_clone_prompt()` (calls `get_initial_system_prompt`) / `get_clone_intro()` |
| `shared/groq_client.py` | 18 / 21-46 / 49-69 / 72-82 | Groq client built at import / `chat()` / `chat_stream()` / `check_ollama_running()`, `generate()` |
| `shared/config.py` | 1-43 | Environment variables and constants |
| `shared/database.py` | 14-308 | MongoDB data access: users, matches, interactions, photos |
| `backend/server.py` | 98-144 | `PHASES` (names, labels, turn budgets, hint prompts), `TOTAL_PHASE_TURNS=13` |
| | 149-219 | `detect_outcome`, `_extract_reason`, `_extract_unresolved_topics` (keyword verdict) |
| | 273-343 | `Agent`: history, `HISTORY_WINDOW=6`, module injection, `get_response` |
| | 348-569 | `ChatRoom`: `run_conversation` (373-495), `analyze` (497-566), `stop` |
| | 574-583 / 588-613 | `broadcast` (WebSocket fan-out) / `save_match`, `get_matches_for_user` |
| | 618-782 | Auth endpoints, session cookie, photo upload |
| | 787-838 | Like/pass, `_run_background_negotiation` |
| | 843-1101 | REST: health, clone intro/chat, agents, validate, rooms, matches, candidates |
| | 1106-1166 | WebSocket `/ws/{room_id}` (`start` / `stop` / `analyze`) |
| `app.py` (Streamlit) | 283-391, 467-519, 526-636, 643-900, 907-1047 | Questionnaire form, clone chat, A/B setup with validation, live agent chat and analysis view, matches |
| `auth.py`, `session_utils.py` | 1-244, 1-32 | bcrypt email/password, Google OAuth (authlib), JWT HS256 session token |
| `frontend/src/pages/Questionnaire.tsx` | 23-107, 109-175, 268-375 | React copy of the schema, backend-to-frontend value map, defaults, step validation, save |
| `frontend/src/pages/SetupMatch.tsx` | 36-188 | Hinge-style card, Like/Pass |
| `frontend/src/pages/AgentChat.tsx` | 13-237 | Live WebSocket chat viewer, outcome and analysis cards (no route reaches it) |
| `frontend/src/pages/MyMatches.tsx` | 14-140 | Match list, counts, sub-score tiles |
| `frontend/src/pages/MyClone.tsx` | 13-149 | Preview chat with your own clone |
| `frontend/src/lib/api.ts`, `hooks/useWebSocket.ts`, `components/StatusBadge.tsx` | 1-129, 1-42, 1-29 | REST client, WebSocket hook, verdict badge |

---

## 2. The questionnaire

### 2.1 Stored shape

```json
{
  "living":       {"city": "...", "neighborhood": "...", "occupation": "...", "gender": "...", "move_in_date": "...",
                   "lease_type": "...", "budget_min": 800, "budget_max": 1500, "budget_flexibility": "...",
                   "room_type": "...", "bathroom_preference": "...", "roommate_gender": "...", "pets": "...",
                   "smoking": "...", "drinking": "..."},
  "financial":    {"utilities_split": "...", "groceries_split": "...", "security_deposit": "...", "payment_style": "..."},
  "routines":     {"sleep_schedule": "...", "wake_time": "...", "cooking_habits": "...", "kitchen_sharing": "...",
                   "bathroom_time": "...", "common_space_usage": "...", "cleanliness": 3, "cleaning_schedule": "..."},
  "social":       {"noise_level": "...", "overnight_guests": "...", "guest_notice": "...", "parties": "...", "introvert_extrovert": 3},
  "lifestyle":    {"work_from_home": "...", "quiet_hours_needed": "...", "schedule_predictability": "...",
                   "temperature_preference": "...", "hobbies": "free text", "lifestyle_notes": "free text"},
  "personality":  {"conflict_style": "...", "communication_style": "...", "roommate_relationship": "..."},
  "dealbreakers": {"non_negotiables": ["..."], "top_priorities": ["...", "...", "..."], "flexible_on": ["..."], "custom_dealbreaker": "free text"}
}
```

Each field holds the **literal option string** the user picked. No codes or enum IDs are used, and the prompt builders substitute these strings directly into the LLM prompts.

Field counts per section: living 15, financial 4, routines 8, social 5, lifestyle 6, personality 3, dealbreakers 4. Total 45.

### 2.2 Canonical Python schema (`shared/questionnaire.py:7-346`), complete

The structure below matches the Python dicts exactly. Keys that the code does not set are omitted. `"options": "CITY_OPTIONS"` refers to the list defined under `CITY_OPTIONS`.

```json
{
  "CITY_OPTIONS": ["Boston", "Cambridge", "Somerville", "Brookline", "Allston", "Brighton",
    "Medford", "Watertown", "Newton", "Quincy",
    "New York", "Brooklyn", "Queens", "Manhattan", "Bronx",
    "San Francisco", "Oakland", "Berkeley", "San Jose", "Palo Alto",
    "Los Angeles", "Chicago", "Seattle", "Austin", "Denver",
    "Portland", "Philadelphia", "Washington DC", "Miami", "Atlanta",
    "Other"],

  "living": {
    "city": {"question": "What city are you looking to live in?", "type": "select", "options": "CITY_OPTIONS", "required": true},
    "neighborhood": {"question": "Neighborhood or specific area (optional)", "type": "text", "placeholder": "e.g., South Boston, Back Bay, Downtown"},
    "occupation": {"question": "What is your occupation?", "type": "select", "options": ["Student", "Working Professional", "Freelancer / Self-employed", "Between jobs", "Other"], "required": true},
    "gender": {"question": "What is your gender?", "type": "select", "options": ["Man", "Woman", "Non-binary", "Prefer not to say"], "required": true, "help": "Used to match 'same gender only' preferences accurately."},
    "move_in_date": {"question": "When are you looking to move in?", "type": "select", "options": ["ASAP", "Within 1 month", "1–3 months", "3–6 months", "Flexible"]},
    "lease_type": {"question": "What kind of lease do you prefer?", "type": "select", "options": ["Month-to-month", "6-month lease", "1-year lease", "No preference"]},
    "budget_min": {"question": "Minimum monthly budget ($)", "type": "number", "min": 300, "max": 5000, "default": 800, "required": true},
    "budget_max": {"question": "Maximum monthly budget ($)", "type": "number", "min": 300, "max": 5000, "default": 1500, "required": true},
    "budget_flexibility": {"question": "How flexible is your budget?", "type": "select", "options": ["Hard limit — cannot go over", "Can flex up to ~$100", "Can flex up to ~$200", "Fairly flexible if the fit is right"], "priority_field": true, "required": true},
    "room_type": {"question": "Room preference", "type": "select", "options": ["Private room", "Shared room", "Either is fine"], "required": true},
    "bathroom_preference": {"question": "Bathroom preference", "type": "select", "options": ["Private bathroom", "Shared with 1 person", "Shared with 2+ people", "No preference"]},
    "roommate_gender": {"question": "Roommate gender preference", "type": "select", "options": ["Same gender only", "Any gender", "No preference"], "required": true},
    "pets": {"question": "Pet situation", "type": "select", "options": ["I have pets", "I love pets but don't have any", "No pets please", "Allergic to pets"], "required": true},
    "smoking": {"question": "Smoking preference", "type": "select", "options": ["I smoke", "Okay with smokers", "Non-smoking household only"], "required": true},
    "drinking": {"question": "Drinking habits", "type": "select", "options": ["Never", "Socially", "Regularly"], "required": true}
  },

  "financial": {
    "utilities_split": {"question": "How do you prefer to split utilities (electricity, internet, etc.)?", "type": "select", "options": ["Split equally", "Split by usage/room size", "Included in rent", "Discuss case by case"]},
    "groceries_split": {"question": "How do you feel about shared groceries?", "type": "select", "options": ["Completely separate groceries", "Split basics (condiments, cleaning)", "Fully shared groceries", "Open to discussing"]},
    "security_deposit": {"question": "Can you cover a security deposit upfront?", "type": "select", "options": ["Yes, up to 1 month's rent", "Yes, up to 2 months' rent", "Need to split the deposit", "Not sure yet"]},
    "payment_style": {"question": "How do you prefer to handle shared payments?", "type": "select", "options": ["One person pays, others Venmo/Zelle", "Each person pays their share directly", "Shared app (Splitwise, etc.)", "No preference"]}
  },

  "routines": {
    "sleep_schedule": {"question": "What's your typical sleep schedule?", "type": "select", "options": ["Early bird (sleep before 10pm)", "Night owl (sleep after midnight)", "Somewhere in between", "Varies a lot"], "required": true},
    "wake_time": {"question": "What time do you usually wake up?", "type": "select", "options": ["Before 6am", "6am–8am", "8am–10am", "After 10am", "Varies"]},
    "cooking_habits": {"question": "How often do you cook at home?", "type": "select", "options": ["Daily — I cook most meals", "A few times a week", "Rarely, mostly takeout/delivery", "Meal prep on weekends only"]},
    "kitchen_sharing": {"question": "How do you feel about sharing kitchen time/space?", "type": "select", "options": ["Happy to share and cook together sometimes", "Prefer separate times in the kitchen", "No strong preference", "I barely use the kitchen"]},
    "bathroom_time": {"question": "How long do you typically spend in the bathroom in the morning?", "type": "select", "options": ["Under 15 minutes", "15–30 minutes", "30–45 minutes", "Over 45 minutes"]},
    "common_space_usage": {"question": "How do you use common spaces (living room, etc.)?", "type": "select", "options": ["I spend a lot of time in common areas", "I mostly stay in my room", "Balanced use", "Depends on day"]},
    "cleanliness": {"question": "How would you rate your cleanliness standard? (1 = Relaxed, 5 = Spotless)", "type": "slider", "min": 1, "max": 5, "default": 3, "required": true},
    "cleaning_schedule": {"question": "How do you prefer to handle shared cleaning?", "type": "select", "options": ["Rotating chore chart", "Clean as you go / whoever notices", "Hire a cleaner and split cost", "Discuss and decide together"]}
  },

  "social": {
    "noise_level": {"question": "What's your noise and social preference at home?", "type": "select", "options": ["Very quiet, minimal guests", "Occasional friends over (weekends)", "Social and lively, guests often", "Balance of both — depends on the week"], "required": true},
    "overnight_guests": {"question": "How often might you have overnight guests?", "type": "select", "options": ["Never / very rarely", "Occasionally (once a month or less)", "Regularly (weekly)", "Partner stays over frequently"], "required": true},
    "guest_notice": {"question": "When having guests over, would you give advance notice?", "type": "select", "options": ["Always give notice", "Usually, for anything more than 1–2 people", "No strong opinion", "Prefer spontaneous — it's a shared home"]},
    "parties": {"question": "Are you okay with occasional parties or gatherings at home?", "type": "select", "options": ["Yes, I'd love that", "Small gatherings only (< 10 people)", "Rarely, and with advance notice", "No parties please"]},
    "introvert_extrovert": {"question": "How would you describe yourself socially?", "type": "slider", "min": 1, "max": 5, "default": 3, "labels": ["Very Introverted", "Very Extroverted"]}
  },

  "lifestyle": {
    "work_from_home": {"question": "Do you work or study from home?", "type": "select", "options": ["Yes, full-time remote", "Hybrid (a few days a week)", "No, I go to office/school daily", "Varies by week"]},
    "quiet_hours_needed": {"question": "Do you need quiet hours for work/study calls?", "type": "select", "options": ["Yes, I'm on calls frequently during the day", "Occasionally — a few times a week", "Rarely, headphones handle it", "No, not an issue"]},
    "schedule_predictability": {"question": "How predictable is your daily schedule?", "type": "select", "options": ["Very consistent — same routine daily", "Mostly consistent with some variation", "Quite unpredictable / shift work", "Changes by season / project"]},
    "temperature_preference": {"question": "What's your thermostat preference at home?", "type": "select", "options": ["Cool (below 68°F / 20°C)", "Moderate (68–72°F / 20–22°C)", "Warm (above 72°F / 22°C)", "No strong preference"]},
    "hobbies": {"question": "What are your main hobbies or interests?", "type": "text", "placeholder": "e.g., gaming, cooking, hiking, music, yoga..."},
    "lifestyle_notes": {"question": "Anything else about your lifestyle a potential roommate should know?", "type": "text", "placeholder": "e.g., I practice guitar, I keep odd hours during finals, I fast in the mornings..."}
  },

  "personality": {
    "conflict_style": {"question": "How do you prefer to handle conflicts?", "type": "select", "options": ["Direct conversation immediately", "Cool off first, then discuss", "Write it out (text/note)", "Prefer to avoid if possible"]},
    "communication_style": {"question": "How do you prefer to communicate with your roommate day-to-day?", "type": "select", "options": ["Group chat / text for everything", "Talk in person when needed", "Keep it minimal — respect each other's space", "A mix depending on the situation"]},
    "roommate_relationship": {"question": "What kind of relationship do you want with your roommate?", "type": "select", "options": ["Close friends — hang out regularly", "Friendly but independent", "Cordial — mutual respect, mostly separate lives", "No preference"]}
  },

  "dealbreakers": {
    "non_negotiables": {"question": "Select your absolute NON-NEGOTIABLES (things you will not compromise on):", "type": "multiselect", "options": ["No smoking indoors", "No pets", "No overnight guests", "Strict quiet hours (e.g., no noise after 10pm)", "Must keep kitchen very clean", "No parties ever", "Same gender roommate only", "Budget hard cap (cannot exceed max)", "Must be okay with my pet(s)", "Non-smoking household only"], "required": true, "help": "Select at least 1. These will never be compromised in matching."},
    "top_priorities": {"question": "What are your TOP 3 priorities in a roommate?", "type": "multiselect", "options": ["Compatible sleep schedule", "Similar cleanliness standards", "Respectful of quiet/work time", "Budget compatibility", "Pet-friendly", "Matching social energy", "Location match", "Honest communication style", "Similar guest/party preferences"], "max_select": 3, "required": true, "help": "Choose up to 3. These guide what your clone fights for in negotiation."},
    "flexible_on": {"question": "What are you MOST flexible on? (things you're willing to negotiate)", "type": "multiselect", "options": ["Budget (within reason)", "Move-in date", "Lease length", "Chore split style", "Grocery arrangement", "Guest frequency", "Noise levels", "Temperature preference"]},
    "custom_dealbreaker": {"question": "Any other dealbreakers not listed above?", "type": "text", "placeholder": "e.g., Must be okay with incense, no loud phone calls in common areas after 9pm..."}
  }
}
```

Section labels (`get_section_labels`, `questionnaire.py:366-376`). Each label starts with an emoji, omitted here:
- living: "Living Preferences"
- financial: "Financial & Utilities"
- routines: "Daily Routines"
- social: "Guests & Social Life"
- lifestyle: "Work & Lifestyle"
- personality: "Personality & Communication"
- dealbreakers: "Dealbreakers & Priorities"

`priority_field` is never read anywhere, and `get_required_fields` is unused.

The 17 required fields are:
- living (11): city, occupation, gender, budget_min, budget_max, budget_flexibility, room_type, roommate_gender, pets, smoking, drinking
- routines (2): sleep_schedule, cleanliness
- social (2): noise_level, overnight_guests
- dealbreakers (2): non_negotiables, top_priorities

### 2.3 React schema (`Questionnaire.tsx:33-107`): what users of the React app actually store

The keys, types and required flags are identical to the Python schema, with one exception: `lifestyle_notes` is a `textarea`. Labels are shorter. The section titles are "Living Preferences", "Financial & Utilities", "Daily Routines", "Guests & Social", "Work & Lifestyle", "Personality & Conflict" and "Dealbreakers & Priorities", each with an emoji prefix.

**Option strings differ for 28 fields.** "= Py" below means the options match the Python list exactly.

| section.key | React label | React options |
|---|---|---|
| living.city | City (req) | = Py (`CITY_OPTIONS`) |
| living.neighborhood | Neighborhood (optional) | text, placeholder `e.g. South Boston, Back Bay, Downtown` |
| living.occupation | Occupation (req) | = Py |
| living.gender | Your gender (req) | = Py |
| living.move_in_date | Move-in date | = Py |
| living.lease_type | Lease preference | = Py |
| living.budget_min | Min budget ($) (req) | number, min 300, max 5000, default 800 |
| living.budget_max | Max budget ($) (req) | number, min 300, max 5000, default 1500 |
| living.budget_flexibility | Budget flexibility (req) | `Hard limit`, `Can flex ~$100`, `Can flex ~$200`, `Fairly flexible` |
| living.room_type | Room type (req) | = Py |
| living.bathroom_preference | Bathroom | `Private`, `Shared with 1`, `Shared 2+`, `No preference` |
| living.roommate_gender | Roommate gender pref (req) | = Py |
| living.pets | Pets (req) | `I have pets`, `I love pets`, `No pets please`, `Allergic` |
| living.smoking | Smoking (req) | `I smoke`, `Okay with smokers`, `Non-smoking only` |
| living.drinking | Drinking (req) | = Py |
| financial.utilities_split | Split utilities | = Py |
| financial.groceries_split | Shared groceries | `Completely separate`, `Split basics`, `Fully shared`, `Open to discussing` |
| financial.security_deposit | Security deposit | `Yes up to 1 month`, `Yes up to 2 months`, `Need to split`, `Not sure` |
| financial.payment_style | Shared payments | `One pays + Venmo/Zelle`, `Each pays share`, `Shared app`, `No preference` |
| routines.sleep_schedule | Sleep schedule (req) | `Early bird`, `Night owl`, `In between`, `Varies a lot` |
| routines.wake_time | Wake time | `Before 6am`, `6–8am`, `8–10am`, `After 10am`, `Varies` |
| routines.cooking_habits | Cooking frequency | `Daily`, `A few times/week`, `Rarely/takeout`, `Meal prep weekends` |
| routines.kitchen_sharing | Kitchen sharing | `Happy to share/cook together`, `Separate times`, `No preference`, `Barely use` |
| routines.bathroom_time | Morning bathroom time | `Under 15 min`, `15–30`, `30–45`, `Over 45 min` |
| routines.common_space_usage | Common space use | `Lots in common areas`, `Mostly in room`, `Balanced`, `Depends` |
| routines.cleanliness | Cleanliness (1=Relaxed, 5=Spotless) (req) | slider 1-5, default 3 |
| routines.cleaning_schedule | Cleaning approach | `Chore chart`, `Clean as you go`, `Hire cleaner`, `Discuss together` |
| social.noise_level | Noise/social at home (req) | `Very quiet`, `Occasional friends`, `Social/lively`, `Balance` |
| social.overnight_guests | Overnight guests (req) | `Never`, `Occasionally`, `Regularly`, `Partner often` |
| social.guest_notice | Guest notice | `Always`, `Usually for 1–2+`, `No strong opinion`, `Spontaneous` |
| social.parties | Parties at home | `Yes`, `Small only (<10)`, `Rarely with notice`, `No` |
| social.introvert_extrovert | Social spectrum (1=Intro, 5=Extro) | slider 1-5, default 3 |
| lifestyle.work_from_home | Work from home | `Full-time remote`, `Hybrid`, `No/office daily`, `Varies` |
| lifestyle.quiet_hours_needed | Quiet hours for calls | `Yes frequently`, `Occasionally`, `Rarely/headphones`, `No` |
| lifestyle.schedule_predictability | Schedule predictability | `Very consistent`, `Mostly consistent`, `Unpredictable/shift`, `Changes by season` |
| lifestyle.temperature_preference | Thermostat | `Cool`, `Moderate`, `Warm`, `No preference` |
| lifestyle.hobbies | Hobbies/interests | text, placeholder `gaming, cooking, hiking…` |
| lifestyle.lifestyle_notes | Other notes | **textarea**, no placeholder |
| personality.conflict_style | Handle conflicts | `Direct conversation`, `Cool off then discuss`, `Write it out`, `Prefer to avoid` |
| personality.communication_style | Communication style | `Group chat/text`, `Talk in person`, `Minimal/respect space`, `Mix` |
| personality.roommate_relationship | Roommate relationship | `Close friends`, `Friendly but independent`, `Cordial/separate`, `No preference` |
| dealbreakers.non_negotiables | Non-negotiables (select at least 1) (req) | `No smoking indoors`, `No pets`, `No overnight guests`, `Strict quiet hours`, `Kitchen very clean`, `No parties ever`, `Same gender only`, `Budget hard cap`, `Must be okay with my pet(s)`, `Non-smoking only` |
| dealbreakers.top_priorities | Top 3 priorities (max 3) (req, `max: 3`) | `Compatible sleep`, `Cleanliness`, `Quiet/work time`, `Budget`, `Pet-friendly`, `Social energy`, `Location`, `Communication`, `Guest/party preferences` |
| dealbreakers.flexible_on | Most flexible on | `Budget`, `Move-in date`, `Lease length`, `Chore split`, `Grocery`, `Guest frequency`, `Noise`, `Temperature` |
| dealbreakers.custom_dealbreaker | Other dealbreakers | text, placeholder `Anything else?` |

`BACKEND_TO_FRONTEND` (`Questionnaire.tsx:109-120`) maps Python strings to React strings when an existing profile is loaded into the form. It is applied to scalar values and to every array element:

```
'Hard limit — cannot go over' -> 'Hard limit'          'Can flex up to ~$100' -> 'Can flex ~$100'
'Can flex up to ~$200' -> 'Can flex ~$200'             'Fairly flexible if the fit is right' -> 'Fairly flexible'
'Private bathroom' -> 'Private'                        'Shared with 1 person' -> 'Shared with 1'
'Shared with 2+ people' -> 'Shared 2+'                 "I love pets but don't have any" -> 'I love pets'
'Allergic to pets' -> 'Allergic'                       'Non-smoking household only' -> 'Non-smoking only'
```

There is no mapping for any other field, so a profile saved in Streamlit shows blank selects when it is opened in React. The form also has a backward-compatibility rule: an old `living.location` value becomes `city` if it is one of the `CITY_OPTIONS`. Otherwise `city` is set to `'Other'` and `neighborhood` to the old location (`Questionnaire.tsx:149-159`).

### 2.4 Defaults and validation

**Default values in each place:**
- **Python schema `default`:** set only for `budget_min` 800, `budget_max` 1500, `cleanliness` 3 and `introvert_extrovert` 3.
- **React `getDefaultValues`** (`Questionnaire.tsx:163-175`):
  - multiselect: `[]`
  - number and slider: `default ?? min ?? 0`, giving the same four numbers
  - every select, text and textarea: `''` (empty string)
  - then `living.gender = 'Prefer not to say'`
  - Optional selects the user never touches are therefore **saved as `''`**.
- **Streamlit** (`app.py:310-365`):
  - select: the stored value, or else the **first option**
  - number and slider: the stored value, or else the default
  - multiselect: the stored list, or else `[]`
  - text: the stored value, or else `''`
- **Prompt builder fallbacks** (`module_registry.py`):
  - a missing key prints `'?'`; a key that is present but holds `''` prints empty
  - `budget_min` 800, `budget_max` 1500, `roommate_gender` `"No preference"`
  - `cleanliness` 3 (described as `moderate`), `introvert_extrovert` 3 (described as `balanced`)
  - `hobbies` and `lifestyle_notes` print `'none'` when missing
  - `budget_flexibility` falls back to `"No preference"` and gender to `"Prefer not to say"`

**Validation rules in each place:**
- **Python `validate_questionnaire`** (`questionnaire.py:418-460`, used only by Streamlit):
  - required text must be non-blank (no required text field exists)
  - required number must not be `None` and must not be `0`
  - required multiselect must have at least one item
  - select and slider fields are not checked
  - cross-field: `budget_min > budget_max` is an error
  - `max_select` is not checked here; Streamlit truncates the list to 3 and shows a warning (`app.py:362-364`)
- **React `validateStep`** (`Questionnaire.tsx:268-292`), run on each step:
  - required fields must not be `undefined`, `''` or `null`
  - required multiselect must be non-empty
  - on the living step, min must be at most max
  - the `max` of 3 is enforced in the checkbox UI
- **Backend:** `PUT /auth/me` does **no validation at all** (`server.py:726-743`).

### 2.5 Legacy data file (`data/users.json`): do not import it

No code references this file. It holds 2 real user records under an old schema; never copy its contents. Its shape, with placeholders:

```json
{"<email>": {"email": "<email>", "name": "<name>", "created_at": "<iso>", "updated_at": "<iso>",
  "questionnaire": {
    "living": {"location": "<str>", "budget_min": 0, "budget_max": 0, "room_type": "<str>", "bathroom_preference": "<str>",
               "roommate_gender": "<str>", "pets": "<str>", "smoking": "<str>"},
    "personality": {"sleep_schedule": "<str>", "cleanliness": 0, "noise_level": "<str>", "introvert_extrovert": 0,
                    "work_from_home": "<str>", "conflict_style": "<str>", "hobbies": "<str>", "dealbreaker": "<str>"}}}}
```

This old schema explains the `living.get('city', living.get('location', '?'))` fallbacks in the prompt builders and the candidate filter.

---

## 3. LLM prompts, verbatim

### 3.0 Parameters common to every call

Every LLM call goes through `shared/groq_client.chat(messages, system_prompt)` (`groq_client.py:21-46`). It builds `[{"role":"system","content":system_prompt}] + messages` and calls `client.chat.completions.create` with:
- `model=GROQ_MODEL`: env var, default `"llama-3.3-70b-versatile"` (`config.py:28`)
- `max_tokens=500`
- `temperature=0.7`

It does not set `response_format`, stop sequences, `top_p` or a seed. The one exception is the Streamlit clone chat, which uses `chat_stream` with the same parameters plus `stream=True` (`groq_client.py:49-69`).

None of the prompts below contain tabs or trailing spaces. Special characters are copied exactly: `—` (U+2014), `–` (U+2013), `→`, `≥`.

### P1. CORE module: the clone persona (`module_registry.py:118-132`, built by `build_core` at 79-137)

This text is the start of each agent's system prompt. It is a Python f-string, verbatim:

```text
## CORE — {name}
You ARE {name}. First person only. Never break character.
loc:{loc_str}|mv:{living.get('move_in_date','?')}|{budget_rule}
{gender_rule}
occ:{living.get('occupation','?')}|smk:{living.get('smoking','?')}|drink:{living.get('drinking','?')}
pet:{living.get('pets','?')}|rm:{living.get('room_type','?')}
NN(non-negotiable):{nn_compact}
PRI(top priorities):{pri_compact}

If NN conflict detected → acknowledge immediately, end politely, emit VRD:INCOMPATIBLE.
Never negotiate past a hard limit.

{ACP_FIELD_TABLE}

{ACP_PROTOCOL}
```

**Where each variable comes from** (`living = questionnaire["living"]`):
- `name`: the user's display name (`user.name`), defaulting to `"User A"`/`"User B"` in the background flow (`server.py:822-823`).
- `loc_str`: `f"{city}/{neighborhood}"` when neighborhood is truthy, otherwise `city`. Here `city = living.get('city', living.get('location', '?'))` and `neighborhood = living.get('neighborhood', '')`.
- `budget_rule`: computed from `budget_flex = living.get("budget_flexibility", "No preference")`, `budget_min = living.get("budget_min", 800)` and `budget_max = living.get("budget_max", 1500)`. Each test is a substring check:
  - contains `"Hard limit"`: `bd:{min}-{max}(HARD_CAP)`
  - contains `"~$100"`: `bd:{min}-{max}(flex+100_private)`
  - contains `"~$200"`: `bd:{min}-{max}(flex+200_private)`
  - anything else: `bd:{min}-{max}(flexible)`
- `gender_rule`:
  - if `living.get("roommate_gender","No preference") == "Same gender only"`: `gnd:{user_gender}|roommate_gnd:SAME_ONLY(NON_NEG)`
  - otherwise: `gnd:{user_gender}|roommate_gnd:any`
  - `user_gender = living.get("gender","Prefer not to say")`
- `nn_compact`: `";".join(dealbreakers.non_negotiables)`, or `none` if the list is empty.
- `pri_compact`: `";".join(dealbreakers.top_priorities[:3])`, or `none`.

`ACP_FIELD_TABLE` (`module_registry.py:39-44`), verbatim:

```text
FIELDS:
loc=location|mv=movein|bd=budget|rm=roomtype|gnd=gender
smk=smoking|pet=pets|slp=sleep|cln=cleanliness(1-5)
gwk=guests_per_week|usp=utilities_split|groc=groceries
dep=deposit|wfh=work_from_home|nzl=noise_level
cf=conflict_style|pri=top_priorities|nn=non_negotiables
```

`ACP_PROTOCOL` (`module_registry.py:51-72`), verbatim. The runs of spaces before `—` are significant:

```text
## ACP/1.0 PROTOCOL
Communicate using structured ACP format. Natural language only for summaries.

MSG TYPES:
HI   — introduction: HI:[fields]
PFR  — preference: PFR:[field:value,...]
CNF  — conflict signal: CNF:[field:status(detail)]
FLX  — flexibility offer: FLX:[field:offer|condition]
VRD  — verdict (REQUIRED at end): VRD:[STRONG|CONDITIONAL|INCOMPATIBLE]|r=[reason]|open=[topics_or_none]

MODULE REQUESTS (emit when topic arises, backend injects context):
<<MOD:FINANCIAL>>   — when money/utilities/groceries comes up
<<MOD:ROUTINES>>    — when sleep/cooking/cleanliness comes up
<<MOD:SOCIAL>>      — when guests/noise/parties comes up
<<MOD:LIFESTYLE>>   — when WFH/schedule/temperature comes up
<<MOD:DEALBREAKERS>> — when conflict or hard limits arise

RULES:
- One <<MOD:X>> per message max. Only request each module once.
- Keep each turn to 2-3 ACP statements.
- VRD must appear in your final message. Never trail off.
- Backend detects <<MOD:X>> and injects your profile context for that domain.
```

### P2. LIVING module, loaded automatically (`module_registry.py:150-155`)

```text
## MOD:LIVING — {name}
loc:{loc_str}|mv:{living.get('move_in_date','?')}
lease:{living.get('lease_type','?')}|rm:{living.get('room_type','?')}
bath:{living.get('bathroom_preference','?')}|occ:{living.get('occupation','?')}
drink:{living.get('drinking','?')}
Use PFR to share these. Request <<MOD:FINANCIAL>> if budget details arise.
```

### P3. FINANCIAL module, lazy (`module_registry.py:177-182`, built by `build_financial` at 158-182)

```text
## MOD:FINANCIAL — {name}
usp:{fin.get('utilities_split','?')}|groc:{fin.get('groceries_split','?')}
dep:{fin.get('security_deposit','?')}|pay:{fin.get('payment_style','?')}
bd_flex:{flex}{stretch_note}
budget_negotiable:{str(flex_on_budget).upper()}
Use PFR/CNF/FLX for financial topics. Only reveal stretch budget if match is strong.
```

Where the variables come from:
- `fin = questionnaire["financial"]`.
- `flex = get_budget_flexibility(q)`, the raw budget-flexibility string, defaulting to `"No preference"`.
- `stretch_note`:
  - if `flex` contains `"~$100"`: `f"|stretch:{budget_max+100}_if_great_fit(dont_volunteer)"`
  - if `flex` contains `"~$200"`: `f"|stretch:{budget_max+200}_if_great_fit(dont_volunteer)"`
  - otherwise: `""`
  - `budget_max = living.get("budget_max", 1500)`. A `None` value raises `TypeError` here.
- `flex_on_budget = "Budget (within reason)" in dealbreakers.flexible_on`, which renders as `TRUE` or `FALSE`. React's option string is `Budget`, so this is **always FALSE for profiles saved from React**.

### P4. ROUTINES module, lazy (`module_registry.py:189-194`)

Lines 2-6 of the string really do start with 4 spaces:

```text
## MOD:ROUTINES — {name}
    slp_sched:{r.get('sleep_schedule','?')}|wake:{r.get('wake_time','?')}
    cook:{r.get('cooking_habits','?')}|kitchen:{r.get('kitchen_sharing','?')}
    bath_time:{r.get('bathroom_time','?')}|common:{r.get('common_space_usage','?')}
    cln:{cln}({cln_desc})|clean_sched:{r.get('cleaning_schedule','?')}
    Use PFR to share. Flag CNF if cleanliness gap ≥2 points.
```

`r = questionnaire["routines"]`, `cln = r.get("cleanliness", 3)`. `cln_desc` maps `{1:"very_relaxed",2:"relaxed",3:"moderate",4:"tidy",5:"spotless"}`, with `"moderate"` for any other value.

### P5. SOCIAL module, lazy (`module_registry.py:206-210`)

```text
## MOD:SOCIAL — {name}
nzl:{s.get('noise_level','?')}|guests:{s.get('overnight_guests','?')}
notice:{s.get('guest_notice','?')}|parties:{s.get('parties','?')}
social:{intro}({intro_desc})
Use PFR/CNF for social topics. Noise and guest frequency are common friction points.
```

`s = questionnaire["social"]`, `intro = s.get("introvert_extrovert", 3)`. `intro_desc` maps `{1:"very_introverted",2:"introverted",3:"balanced",4:"extroverted",5:"very_extroverted"}`, with `"balanced"` for any other value.

### P6. LIFESTYLE module, lazy (`module_registry.py:220-225`)

```text
## MOD:LIFESTYLE — {name}
wfh:{l.get('work_from_home','?')}|quiet:{l.get('quiet_hours_needed','?')}
sched:{l.get('schedule_predictability','?')}|temp:{l.get('temperature_preference','?')}
hobbies:{l.get('hobbies','none')}
notes:{l.get('lifestyle_notes','none')}
Use PFR for lifestyle details. WFH+quiet hours often requires CNF.
```

`l = questionnaire["lifestyle"]`. The `personality` section (conflict_style and the others) is **never put into any prompt**.

### P7. DEALBREAKERS module, lazy (`module_registry.py:241-247`)

```text
## MOD:DEALBREAKERS — {name}
NN:{nn_list}
FLEX:{flex_list}
```

If `custom` is truthy, the code then appends `"\nCUSTOM_DB:{custom}"`. It always appends `"\nAny NN conflict → VRD:INCOMPATIBLE immediately. No exceptions."`.

Variables: `nn_list` is the non-negotiables joined with `";"` (or `none`), `flex_list` is `flexible_on` joined with `";"` (or `none`), and `custom` is `dealbreakers.custom_dealbreaker`, defaulting to `""`.

### P8. How the system prompt is assembled

- **Initial prompt.** `get_initial_system_prompt` returns `CORE + "\n\n" + LIVING` (`module_registry.py:287-293`). `Agent.__init__` and `clear_history` store it as `self.system_prompt` (`server.py:290, 343`).
- **Injection.** `_inject_module(name)` runs `self.system_prompt += "\n\n" + module_text`, at most once per module (`server.py:301-310`). The prompt therefore grows in the order modules were injected and is resent in full on every turn.
- **What triggers injection:**
  - The agent's **own** reply contains `<<MOD:NAME>>`, where NAME is in `LAZY_MODULES`. Detection happens after the reply, so the new module is first used on that agent's next turn.
  - Entering negotiation adds DEALBREAKERS to both agents.
  - Entering conclusion adds all five lazy modules to both agents (section 4).

### P9. Rendered example of the initial system prompt (fictional placeholder user)

Input: name `Alex`, living:
- city `Boston`, neighborhood `Back Bay`
- occupation `Student`, gender `Woman`
- move_in_date `Within 1 month`, lease_type `1-year lease`
- budget 900-1400, budget_flexibility `Can flex up to ~$100`
- room_type `Private room`, bathroom_preference `No preference`
- roommate_gender `Same gender only`
- pets `No pets please`, smoking `Non-smoking household only`, drinking `Socially`

Dealbreakers:
- non_negotiables: `["No smoking indoors","Same gender roommate only"]`
- top_priorities: `["Similar cleanliness standards","Compatible sleep schedule","Location match"]`

Rendered prompt:

```text
## CORE — Alex
You ARE Alex. First person only. Never break character.
loc:Boston/Back Bay|mv:Within 1 month|bd:900-1400(flex+100_private)
gnd:Woman|roommate_gnd:SAME_ONLY(NON_NEG)
occ:Student|smk:Non-smoking household only|drink:Socially
pet:No pets please|rm:Private room
NN(non-negotiable):No smoking indoors;Same gender roommate only
PRI(top priorities):Similar cleanliness standards;Compatible sleep schedule;Location match

If NN conflict detected → acknowledge immediately, end politely, emit VRD:INCOMPATIBLE.
Never negotiate past a hard limit.

FIELDS:
loc=location|mv=movein|bd=budget|rm=roomtype|gnd=gender
smk=smoking|pet=pets|slp=sleep|cln=cleanliness(1-5)
gwk=guests_per_week|usp=utilities_split|groc=groceries
dep=deposit|wfh=work_from_home|nzl=noise_level
cf=conflict_style|pri=top_priorities|nn=non_negotiables

## ACP/1.0 PROTOCOL
Communicate using structured ACP format. Natural language only for summaries.

MSG TYPES:
HI   — introduction: HI:[fields]
PFR  — preference: PFR:[field:value,...]
CNF  — conflict signal: CNF:[field:status(detail)]
FLX  — flexibility offer: FLX:[field:offer|condition]
VRD  — verdict (REQUIRED at end): VRD:[STRONG|CONDITIONAL|INCOMPATIBLE]|r=[reason]|open=[topics_or_none]

MODULE REQUESTS (emit when topic arises, backend injects context):
<<MOD:FINANCIAL>>   — when money/utilities/groceries comes up
<<MOD:ROUTINES>>    — when sleep/cooking/cleanliness comes up
<<MOD:SOCIAL>>      — when guests/noise/parties comes up
<<MOD:LIFESTYLE>>   — when WFH/schedule/temperature comes up
<<MOD:DEALBREAKERS>> — when conflict or hard limits arise

RULES:
- One <<MOD:X>> per message max. Only request each module once.
- Keep each turn to 2-3 ACP statements.
- VRD must appear in your final message. Never trail off.
- Backend detects <<MOD:X>> and injects your profile context for that domain.

## MOD:LIVING — Alex
loc:Boston/Back Bay|mv:Within 1 month
lease:1-year lease|rm:Private room
bath:No preference|occ:Student
drink:Socially
Use PFR to share these. Request <<MOD:FINANCIAL>> if budget details arise.
```

### P10. Phase hints (`server.py:98-142`)

The hint for the current phase is prepended to every incoming message (P12). Each hint below is the concatenated string literal, verbatim:

| Phase `name` | `label` | `turns` | `hint` |
|---|---|---|---|
| `introduction` | `Phase 1 — Introduction` | 3 | `[PHASE: INTRODUCTION] Focus on: who you are, location, budget range, and 1–2 top priorities. If location is clearly incompatible, say so and end politely now.` |
| `exploration` | `Phase 2 — Lifestyle Exploration` | 4 | `[PHASE: EXPLORATION] Go deeper on: sleep schedule, cleanliness, guests, WFH, daily routines. Share your own preferences and ask theirs. Note where you align and where friction exists.` |
| `negotiation` | `Phase 3 — Negotiation` | 4 | `[PHASE: NEGOTIATION] Address any friction points directly. Propose specific compromises on flexible items. If a non-negotiable conflict surfaces, acknowledge it honestly. Be concrete — 'I could do X if you're okay with Y.'` |
| `conclusion` | `Phase 4 — Conclusion` | 2 | `[PHASE: CONCLUSION] Wrap up the conversation now. You MUST reach one of three verdicts: STRONG MATCH, CONDITIONAL MATCH (name the 1–2 unresolved topics), or INCOMPATIBLE (name the specific reason). Do not trail off. End naturally and conclusively.` |

### P11. Starter message, sent only to agent A on turn 1 (`server.py:390-393`)

```text
Hey! We've both been matched as potential roommates. Tell me a bit about yourself and what you're looking for?
```

This message is never broadcast and never stored in `conversation`.

### P12. Per-turn user message (`server.py:368-371`)

`msg_with_hint = f"{hint}\n\n{base_message}"`. Here `base_message` is the starter on turn 1 and, after that, the other agent's previous reply exactly as returned.

### P13. Analysis system prompt (`server.py:517-541`), verbatim

The string ends immediately after `incompatible.` with no trailing newline:

```text
You are an expert roommate compatibility analyst.
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
recommendation must be exactly one of: strong, conditional, incompatible.
```

### P14. Analysis user message (`server.py:543-551`)

This is sent as the single `user` message, `messages=[{"role":"user","content":request}]`. The f-string ends with a newline after `{conv_text}`:

```text
## Profile A:
{profile_a}

## Profile B:
{profile_b}

## Conversation (final 10 turns):
{conv_text}
```

- `conv_text = "\n".join(f"{m['speaker']}: {m['message']}" for m in conversation[-10:])` (`server.py:505-507`). Each line is a display name, a colon, a space and the raw message.
- `profile_a` and `profile_b` come from `build_compressed_profile_summary(agent.name, agent.questionnaire)` (`module_registry.py:327-335`), verbatim:

```text
{agent_name}:
loc:{loc_str}|bd:{living.get('budget_min','?')}-{living.get('budget_max','?')}
occ:{living.get('occupation','?')}|drink:{living.get('drinking','?')}
smk:{living.get('smoking','?')}|pet:{living.get('pets','?')}|gnd:{get_user_gender(questionnaire)}
slp:{r.get('sleep_schedule','?')}|cln:{r.get('cleanliness','?')}|wfh:{l.get('work_from_home','?')}
guests:{s.get('overnight_guests','?')}|nzl:{s.get('noise_level','?')}
usp:{fin.get('utilities_split','?')}|groc:{fin.get('groceries_split','?')}
NN:{';'.join(non_neg) if non_neg else 'none'}
PRI:{';'.join(top_pri[:3]) if top_pri else 'none'}
```

The analyst does **not** see:
- budget flexibility
- the roommate-gender preference
- room type, move-in date or lease
- `flexible_on` or `custom_dealbreaker`
- the personality section

### P15. Clone preview override (`server.py:882`, only in `POST /clone/chat`)

The code appends this to that request's CORE+LIVING prompt:

```text
\n\nIMPORTANT: This is a human preview chat. Respond in natural, friendly language — NOT ACP format. No structured tags.
```

(`\n\n` stands for two real newlines.)

### P16. Clone intro (`clone.py:47-53`)

This is static text, not an LLM call. It is returned by `GET /clone/intro`. The React page shows it as the first assistant bubble and later sends it back to the server inside `history`:

```text
Hey! I'm {name}'s AI clone. I know everything about their roommate preferences, their non-negotiables, and what they're flexible on. Ask me anything to see if you'd be a good fit!
```

If the request fails, the React page shows its own text instead (`MyClone.tsx:36`): `Hey! I'm your AI clone. Ask me anything about your preferences to verify I represent you well.`

### P17. Clone validation questions (`server.py:903-907`, `POST /agents/{user_id}/validate`)

Each question is a separate single-turn call, `[{"role":"user","content":q}]`, with the agent's current system prompt (CORE+LIVING) and no phase hint:

```text
What's your budget and where are you looking?
Are you a morning person or night owl?
How do you feel about guests and overnight visitors?
```

### P18. Other prompt paths and what is missing

- **Streamlit clone chat** (`app.py:487-519`): uses `generate_clone_prompt` (CORE+LIVING, **without** the P15 override) through `chat_stream(system_prompt, full_chat_history)`. History is not truncated, and no modules are ever injected.
- **Missing prompts.** There are no summarization, memory or moderation prompts. There is also no separate "judge the verdict" prompt; the verdict comes from code (section 5).

---

## 4. The negotiation loop, exactly

### 4.1 Faithful pseudocode (`server.py:316-337` and `373-495`)

```python
# Agent.get_response(message)  (server.py:316-337)
self.history.append({"role": "user", "content": message})
content = await run_in_executor(None, llm_chat(self.history[-6:],          # HISTORY_WINDOW = 6 (server.py:283)
                                               system_prompt=self.system_prompt))
self.history.append({"role": "assistant", "content": content})
mod = extract_module_request(content)   # first <<MOD:(\w+)>>, upper-cased; only if in LAZY_MODULES
if mod: self._inject_module(mod)        # system_prompt += "\n\n" + module (once per module)
return content

# ChatRoom.run_conversation(delay=2.0)   # background path passes delay=1.0
is_running = True; conversation = []; phase_idx = 0
A.clear_history(); B.clear_history()     # history = [], modules = {CORE, LIVING}, prompt rebuilt
phase_turn_count = 0; global_turn = 0; turn = "a"
current_msg = STARTER                    # P11
broadcast({"type": "phase_start", "phase": "introduction", "label": "Phase 1 — Introduction"})
while is_running:
    global_turn += 1
    phase = PHASES[min(phase_idx, 3)]
    msg_with_hint = f"{phase['hint']}\n\n{current_msg}"
    speaker, other = (A, B) if turn == "a" else (B, A)
    response = await speaker.get_response(msg_with_hint)
    other.history.append({"role": "user", "content": response})        # raw cross-feed, no hint
    msg = {"speaker": speaker.name, "speaker_id": turn, "message": response,
           "turn": global_turn, "phase": phase["name"], "timestamp": datetime.utcnow().isoformat()}
    conversation.append(msg)
    broadcast({"type": "agent_message", "data": msg})
    o = detect_outcome(conversation[-3:])
    if o["status"] == "incompatible":
        match_result = o; break                                         # early stop
    current_msg = response
    turn = "b" if turn == "a" else "a"
    phase_turn_count += 1
    if phase_turn_count >= phase["turns"]:
        phase_turn_count = 0
        if phase_idx < 3: phase_idx += 1
        new = PHASES[phase_idx]
        if new["name"] == "negotiation": A._inject_module("DEALBREAKERS"); B._inject_module("DEALBREAKERS")
        if new["name"] == "conclusion":
            for m in LAZY_MODULES: A._inject_module(m); B._inject_module(m)
        broadcast({"type": "phase_start", "phase": new["name"], "label": new["label"]})  # guard is always true
    if PHASES[phase_idx]["name"] == "conclusion" and phase_turn_count >= 2: break        # never fires (bug)
    if global_turn >= TOTAL_PHASE_TURNS + 2: break                                      # 15
    await asyncio.sleep(delay)
is_running = False
outcome = match_result or detect_outcome(conversation); match_result = outcome
broadcast({"type": "chat_complete", "conversation": conversation, "outcome": outcome})
```

### 4.2 Turn schedule when nothing stops the chat early

I checked this by re-typing the control flow into a stub simulation.

| Turn | Speaker | Phase/hint used | After the turn |
|---|---|---|---|
| 1 | A | introduction | |
| 2 | B | introduction | |
| 3 | A | introduction | `phase_start` exploration |
| 4-6 | B, A, B | exploration | |
| 7 | A | exploration | inject DEALBREAKERS (both); `phase_start` negotiation |
| 8-10 | B, A, B | negotiation | |
| 11 | A | negotiation | inject all lazy modules (both); `phase_start` conclusion |
| 12 | B | conclusion | |
| 13 | A | conclusion | phase counter resets, so the end-of-conclusion check sees 0; a **duplicate** `phase_start` conclusion is sent |
| 14 | B | conclusion | |
| 15 | A | conclusion | another duplicate `phase_start` conclusion; the safety limit (`global_turn >= 15`) breaks the loop |

The result is 15 messages: A sends 8, including the first and the last, and B sends 7. The advertised `total_turns` is 13 (`server.py:144, 946, 1132`).

### 4.3 How phases advance and when the chat stops

- **Phase advance** is decided by turn count only. The model has no way to advance or end a phase.
- **The chat stops when any of these happens:**
  1. After any turn, the keyword detector flags `incompatible` in the last 3 messages. The loop breaks immediately, with no `phase_start` and no sleep. This can happen as early as turn 1.
  2. The intended stop at the end of the conclusion phase. It is unreachable, as explained above.
  3. The safety limit at 15 turns.
  4. `{"action":"stop"}` sets `is_running = False`. The turn already in progress finishes (its LLM call, broadcast and sleep), the loop exits, and `chat_complete` is still sent with `detect_outcome` run on the partial chat.
  5. An exception, such as a Groq error. The task dies: on the WebSocket path the UI waits forever, and on the background path the error is logged and no match is saved.
- **Delay between turns:** 2.0 s on the WebSocket path, 1.0 s on the background path (`asyncio.sleep`).

### 4.4 What history each agent sends to the model

- Each agent has its own history, from its own point of view.
- Every LLM call sends:
  - the **full** system prompt, which grows as modules are added;
  - then the **last 6** history entries (`self.history[-6:]`, which includes the message just appended).
- The agent never receives the other agent's name or profile. It sees only the other agent's reply text.
- **Every message from the other agent appears twice.** It is added once raw by the cross-feed (`server.py:415/420`), then again with the phase hint prepended by `get_response`. Consecutive `user` messages are therefore normal here.

Exact windows from the simulation (`R<n>` is the reply on turn n, `H:<phase>` is that phase's hint):
- **Turn 1, A:** `[sys, user: H:intro\n\nSTARTER]`
- **Turn 2, B:** `[sys, user: R1, user: H:intro\n\nR1]`
- **Turn 5, A:** `[sys, asst: R1, user: R2, user: H:intro\n\nR2, asst: R3, user: R4, user: H:explore\n\nR4]`
- **Turn 13, A:** `[sys, asst: R9, user: R10, user: H:negotiation\n\nR10, asst: R11, user: R12, user: H:conclusion\n\nR12]`

From turn 5 onward, an agent sees only its own last 2 replies and the other agent's last 2 replies (each of those twice). Older turns are gone, and the agent's memory of everything else lives only in its system prompt.

### 4.5 Message format

- **What the model is told to write:** the ACP format from P1 (`HI:[...]`, `PFR:[...]`, `CNF:[...]`, `FLX:[...]`, `VRD:[...]|r=...|open=...`).
- **How replies are parsed:** they are stored as free text. The code extracts only:
  - `<<MOD:(\w+)>>` (`module_registry.py:302`)
  - substrings for the verdict (section 5)
  - `VRD` is never parsed into a structure.
- `<<MOD:...>>` tags are not stripped, so the UI and the other agent see them.
- **Stored message record** (`server.py:422-429`):
  `{"speaker": "<display name>", "speaker_id": "a"|"b", "message": "<raw LLM text>", "turn": 1-15, "phase": "introduction"|"exploration"|"negotiation"|"conclusion", "timestamp": "<UTC ISO, no tz suffix>"}`.

### 4.6 Concurrency

Groq calls block, so they run in the default thread pool (`loop.run_in_executor(None, ...)`). Background negotiations start with `asyncio.create_task`, and the code keeps no reference to the task. Rooms are never removed from `chat_rooms`.

---

## 5. Scoring and verdict

### 5.1 `status` comes from keywords in code (`detect_outcome`, `server.py:149-192`)

`tail = " ".join(m["message"].lower() for m in conversation[-3:])`. The checks then run **in this order**, using plain substring tests:

```python
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
```

| First list that matches | Returned value |
|---|---|
| incompatible | `{"status": "incompatible", "reason": _extract_reason(tail), "unresolved_topics": []}` |
| conditional | `{"status": "conditional", "reason": None, "unresolved_topics": _extract_unresolved_topics(tail)}` |
| strong | `{"status": "strong", "reason": None, "unresolved_topics": []}` |
| none | `{"status": "conditional", "reason": "Outcome unclear from conversation", "unresolved_topics": []}` |

The two helpers work on the lowercased `tail`:
- `_extract_reason` (`server.py:195-207`) tries `r"think (.{10,80}) makes this"`, then `r"because (.{10,80})\."`, then `r"due to (.{10,80})\."`. It returns the first group with `.strip().capitalize()`. If nothing matches it returns `"Incompatible preferences (see conversation for details)"`.
- `_extract_unresolved_topics` (`server.py:210-219`) applies `r"specifically (.{5,120}?)[\.\,\!]"`, splits the group on `r"\band\b"`, strips and drops empty parts, and keeps at most 2. If nothing matches it returns `["See conversation for details"]`.

Consequences of this design:
- An ACP reply like `VRD:[STRONG]|r=...` contains no strong phrase, so it falls through to the default **conditional**.
- `<<MOD:DEALBREAKERS>>`, once lowercased, contains `dealbreaker`, so it triggers **incompatible** and ends the chat.
- Ordinary phrases such as "no dealbreakers" or "won't work from home" also end the chat as **incompatible**.

### 5.2 Scores come from one LLM call (`ChatRoom.analyze`, `server.py:497-566`)

- **Inputs:** the P13 system prompt plus the P14 user message, at the model and parameters from 3.0.
- **When it runs:**
  - background path: automatically, right after the conversation ends;
  - WebSocket path: only when the client sends `{"action":"analyze"}`.
- **Parsing and repair**, the complete logic:

~~~python
cleaned = re.sub(r"```json|```", "", raw).strip()
return {"structured": True, "data": json.loads(cleaned)}   # any exception -> {"structured": False, "data": raw}
~~~

- **Limits of that repair step:**
  - It does not pull a `{...}` block out of surrounding prose, and it does not retry.
  - It does not check keys or types, does not clamp scores, and does not ask for JSON mode.
  - Any valid JSON value, even a list, counts as "structured".
  - `max_tokens=500` can cut off long JSON, which then fails to parse.
- **Expected `data` shape** when the model follows the prompt:
  `{"scores": {"overall": int, "finances": int, "lifestyle": int, "personality": int, "logistics": int}, "highlights": [str x3], "concerns": [str x3], "dealbreaker_detected": bool, "dealbreaker_detail": str, "middle_ground": [str x2], "recommendation": "strong"|"conditional"|"incompatible", "recommendation_summary": str}`.
- **Scores are judged entirely by the LLM** on a 0-100 scale. `overall` is the model's own number, not an average computed in code.
- There are no thresholds. **`recommendation` is never mapped to `status`.**

### 5.3 Match record (`save_match`, `server.py:588-608`): upserted by `match_id`

```json
{"match_id": "<room_id: 8-char uuid4 prefix (WS) or 'bg_' + 8 hex (background)>",
 "user_a_id": "<email of A / liker>", "user_a_name": "<name>",
 "user_b_id": "<email of B / target>", "user_b_name": "<name>",
 "status": "strong|conditional|incompatible",
 "reason": "<str or null>", "unresolved_topics": ["<str>"],
 "analysis": {"structured": true, "data": {"...": "5.2 shape"}},
 "conversation": [{"...": "4.5 message records"}],
 "created_at": "<UTC ISO>"}
```

- `status`, `reason` and `unresolved_topics` come from `room.match_result`, or from `detect_outcome(room.conversation)` if that is empty.
- `analysis.structured` is `false` and `analysis.data` is a raw string when parsing fails.
- **`GET /matches`** adds `other_photos` and `other_profile_picture` to each record. It excludes `status == "incompatible"` unless `include_incompatible=true`, and sorts by `created_at` descending.
- **`GET /matches/counts`** returns `{"strong": n, "conditional": n, "incompatible": n, "total": n}`, aggregated on `status`.

### 5.4 Which verdict each UI shows

| Screen | Badge shown | Scores shown |
|---|---|---|
| React AgentChat, Outcome card | keyword `status` | none |
| React AgentChat, Analysis card | `recommendation`, falling back to `status` | overall and the 4 sub-scores |
| React MyMatches | keyword `status` | `overall`, plus the 4 sub-scores when expanded |
| Streamlit agent chat | keyword `status`; the analysis section shows `recommendation` | overall and the 4 sub-scores |

The keyword verdict and the LLM verdict can disagree on the same screen.

---

## 6. Dealbreakers and budget handling

- **Representation:**
  - `dealbreakers.non_negotiables`: a list of option strings; at least 1 required in the UIs.
  - `dealbreakers.custom_dealbreaker`: free text.
  - `dealbreakers.flexible_on`: a list.
  - `dealbreakers.top_priorities`: a list of at most 3.
  - `living.roommate_gender` and `living.budget_*` / `living.budget_flexibility` also act as constraints.
- **Enforcement in prompts:**
  - CORE lists `NN(non-negotiable):...` and says "If NN conflict detected → acknowledge immediately, end politely, emit VRD:INCOMPATIBLE. Never negotiate past a hard limit."
  - DEALBREAKERS adds `NN`, `FLEX` and `CUSTOM_DB` and "Any NN conflict → VRD:INCOMPATIBLE immediately. No exceptions."
  - The negotiation hint says "If a non-negotiable conflict surfaces, acknowledge it honestly."
  - DEALBREAKERS is force-added to both agents when negotiation starts (after turn 7).
- **Enforcement in code**, which is all there is:
  1. **Candidate pre-filter** (`server.py:991-1101`). Note that it reads the `living.roommate_gender` field, not the non-negotiable item "Same gender roommate only".
     - Location score:
       - 3 if the city strings match case-insensitively;
       - 2 if both cities are in the same `METRO_BUCKETS` set;
       - otherwise 0, and the candidate is dropped whenever the current user has a city.
     - `METRO_BUCKETS`:
       - `boston-metro`: boston, cambridge, somerville, allston, brighton, brookline, medford, watertown, newton, quincy
       - `sf-bay`: san francisco, oakland, berkeley, san jose, palo alto, mountain view
       - `nyc-metro`: new york, brooklyn, queens, manhattan, bronx, staten island
     - Gender: a candidate is excluded if **either** user has `roommate_gender == "Same gender only"` while both genders are non-empty and differ. `"Prefer not to say"` counts as a gender value.
     - Also excluded: yourself, users you have already liked or passed, and users with an empty questionnaire.
     - Sort order: score descending, then name, then email. Pagination uses `skip`/`limit`, default 0/50.
  2. **The keyword detector** in 5.1, which can end the chat early.
  3. Nothing in code compares budgets, pets, smoking, guests or cleanliness.
- **Budget handling** happens in the prompts:
  - CORE encodes `bd:{min}-{max}(HARD_CAP | flex+100_private | flex+200_private | flexible)`.
  - FINANCIAL, which is lazy and forced at conclusion, adds `stretch:{max+100|max+200}_if_great_fit(dont_volunteer)` and `budget_negotiable:TRUE/FALSE`.
  - The string tests (`"Hard limit"`, `"~$100"`, `"~$200"`) work for both the Python and the React option strings. `budget_negotiable` does not: it is always FALSE for React profiles.
  - The analysis prompt sees only `bd:{min}-{max}`.

---

## 7. `module_registry.py` ("ACP/1.0")

- **Purpose.** It replaces one large persona prompt with small text blocks, one per domain, that are built on demand from the questionnaire. Agents ask for a block by writing `<<MOD:NAME>>`. The stated goal is fewer tokens (the README claims 85-97% savings; this was not verified).
- **API:**
  - `get_module(name, agent_name, questionnaire)` returns the block, or `""` with a warning if the name is unknown.
  - `get_initial_system_prompt(name, q)` returns CORE + LIVING.
  - `extract_module_request(text)` runs `re.search(r"<<MOD:(\w+)>>")`, takes only the **first** tag, upper-cases it, and returns it only if it is in `LAZY_MODULES`. Otherwise it returns `None`, even when a later tag in the same text is valid.
  - `build_compressed_profile_summary(name, q)` returns the profile text used by the analysis.
- **Registry:**
  - `MODULE_BUILDERS = {CORE, LIVING, FINANCIAL, ROUTINES, SOCIAL, LIFESTYLE, DEALBREAKERS}`
  - `AUTO_LOAD_MODULES = ["CORE","LIVING"]`
  - `LAZY_MODULES = ["FINANCIAL","ROUTINES","SOCIAL","LIFESTYLE","DEALBREAKERS"]`
- **How it plugs in:**
  - `clone.generate_clone_prompt` → `get_initial_system_prompt`.
  - `server.Agent.get_response` → `extract_module_request` → `Agent._inject_module` → `get_module`, then appends `"\n\n"+block` to that agent's own system prompt.
  - `ChatRoom.run_conversation` force-injects modules at phase changes.
  - `ChatRoom.analyze` → `build_compressed_profile_summary`.
- **Scope.** Modules are tracked per agent, per conversation (`injected_modules`) and reset by `clear_history()`. An agent can only receive **its own** profile blocks.
- **Porting.** The module can be ported as-is: pure functions, no I/O. To reproduce the current behaviour exactly, keep the per-module default values from section 2.4.

---

## 8. Groq client (`shared/groq_client.py`)

- **Client creation:** `_client = Groq(api_key=os.environ["GROQ_API_KEY"])` runs **at import time**, so a missing key raises `KeyError` and the server fails to start.
- **Model:** env `GROQ_MODEL`, default `llama-3.3-70b-versatile`. No other model is used anywhere.
- **`chat(messages, system_prompt=None) -> str`:** adds the system message and returns `response.choices[0].message.content`, with `max_tokens=500` and `temperature=0.7`.
- **`chat_stream(system_prompt, messages)`:** a generator of text deltas with the same parameters. **Its argument order is the reverse of `chat`'s.** Only Streamlit uses it.
- **Leftover helpers:** `check_ollama_running()` returns `bool(GROQ_API_KEY)`, and `generate(prompt)` is a single-turn call; both remain from an earlier Ollama client.
- **JSON mode:** never used, not even for the analysis call.
- **Retries, backoff and timeout:** the app sets none. The SDK defaults apply. Checked against the groq SDK 1.7.0 installed in our own `backend/.venv` (`groq/_constants.py`):
  - `DEFAULT_MAX_RETRIES = 2`
  - exponential backoff from 0.5 s up to 8 s, honouring `retry-after`
  - retries on connection errors, 408, 409, 429 and 5xx
  - timeout 60 s, connect timeout 5 s
  - The repo pins `groq>=0.4.0`, so older versions may behave differently.
- **Error handling:** none. Exceptions reach the callers:
  - the WebSocket conversation task dies silently;
  - the background path logs `Background negotiation failed: ...`;
  - `/agents/{id}/validate` catches each failure and records `{"status":"failed","error":str(e)}`;
  - `/clone/chat` returns HTTP 500.
- **Debug logging:** `DEBUG=true` logs message counts and the first 200 characters of each response.

---

## 9. WebSocket protocol and what the UI shows

### 9.1 Endpoint `ws://<host>:8000/ws/{room_id}` (`server.py:1106-1166`)

- **Room lookup.** The socket is accepted and added to `connections[room_id]`. The room must already exist in memory, created by `POST /rooms`; there is no authentication.
- **Messages from the client**, each a JSON object:
  - `{"action":"start"}`
  - `{"action":"stop"}`
  - `{"action":"analyze"}`
- **Events from the server.** Every event goes to all sockets in the room except `started` and `error`, which go only to the socket that asked:

| `type` | Payload | When |
|---|---|---|
| `error` | `{"type":"error","message":"Room not found"}` | `start` for an unknown room (`analyze` on an unknown room is silently ignored) |
| `started` | `{"type":"started","agent_a":str,"agent_b":str,"total_turns":13,"phases":[{"name","label","turns"} x4]}` | immediately after `start`, before the conversation task begins |
| `phase_start` | `{"type":"phase_start","phase":"introduction|exploration|negotiation|conclusion","label":"Phase N — ..."}` | at the start, at each phase change, plus 2 duplicate `conclusion` events (4.2) |
| `agent_message` | `{"type":"agent_message","data":{speaker, speaker_id, message, turn, phase, timestamp}}` | after every turn |
| `chat_complete` | `{"type":"chat_complete","conversation":[...all messages],"outcome":{status, reason, unresolved_topics}}` | when the loop ends, including after a stop |
| `stopped` | `{"type":"stopped"}` | right after a `stop` action |
| `analyzing` | `{"type":"analyzing"}` | when an `analyze` action begins |
| `analysis` | `{"type":"analysis","result":{"structured":bool,"data":obj|str},"match_id":room_id,"status":str,"reason":str|null,"unresolved_topics":[str]}` | after `analyze` and `save_match` |

The 4 phase objects in `started` are:

```json
[{"name":"introduction","label":"Phase 1 — Introduction","turns":3},
 {"name":"exploration","label":"Phase 2 — Lifestyle Exploration","turns":4},
 {"name":"negotiation","label":"Phase 3 — Negotiation","turns":4},
 {"name":"conclusion","label":"Phase 4 — Conclusion","turns":2}]
```

Messages are not streamed token by token; each `agent_message` carries a whole reply. Background negotiations broadcast to a `bg_` room that no client ever connects to, so React shows nothing until My Matches is reloaded.

### 9.2 Related REST endpoints

None of these require authentication except where marked "cookie".

| Endpoint | Behaviour |
|---|---|
| `POST /agents {user_id, name, questionnaire}` | Returns `{"status":"created", user_id, name}` and stores the agent in memory, keyed by `user_id` |
| `GET /agents` | Returns `[{user_id, name}]` |
| `POST /agents/{user_id}/validate` | Returns `{user_id, name, validated: bool, results: [{question, response, status:"success"} or {question, error, status:"failed"}]}` |
| `POST /rooms {user_a_id, user_b_id}` | Returns `{room_id, agent_a, agent_b, total_turns: 13, phases}`. Returns 404 `Agent for {id} not found. Re-validate Clone A first.` (or `...Clone B...`) if an agent is missing |
| `GET /rooms/{id}` | Returns `{room_id, agent_a, agent_b, is_running, messages: <count>, current_phase, match_result}` |
| `GET /matches?user_id=&include_incompatible=`, `GET /matches/counts?user_id=`, `GET /matches/{match_id}` | Match records and counts (5.3) |
| `POST /matches/like {target_email}` (cookie) | Returns `{"status":"liked","message":"Agents will negotiate in the background. Check My Matches for results."}`. Returns 400 `Cannot like yourself` or 404 `Target user not found` |
| `POST /matches/pass {target_email}` (cookie) | Returns `{"status":"passed"}` |
| `GET /users/candidates?skip&limit` (cookie) | Returns `{candidates: [{email, name, city, neighborhood, questionnaire, photos, profile_picture_url, same_location, location_match_score}], total, skip, limit}` |
| `GET /clone/intro` (cookie) | Returns `{intro}` (P16). Returns 400 `Complete your profile (questionnaire) first.` |
| `POST /clone/chat {message, history: [{role, content}]}` (cookie) | Builds a **new** Agent on every request, with history taken from the client, the P15 override, and the window of 6. Returns `{reply}`. Returns 400 `Complete your profile (questionnaire) first so your clone can represent you.` |

### 9.3 What the UI renders

- **React AgentChat** (`AgentChat.tsx`). Nothing links to this page; `agentsApi`/`roomsApi` in `api.ts` are never called.
  - **Header and controls:** the title is "`{room.agent_a} ↔ {room.agent_b}`", taken from `location.state.room` and otherwise "Agent A"/"Agent B", with "Room: id" underneath. Buttons:
    - Start Chat, which sends `start`
    - Stop while running
    - Analyze once there is an outcome and no analysis yet
    - Reset, which disconnects and goes to `/match/setup`
  - **Chat stream:**
    - A `phase_start` becomes a divider with the uppercase phase label between two lines.
    - Each `agent_message` becomes a bubble: agent A on the left in the accent colour, agent B on the right in the primary colour. The speaker name sits small above the raw text, and ACP tags and `<<MOD>>` tags are shown as written.
    - A spinner shows while the chat runs.
  - **Outcome card:** a `StatusBadge` for the keyword `status`, the `reason` text, and the unresolved topics as chips.
  - **Analysis card:**
    - a large `overall` number with a `StatusBadge` for `recommendation`, falling back to `status`;
    - 4 tiles showing `finances`, `lifestyle`, `personality` and `logistics` as **plain numbers; there are no bars or progress meters**;
    - a red "Dealbreaker Detected" box with `dealbreaker_detail`;
    - Highlights, Concerns and Middle Ground as bulleted lists, and a Summary box;
    - if the analysis is not structured, "Analysis (Raw)" with `JSON.stringify(data)` in a `<pre>` block.
- **`StatusBadge`** labels are Strong Match, Conditional Match and Incompatible. Their colours are green `hsl(152 60% 42%)`, amber `hsl(38 92% 50%)` and red `hsl(0 72% 51%)`.
- **React MyMatches:**
  - header "My Matches (total)" with a "Show incompatible" switch, which refetches with `include_incompatible`;
  - a counts row with coloured dots;
  - one card per match:
    - the other user's photo (first upload, else their Google picture) and name;
    - a `StatusBadge` for `status`, the date as `MMM d, yyyy`, and "Score: overall/100" when structured;
    - topic chips for conditional matches, and "Open to see summary" for incompatible ones;
  - expanding a card shows the other user's **email**, 4 sub-score tiles and `recommendation_summary`. The incompatible `reason` is not shown.
- **React SetupMatch:**
  - a card with the photo, name, city and neighborhood;
  - chips for Occupation, Room type, Pets, Smoking and Drinking;
  - a Social label derived from the slider: 1 Very introverted, 2 Introverted, 3 Balanced, 4 Extroverted, 5 Very extroverted;
  - Hobbies, Pass and Like;
  - after Like, the toast "Liked {name}! Agents are negotiating..."; the page also shows "N profiles remaining" and the empty states.
- **React MyClone:** a chat with the intro bubble, a "Thinking…" indicator and an `Error: ...` bubble on failure. Each send posts the message plus the earlier messages as `history`.
- **Streamlit:**
  - Phase dividers come from changes in `msg.phase`, labelled "Phase 1 — Introduction", "Phase 2 — Exploration", "Phase 3 — Negotiation", "Phase 4 — Conclusion" with emoji prefixes.
  - Chat messages are formatted "**Name**: message" with A/B avatars, and a live caption reads "Turn n · phase".
  - A pill badge shows the outcome, with unresolved topics in an info box or the reason in an error box.
  - The analysis uses `st.metric` "X/100" for overall and the 4 sub-scores, then success boxes (highlights), warning boxes (concerns), info boxes (middle ground) and the summary.
  - The matches page shows a caption with Overall, Finances, Lifestyle and Personality (not logistics), plus a Contact expander showing the other user's email.

---

## 10. OAuth, MongoDB and Streamlit dependencies, and how to replace them with local JSON

The engine itself (`module_registry`, `clone`, `questionnaire`, `Agent`, `ChatRoom`, `detect_outcome`, `analyze`) needs only three things per user: `user_id` (the email is used as the id), `name` and `questionnaire`.

| Dependency | Where | Replacement |
|---|---|---|
| MongoDB `users` | `database.py:46-191` | `users.json`: `{"<user_id>": {"email": "<user_id>", "name": "...", "questionnaire": {...}, "photos": [], "created_at": "...", "updated_at": "..."}}`. Keep `save_user` semantics: set only the fields passed, never write `None`, set `created_at` only on insert. Never return `password_hash`. |
| MongoDB `matches` | `database.py:198-252` | `matches.json`: `{"<match_id>": record}`. Upsert means a shallow merge. Listing filters on `user_a_id == uid or user_b_id == uid`, excludes `status == "incompatible"` unless asked, and sorts by `created_at` descending. Counts are `{strong, conditional, incompatible, total}`. |
| MongoDB `interactions` | `database.py:259-285` | `interactions.json`: `{"<user>|<target>": {"user_email","target_email","action":"like"|"pass","timestamp"}}`. `get_interacted_emails(u)` returns the set of targets. |
| Photos | `server.py:753-782`, `database.py:292-308` | Optional. Files go to `uploads/photos/{safe_email}_{i}_{hex8}.{ext}` and are served through `/uploads` StaticFiles. At most 2 photos of at most 5 MB each, in jpeg/png/webp/gif. |
| Google OAuth + bcrypt email/password | `auth.py` (authlib `OAuth2Session`, in-memory `_oauth_states` with a 10-minute TTL, scopes `openid email profile`) | Drop it. Put a FastAPI dependency in place of `_get_current_user(request)`, for example one that reads a `user_id` header or query parameter, or one that uses our project's existing auth. |
| JWT session cookie | `session_utils.py` (PyJWT HS256, claims `email`/`exp`/`iat`, 14 days); cookie `roommate_session` with `httponly`, `samesite="none"`, `secure=True` (`server.py:618-628`) | Drop it, as above. |
| Streamlit UI | `app.py` (also calls `shared.database` directly, bypassing the API) | Drop it. Its one unique flow (pick A and B, optionally validate, run a live WebSocket chat, then analyze) can be kept through `/agents`, `/rooms` and `/ws/{room_id}`. |

- **Writing the JSON files safely.** Background negotiations write while requests are being served, so:
  - put every write behind a single process-wide lock;
  - write to a temporary file and then `os.replace` it, so updates are atomic.
- **Environment variables** (names only; no values were seen):
  - required: `GROQ_API_KEY`
  - optional: `GROQ_MODEL` and `DEBUG`
  - drop with Mongo and OAuth: `MONGODB_URI`, `MONGODB_DATABASE`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `JWT_SECRET` (it has an insecure hard-coded fallback in `config.py:41`), `SESSION_DAYS`
  - deployment: `FRONTEND_URL` (used for CORS, together with `localhost:8080`/`127.0.0.1:8080`), `BACKEND_HOST`, `BACKEND_PORT`
  - frontend: `VITE_API_URL` and `VITE_WS_URL`, defaulting to `http://localhost:8000` and `ws://localhost:8000`
- **Other files.** The repo also has a `Dockerfile` (`uvicorn backend.server:app`), a `docker-compose.yml` (backend plus nginx with TLS) and an `nginx.conf` for the author's personal domain. None of them are needed.

---

## 11. Surprising, buggy or unclear behaviour

Most important first.

1. **The verdict is decided by keyword heuristics, not by the LLM.**
   - The README says the LLM analysis "assigns one of three statuses", but the stored `status` comes from `detect_outcome`, and `analysis.recommendation` is ignored.
   - There are no score thresholds.
2. **The keyword detector produces false "incompatible" results and kills chats.**
   - `"dealbreaker"` matches the protocol's own `<<MOD:DEALBREAKERS>>` tag, so any agent that requests that module ends the chat immediately.
   - `"won't work"`, `"nn conflict"` and `"dealbreaker"` also match innocent phrases such as "no dealbreakers".
   - In the other direction, the ACP verdict `VRD:[STRONG]` is never recognised as strong and falls through to "conditional / Outcome unclear".
3. **The loop runs 15 turns, not 13.**
   - The phase counter is reset to 0 before the end-of-conclusion check, so that check never fires and the safety limit ends the chat.
   - Two extra `phase_start: conclusion` events are sent, which React renders as dividers.
4. **Each agent sees every message from the other agent twice** (raw cross-feed plus the hinted copy). With a window of 6 entries, an agent effectively remembers only the last 2 exchanges.
5. **The analysis sees only the last 10 messages.** In a 15-turn chat the introduction (location, budget) is dropped. The compressed profiles also leave out budget flexibility, gender preference, `flexible_on` and the custom dealbreaker.
6. **The two questionnaire copies disagree** (28 fields have different strings).
   - React profiles always get `budget_negotiable:FALSE`.
   - Profiles do not round-trip between the two UIs.
   - React stores untouched optional selects as `''`, which renders as empty values (`mv:|`) instead of `?`.
   - A `budget_max` that becomes `null` (a cleared number input gives NaN, which JSON turns into null) crashes `build_financial` for users who chose the `~$100`/`~$200` flexibility.
7. **The clone preview knows only CORE and LIVING.**
   - `/clone/chat` builds a new Agent on every request, so lazy modules never persist. The preview cannot truthfully answer questions about sleep, cleanliness, guests or WFH and will probably make answers up.
   - `/agents/validate` asks "morning person or night owl?", which those modules do not cover.
   - The `personality` section never reaches any prompt.
8. **The live chat UI is unreachable in React.** No route leads to `AgentChat` (`/match/chat/:roomId`). The React flow is "like, then a background negotiation that streams to nobody". Only Streamlit drives the live WebSocket chat.
9. **The WebSocket path saves a match only when Analyze is clicked.**
   - After `stop`, the server still sends `chat_complete`, but Streamlit stops reading at `stopped` and misses it.
   - The React hook reads only the latest message in a `useEffect`, so events can be lost when two arrive before one render.
10. **No authentication, and a privacy gap.**
    - `/matches`, `/matches/{id}`, `/matches/counts`, `/agents`, `/rooms` and `/ws` need no login. Anyone can read anyone's matches (including the other user's email and the full conversation) just by knowing an email address.
    - A one-sided like creates a match that the target also sees.
11. **Robustness gaps:**
    - The app has no retries of its own, uses no JSON mode, does no schema validation, and `max_tokens=500` can truncate the analysis JSON.
    - Groq errors silently kill the WebSocket task.
    - Background tasks are not kept referenced, and `chat_rooms` is never cleaned up.
    - `PUT /auth/me` skips questionnaire validation.
12. **Minor issues:**
    - `_ensure_index` (unique email) is never called, and every database call opens a new `MongoClient`.
    - `logging.basicConfig(level=DEBUG)` makes every library log at debug level.
    - The README run command has a typo (`"backend /server.py"`).
    - `nginx.conf` has stray `;` characters inside its `ssl_certificate` paths.
    - The cookie uses `SameSite=None; Secure`, so it needs HTTPS (or Chrome on localhost).
    - In the candidate filter, the city `Other` matches only `Other`, and LA, Chicago and the rest match only the same city.
    - Streamlit labels phase 2 "Exploration" while the server says "Lifestyle Exploration".
    - In the manual flow, the shared `agents{}` objects mean that two rooms using the same user would overwrite each other's histories.
13. **Unclear: the README's token-savings claim** (85-97%) is not backed by any measurement in the code. Every turn still resends the full, growing system prompt.

## 2026-10-15: why the clones asked for things already said (engine rm2)

Found after the tour, on the bundled conversations (Priya + Kavya was the worst case: her clone
repeated Kavya's message word for word for ten turns, and Meera's clone reported Priya's sleep
and guest answers as its own). All three suspects contributed:

1. **How the other clone's message is passed (main cause).**
   - The reply arrived as a bare "user" message behind the phase hint, with nothing saying who
     wrote it. Models echoed it, answered in its voice, or called the other person "User".
   - Each clone saw only its last 6 history entries. By turn 8 or so the other's introduction
     (budget, move-in, location) was out of view, so it was asked again.
2. **Lazy modules.** A clone's own routines / social / lifestyle / financial answers reached it
   only after it emitted `<<MOD:X>>`, and only on its next turn. Until then it had no data for
   sleep, guests or cleanliness, so it guessed, often by mirroring the other's values.
3. **Phase prompts.**
   - "Share your own preferences and ask theirs" repeated every turn of a phase.
   - The protocol's "VRD must appear in your final message" made models add a verdict to every
     message. A turn-1 "STRONG" then decided the match when later verdicts were rejected.

Fixes (engine rm2: `backend/app/roommates/memory.py`, `engine.py`):
- **Memory.** Every turn's prompt names both speakers and labels the other's message. It carries
  a memory parsed from the ACP fields: what the other already told you (never ask again), what
  you already shared (don't repeat), and this phase's open topics. History keeps only "X's clone
  said: ...".
- **Modules by phase.** Exploration loads routines, social and lifestyle; negotiation loads
  financial and dealbreakers. A topic the other raises loads its module before you reply.
- **Verdicts.** Only conclusion-phase verdicts decide strong / conditional. An "incompatible"
  still ends the chat at any point.
- **Fact checks.** A rejected invented dealbreaker becomes a FACT CHECK line that both clones and
  the analysis see.
- **Intro and non-negotiables.** The intro must state smoking, pets and non-negotiables. Each
  clone is told its exact non-negotiables, and that everything else is negotiable.
- **Plain-English lines.** Each reply starts with a `SAY:` line, the UI's main text. Gaps (and
  conversations kept from rm1) get lines from one cached narration call, and a line quoting a
  number its message doesn't contain is dropped.
