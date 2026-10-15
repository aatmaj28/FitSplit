# FitSplit: floor plan to 3D, furniture fit, fair rent split, roommate matching

Hackathon prototype for **LeaseHub** (agents post listings) and **Roombae** (students find roommates
and a place in Boston). The product name lives in one constant: `frontend/src/brand.ts`.

- **Agent side (LeaseHub):** upload a floor plan once when posting. The parser turns it into walls,
  rooms with areas, doors and windows, and the listing goes out with a 3D view and room sizes.
- **Renter side (Roombae):** students swipe through each other's cards; on a swipe right their AI
  clones negotiate as roommates first. The matched group then sees the unit in 3D, checks that their
  furniture fits, gets a fair rent split (with an AI check of its inputs) and applies together. The
  application lands in LeaseHub.

Honesty note (kept here, not in the UI): everything is sample data. The students, the agent (Dana
Brooks) and the group chat messages are fictional; listing facts come only from
`data/floorplans/meta.json`; syndication badges and 3D view counts are simulated. The whole demo
works offline from bundled data in `frontend/public/demo/`.

## Quick start

```bash
npm run dev:all          # from the repo root: API on :8000 (if backend/.venv exists) + web app on :5173
```

Open http://localhost:5173/demo for the guided 6-step walkthrough (Shift + arrow keys move between
steps), or http://localhost:5173 for the entry page. Without the backend (or without any API quota)
the web app still runs every demo screen from `frontend/public/demo/`.

First-time setup:

```bash
cd backend && uv venv --python 3.11 .venv && VIRTUAL_ENV=.venv uv pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env     # GEMINI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY (only needed for new uploads / live AI)
cd ../frontend && npm install
```

## What's where

```
backend/app/
  main.py               FastAPI: parse, plans, rent check, LLM usage; mounts the roommate router
  pipeline.py           floor plan pipeline (OpenCV geometry + vision semantics), output JSON, caching
  geometry/             preprocess, walls, gaps (door/window gaps), rooms, scale, extras (exported openings)
  semantics/            vision providers (Gemini -> Claude -> Groq), prompt, validation
  rentcheck.py          POST /api/rent-check: vision check of a rent split's inputs (never its numbers)
  llm/                  usage ledger + Claude call cap, text chain, vision helper, result cache
  roommates/            roommate finder (port of Tanvi's AI-Roommate-Finder, see below; memory.py = engine rm2)
backend/scripts/        parse_all.py, seed_roommates.py, groq_models.py
backend/tests/          pytest (no test ever reaches a real provider)
frontend/src/
  main.tsx              routes: / , /demo, /roombae/*, /leasehub/*, /dev (parser lab)
  components/FloorPlan3D/  the 3D viewer (lazy chunk): presets, cutaway, furniture fit, doors/windows
  components/RentSplit.tsx, RentCheck.tsx   rent split cards + "AI checked" badge
  roommates/            client, ACP rendering, chat replay (NegotiationView), Discover deck filters (deck.ts),
                        avatars + card facts (people.ts), replay dialog, questionnaire
  pages/roombae/        Roombae mock portal (Discover, My matches, Find a place together, listings, fill a room, apply)
  pages/leasehub/       LeaseHub mock portal    pages/portals.tsx  portal bar (Home + Roombae / LeaseHub switch)
  pages/demo/           guided walkthrough + floating step bar
  data/                 listings catalog, plan loader, shared demo store (localStorage, "Reset demo")
frontend/public/demo/   offline data: 6 parsed plans, 16 rent checks, roommate profiles + avatars + 12 negotiations
frontend/scripts/       checks, e2e tests, screenshot and precompute scripts
data/                   floor plans + meta.json, parsed plans, rent check cache, roommate data, LLM log/cache
docs/                   OVERNIGHT_REPORT.md, DEMO_SCRIPT.md, DECISIONS.md, PROGRESS.md, screenshots/
```

## Tests

```bash
cd backend && .venv/bin/python -m pytest -q        # 42 tests: API, parser extras, rent check, LLM chain, roommates
cd frontend && npm run check && npm run build       # offline logic checks (rent split, fit, keys) + type check + build
# with `npm run dev:all` running:
node scripts/e2e-viewer.mjs       # 3D: drag from any angle, orbit, touch, resize re-fit
node scripts/e2e-rentcheck.mjs    # AI check badge, Apply suggestion, offline
node scripts/e2e-demo.mjs         # the whole 6-step demo, online and with the backend blocked (+ screenshots)
node scripts/e2e-swipe.mjs        # Discover: deck filters, drag / keys / buttons, match + didn't click, My matches, group
node scripts/e2e-chat.mjs         # chat replay: follows only near the bottom, Jump to latest, pause / speed / skip
node scripts/e2e-nav.mjs          # landing entries, portal logos, Home link, portal switcher
```

## The pieces

**3D viewer** (`<FloorPlan3D plan={json} editable />`). 1 scene unit = 1 ft, top view matches the
image. Camera presets Top / Corner / Front / Side, rotate 45°, re-fit on resize. Walls between the
camera and the selected room fade (shader cutaway, no shadows from faded parts). Doors and windows
come from the parser's openings: the wall above each opening, sill + glass for windows, wood frames
for doors. Leftover floor (halls) shows in a neutral hallway color. Touch: one finger moves the
selected piece, two fingers orbit / zoom. Phones get a foldable room sheet.

