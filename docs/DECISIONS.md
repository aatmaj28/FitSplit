# Decisions (overnight run, 2026-10-15)

One line each, newest last. Format: `[phase] decision (why)`.

- [0] Baseline committed on `main`; all overnight work happens on branch `overnight` (keeps a clean fallback; merge in the morning).
- [0] `external/` is gitignored entirely: the roommate-finder clone has its own git history, a `.env` slot and real users' emails in `data/users.json`, none of which belong in our repo.
- [0] Extra `.gitignore` rules for `**/.env`, `**/.env.*` (except `.env.example`), credentials/secret files, `node_modules/`, `dist/` anywhere.
- [0] The cloned repo (Tanvi-15/AI-Roommate-Finder, last commit 2026-03-22) is public and cloned fine, so the engine is ported from code, not rebuilt from the description.
- [1] Wall cutaway replaces Step 3's "lower walls to 4 ft in edit mode": walls keep the slider height; wall pixels whose view ray lands inside the selected room's box (at floor or 3 ft) fade to 14% and stop casting shadows (shader only, no geometry change).
- [1] Top view stays orthographic (exact match with the 2D image); Corner / Front / Side are perspective presets with 0.35 s transitions; "Rotate 45°" from the top view switches to the corner view turned by 45°.
- [1] Touch: with a piece selected, one finger moves it from anywhere on the canvas (relative drag) and two fingers pinch-zoom/rotate; with nothing selected one finger orbits. Capture-phase listener decides before camera-controls sees the finger, so the page never scrolls.
- [1] Clicking a piece without dragging used to fall through to the floor and deselect it; pieces now stop the click.
- [1] Labels over the 2D overlay move ~3.4 ft below the printed name + dims (or above if that leaves the room); closets / rooms under 30 sq ft are hidden there and on phones unless selected.
- [1] `FloorPlan3D` is lazy (Suspense wrapper exported from the index): main bundle 241 kB, three.js chunk 1.06 MB loads with the first 3D view.
- [1] Dev-only `window.__fp3dProject` probe (plan ft -> page px) powers browser tests; it's compiled out of production builds.
- [1] Backend had no test suite; added pytest (backend/requirements-dev.txt) with an autouse fixture that fails any test reaching a real provider.
- [2] Rent check cache key is a plain string of the inputs (plan, method, closets, rent, per-bedroom area/bath/share) hashed with 2x FNV-1a, implemented identically in Python and TS (no crypto.subtle, so it also works over plain http on a phone). Cross-language test pins the value.
- [2] The AI never touches numbers: suggestions are limited to input toggles (`set_private_bath`, `include_closets`) that the user applies with a button; an explanation quoting any $ amount or sq ft we didn't send is replaced by a code template.
- [2] Lookup order in the browser: bundled demo results (public/demo/rentcheck) -> backend cache (`?cache_only=1`) -> a live check only when the user clicks "Check with AI". No surprise API calls while toggling.
- [2] Added a per-bedroom "Private bath" toggle on the rent cards (the input the AI may suggest flipping).
- [2] Precomputed 16 checks: JVUE 3 bed + Longwood 2 bed (fair / size / fair+closets / each bedroom's bath flag flipped / one level of applied suggestions), plus the default split of the other 4 listings.
- [2] Gemini's free quota was exhausted (429 RESOURCE_EXHAUSTED) and it also returned 503s, so all 16 checks were answered by Claude (claude-opus-5-5, the parser's vision model): 16 of 80 Claude calls used. Added transient-error retries (503) and a 10 min cooldown for quota-exhausted providers so the chain stops burning attempts.
- [2] Vision calls run in a worker thread; the usage "purpose" label is carried over with contextvars.copy_context().
