# Overnight report: 2026-10-15

## Status

- **Ready to demo.** Run `npm run dev:all` from the repo root, then open http://localhost:5173/demo.
  Every demo screen also works with the backend stopped and no API quota.
- **All 8 phases are done.** Not done or partial: further bundle splitting (Phase 7.5), and some
  rough edges in parsed doors (see Known issues).
- **Git.** Work is on branch `overnight`: 5 commits on top of the `main` baseline. It has not been
  merged or pushed.
- **Tests: all green.**

  | Suite | Result |
  |---|---|
  | backend pytest | 42 passed |
  | `npm run check` (offline logic) | 49 passed |
  | `npm run build` | ok |
  | `e2e-viewer` | 10/10 |
  | `e2e-rentcheck` | 17/17 |
  | `e2e-demo` (the 6-step demo, online + with the backend blocked) | 42/42 |

  The browser suites were run against a cold-start `npm run dev:all`.
- **API budget.** Claude: 17 of 80 calls used. Groq: 302 requests, 145 successful (the rest were
  rate-limit retries). Gemini: 47 attempts, 0 successes; its free quota was already used up.

## Phases

| Phase | Status | Where |
|---|---|---|
| 0. Safety | done | `git init`, hardened `.gitignore`, baseline commit, secret scans (history clean) |
| 1. 3D view upgrades | done | `frontend/src/components/FloorPlan3D/` (PlanScene, FurnitureLayer, ViewerToolbar, LazyFloorPlan3D) |
| 2. AI-checked rent split | done | `backend/app/rentcheck.py`, `frontend/src/rentCheck.ts`, `components/RentCheck.tsx` |
| 3. Roommate finder | done | `backend/app/roommates/` (port of Tanvi's engine), `frontend/src/roommates/` |
| 4. Roombae portal | done | `frontend/src/pages/roombae/` |
| 5. LeaseHub portal | done | `frontend/src/pages/leasehub/` |
| 6. End-to-end demo | done | `frontend/src/pages/demo/`, `frontend/src/data/store.ts`, root `npm run dev:all` |
| 7. Polish | done (items 1-4), item 5 partly | doors/windows, door-based keep-clear zones, hallway color, consistent states |
| 8. Docs | done | this file, `DEMO_SCRIPT.md`, `README.md`, `docs/screenshots/` (39 images) |

## What was built

**1. 3D view**
- Camera presets Top / Corner / Front / Side, and rotate 45° left/right, with smooth transitions.
- Full orbit, zoom and pan in edit mode; orbit pauses only while a piece is being dragged.
- Wall cutaway: a shader fades the wall pixels whose view ray lands in the selected room. Faded
  parts cast no shadows. This replaced the earlier "lower walls to 4 ft" behaviour.
- The camera re-fits when the window is resized.
- With the 2D plan overlaid in top view, labels move off the printed room names and dimensions.
- Touch: one finger moves the selected piece, two fingers orbit and zoom, and the page never scrolls.
- Phones get a foldable room sheet and fewer labels.
- The 3D viewer is a lazy chunk: the main bundle is 311 kB, and three.js loads only with the first 3D view.

**2. AI-checked rent split**
- `POST /api/rent-check` makes one vision call (floor plan image plus the split's inputs). It checks
  bedroom count, private baths, areas within 15%, and extras such as Bedroom 3's own balcony and
  extra closets. It returns ok/warn, its checks, suggestions, and a note for the roommates.
- The model never changes numbers. Suggestions are input toggles with an "Apply suggestion" button.
  A note quoting any $ or sq ft value we didn't send is replaced by a code template.
- Results are cached by an input key computed identically in Python and TypeScript.
- 16 checks are bundled for offline use: both main units across method / closets / every wrong
  private-bath flag, plus the default split of the other 4 listings.

**3. Roommate finder**
- Tanvi's (GitHub Tanvi-15) repo was cloned to `external/` (gitignored, not modified) and analysed in
  `docs/notes/roommate_engine_analysis.md`.
- Ported faithfully: questionnaire and ACP prompts copied verbatim; phases, starter, keyword verdict,
  history window and analysis prompt as written.
- Fixed: the 13-turn conclusion (it ran 15), the doubled message feed, parsing of ACP verdicts, and
  false "incompatible" triggers.
- Added:
  - local JSON storage, REST + SSE, and cached replay with a typing animation;
  - "Find roommates" (pairs → groups → listings where every fair-split share fits each budget);
  - "Fill a room": a ROOM module with the real room, exact share, private bath and furniture fit;
    exact budget and same-gender checks before any model call; an everyone / majority rule;
  - verdict guards in code (see Known issues).
- 8 fictional students and 10 bundled negotiations.
  - **Find roommates:** Priya + Ananya strong; Priya + Meera conditional (lease length);
    Ananya + Meera conditional (move-in date); Priya + Jake incompatible (smoking).
  - **Fill a room** (JVUE 3 bed, Bedroom 2, $1,360):
    - Rohan is a match (Arjun conditional, Sofia strong);
    - Jake is not (smoking);
    - Kavya is not: her $1,250 hard budget cap fails the exact check, with zero model calls.

**4. Roombae** (`/roombae`)
- Home with search, plus "Find roommates" and "Fill a room" entry points.
- Listings with fair-split room prices, filters, and a "fits my group" view.
- Listing detail: 3D view, furniture fit, rent split with AI check, and calls to action.
- Roommate finder: the prefilled questionnaire (all 7 sections), live or replayed negotiations, the
  group, and listings that fit.
- Fill a room, and group apply.

**5. LeaseHub** (`/leasehub`)
- Dashboard with listings, group applications, showing requests, and a "time saved" panel labelled
  as an estimate.
- New listing: upload or sample plan, cached parse, 3D preview, details auto-filled from the plan,
  Publish, simulated syndication badges.
- Listing page as renters see it.
- Group application view: shares, AI check, compatibility.

**6. Demo**
- `/demo` drives the real pages, with a floating step bar (Shift + arrows, Page Up/Down) and "Reset demo".
- One shared localStorage store keeps the same three students, the JVUE 3 bed and the $4,200 rent
  across both portals.
- Root `npm run dev:all` starts both servers. Without the backend venv it starts the web app only.

**7. Polish**
- The parser now exports `openings` as an additive extra built from gap rays it already computed.
  Rooms, walls, scale and footprint were verified identical before and after, with 0 API calls.
- 3D doors (wood frames, wall above) and windows (sill, glass, frame), all cut away like walls.
- Furniture keep-clear zones come from real doors, plus outline gaps such as closet fronts.
- The leftover floor shows in a neutral hallway colour with a legend chip.
- Empty, loading and error states on every page.

## How to run

```bash
npm run dev:all                     # API :8000 + web :5173 (repo root)
cd frontend && npm run dev          # web only: fully offline from public/demo
cd backend && .venv/bin/python -m pytest -q
cd frontend && npm run check && npm run build
node frontend/scripts/e2e-demo.mjs  # needs the dev server; also rewrites docs/screenshots
```

Regenerating the bundled data costs nothing when the inputs are unchanged, because everything is
cached:
- `node scripts/precompute-rentcheck.mjs` (rent checks);
- `node scripts/seed-roommates.mjs` (negotiations; profiles from `backend/scripts/seed_roommates.py`);
- `npm run demo:sync` (parsed plans).

## API calls tonight

All calls are counted in `data/llm/usage.json` and listed in `data/llm/calls.jsonl` (no prompts,
answers or keys; account ids redacted).

| Provider / model | Purpose | OK | Failed | Note |
|---|---|---|---|---|
| Claude `claude-opus-5-5` (vision) | rent checks | 16 | 0 | 15 logged as rent_check, 1 as "semantics" (before the label fix) |
| Claude `claude-sonnet-5-5` | roommates | 0 | 1 | client-side SDK error (`temperature`); it still counts against the cap |
| Gemini `gemini-flash-latest` | rent checks / roommates | 0 | 47 | quota exhausted (429) and 503s |
| Groq `openai/gpt-oss-120b` | roommates | 68 | 69 | failures are per-minute 429s, then the daily token cap |
| Groq `openai/gpt-oss-20b` | roommates | 76 | 87 | per-minute 429 retries |
| Groq `llama-3.3-70b-versatile` | roommates | 0 | 1 | not available on this account (404) |
| Groq `openai/gpt-oss-120b` | rate-limit probe | 1 | 0 | |

Totals: **Claude 17/80** (63 left), **Groq 302** (145 OK), **Gemini 47** (0 OK).
Tokens: Claude 53k in / 18k out, Groq 261k in / 30k out.

## Known issues (honest)

1. **The clones are agreeable and the free models are uneven.** Verdicts are partly shaped by code:
   - lease / move-in mismatches nobody is flexible on cap "strong" at "conditional";
   - an "incompatible" that blames smoking, pets, gender or an already-settled budget is ignored
     when the profiles show no such conflict (gpt-oss-20b invented "no smoking indoors" between two
     non-smokers);
   - an analysis that finds a confirmed dealbreaker overrides a soft verdict.

   All of this is documented in the reason text and in `DECISIONS.md`. The conversations are still
   LLM text and sometimes invent small details (a "$500 deposit", for example).
2. **Later turns of some negotiations use gpt-oss-20b.** gpt-oss-120b hit Groq's 200k tokens/day
   cap. Live negotiations today will use 20b or qwen until 120b's quota resets.
3. **Gemini's free quota is used up, so live rent checks for new inputs go to Claude** (counted
   against the cap). Bundled inputs never call a model.
4. **Parsed doors and windows are heuristic.**
   - JVUE's windows aren't drawn as glass lines, so they are inferred from outside walls.
   - A few doors are missed (JVUE Bedroom 3's entry has no 3D frame); the outline heuristic still
     gives it a keep-clear zone.
   - Wide interior "openings" only get a wall piece above.
   - The unit entry door is recognised by its size (2.2-3.5 ft); an unusual exterior gap could be
     shown as a window.
5. **Hallways.** Halls in JVUE and Longwood are part of the living-room polygons (from
   segmentation), so they show the living colour. Only floor no room covers gets the hallway colour.
6. **Bundled rent checks are keyed on exact areas.** If a parser change ever moved areas, those
   inputs would fall back to "Check with AI".
7. **Questionnaire edits stay local.** A negotiation with edited answers needs the backend (and
   quota). Offline, only the bundled pairs replay.
8. **Simulated or sample parts.** Syndication is simulated. The time-saved panel and 3D view counts
   are labelled sample estimates. All people are fictional sample profiles.
9. **Phone testing was emulated only.** The phone layout and touch gestures were tested in Chrome
   emulation (CDP touch events), not on a physical phone.
10. **Fixed tonight, worth knowing:** a fresh dev server re-bundled dependencies when the lazy 3D
    chunk was first opened, and the import failed. `optimizeDeps` now pre-bundles them; the e2e
    suites pass from a cold cache.

## Not done / next steps

- **Phase 7.5 (performance):** only lazy loading is done. Splitting drei / three further and merging
  the many small opening boxes into one geometry are both possible; current sizes run smoothly on a
  laptop.
- **Doors** could use the door swing arcs in the drawings to classify doors vs windows better.
- **Merge** `overnight` into `main` after a look.

## Safety notes

- API keys live only in `backend/.env` (gitignored, never printed). History scanned for key
  patterns: clean.
- A test fixture briefly contained the Groq org id. It was amended out of the unpushed commit and
  the old objects were pruned.
- `external/` is gitignored. Tanvi's repo includes real users' emails in `data/users.json`; nothing
  from it was copied.
- Roombae and LeaseHub appear by name only, with original styling. Listing facts come only from
  `meta.json`, located as "Boston, MA", and marked as samples.