**Furniture fit.** "Edit layout": add library pieces or custom W×D×H, or "Will my stuff fit?" to place
a set along the walls. 2D check in feet: red if a piece overlaps a wall, another piece or leaves its
room (1.5" tolerance). Doorways (parser doors plus outline gaps such as closet fronts) get a 2.5 ft
keep-clear zone: auto-place avoids it, and a piece in it gets an amber note. Layouts persist per plan.

**Rent split.** Fair split: each bedroom's own area plus a private bath is private; that share of
the rent is split by private area and the rest equally. Or by room size only. Shares are whole
dollars that always sum to the rent. **AI check** (`POST /api/rent-check`): one vision call with
the plan image checks the inputs (bedroom count, private baths, areas within 15%, extras like a
private balcony) and writes a note for the roommates. It never changes numbers: suggestions are input
toggles the user applies, and a note quoting any number we didn't send is replaced by a template.
Results are cached by an input key computed the same way in Python and TypeScript.

**Roommate finder** (`backend/app/roommates/`). The engine is a port of **Tanvi's (GitHub Tanvi-15)
[AI-Roommate-Finder](https://github.com/Tanvi-15/AI-Roommate-Finder)**: her 7-section questionnaire and
ACP/1.0 clone prompts are copied verbatim, and her four-phase negotiation loop, keyword verdict and
compatibility analysis are ported with documented fixes (13 turns, no double feed, ACP verdicts parsed,
false "incompatible" triggers removed). Engine rm2 (`roommates/memory.py`) makes the clones use what the
other said:
- each turn labels who is speaking and carries a memory of what each side has already stated;
- each clone gets its own profile when the phase needs it;
- only a real non-negotiable ends a chat early;
- every message has a plain-English line, shown in the chat with the protocol folded under "details".

Added for FitSplit:
- local JSON storage, REST + Server-Sent Events;
- "Find roommates" (people first): **Discover**, a Tinder-style swipe deck ported from Tanvi's
  **Setup Match** page, and **My matches**, ported from her **My Matches** page (verdict counts,
  "Show incompatible", scores, replay). The deck uses her filters: same city first, then the same
  metro area, "same gender only" checked both ways, swiped profiles hidden. A swipe right plays the
  clones' conversation and ends on "It's a match!" or "Your clones didn't click". Matches then form
  a group, and the group gets listings where every fair-split share fits each budget. Every card in
  the demo deck has a bundled conversation, so swiping works offline. Swipes live in localStorage,
  and "Reset demo" clears them;
- "Fill a room" (apartment first): a ROOM module with the real room, its exact share and the furniture
  fit, an everyone or majority rule, and exact budget / same-gender checks before any model call;
- verdict guards against invented dealbreakers.
Text models: Groq gpt-oss-120b -> gpt-oss-20b -> qwen3.8-27b -> Gemini -> Claude Sonnet, every call
logged in `data/llm/` and Claude capped (`CLAUDE_CALL_CAP`, 57 in total).

Avatars are illustrations in DiceBear's "Notionists" style (artwork by Zoish, CC0 1.0; DiceBear code
MIT). `frontend/scripts/make-avatars.mjs` writes them to `public/demo/avatars/` once, so no avatar
service or library is needed at runtime. Without an avatar, initials are shown.

**Portals and demo.** `/leasehub`: dashboard with a labelled time-saved estimate, new listing
(upload or sample plan, parse, 3D preview, auto-filled details, publish, simulated syndication),
listing page, group application view. `/roombae`: home, listings (fair-split room prices, filters),
listing detail, roommate finder, fill a room, group apply. `/demo` drives the real pages; one shared
store keeps names, units and rents consistent; "Reset demo" restores the seed.

## Floor plan parser (backend)

```bash
cd backend
.venv/bin/python scripts/parse_all.py                         # all plans (uses cache when present)
.venv/bin/python scripts/parse_all.py --reuse-semantics       # re-run OpenCV only (no API calls)
.venv/bin/python scripts/parse_all.py --provider claude --no-cache --only jvue_3bed
curl -F image=@../data/floorplans/jvue_3bed.png localhost:8000/api/parse
curl localhost:8000/api/plans/jvue_3bed      # parsed JSON;  /api/plans/jvue_3bed/image?max_side=320 thumbnail
curl localhost:8000/api/llm/usage            # API calls per provider + Claude calls left
```

Results are cached by image hash + the params that change the output; vision answers are cached
separately in `data/parsed/_semantics/`, so geometry re-runs need no network. With `data/parsed/`
present the API never calls a provider for a known plan.

Output: all coordinates are original-image pixels; `scale.pixels_per_foot` is in the same pixels.
Fields: `source_image, image_size, semantics_provider, scale, walls (+holes), rooms, footprint,
openings, unit, warnings`, plus per room `area_sqft_final` (printed dims if present, else measured)
+ `area_source`, bedroom `closet_ids` + `area_with_closets_sqft`, `printed_dims_text`,
`shared_region_with`, and `checks` / `processing` for debugging. `openings` (door / window / opening
rectangles) are an export-only extra built from the gap rays segmentation already computes.

Tuning: every kernel and threshold is in `DEFAULT_CONFIG` (`backend/app/config.py`), per-plan
overrides in `PLAN_CONFIGS`; after edits run `parse_all.py --reuse-semantics` and look at
`data/parsed/<plan>/rooms_overlay.png`.

## Notes

- Roombae and LeaseHub appear by name only. The portals use original styling and simple original
  marks, not their logos or assets.
- `external/` (the cloned roommate-finder repo) is gitignored, as are all `.env` files and
  `test_keys.py`. Provider errors are logged with account identifiers redacted.
