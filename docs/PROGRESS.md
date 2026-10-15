# Overnight progress

Resume here after a context reset: read this file, `docs/DECISIONS.md`, then `git log --oneline`.
Branch: `overnight` (baseline on `main`). Checks after every phase: `cd frontend && npm run check && npm run build`, `cd backend && .venv/bin/python -m pytest -q`.

| Phase | Status | Notes |
|---|---|---|
| 0 Safety (git, .gitignore, baseline commit) | done | baseline `main`, work on `overnight` |
| 1 3D view upgrades | done | presets, cutaway, resize re-fit, overlay labels, touch, lazy load; `npm run e2e:viewer` 10/10 |
| 2 AI-checked rent split | done | POST /api/rent-check, 16 precomputed checks, badge + Apply suggestion; `npm run e2e:rentcheck` 17/17 |
| 3 Roommate finder engine | done | backend/app/roommates (port + fixes + exact checks), SSE, 8 sample profiles, 10 bundled negotiations; 40 backend tests |
| 4 Roombae portal | done | /roombae: home, listings, detail (3D + fit + split + AI check), roommate finder (live/replay), fill a room, group apply |
| 5 LeaseHub portal | done | /leasehub: dashboard (+time saved estimate), new listing (upload/sample -> parse -> 3D -> publish -> syndication), listing page, application view |
| 6 End-to-end demo flow | done | /demo + floating step bar, shared store, Reset demo, `npm run dev:all` (root); `node scripts/e2e-demo.mjs` passes online + offline |
| 7 Polish | done (1-4), 5 partly | doors/windows in 3D from parser openings, keep-clear zones from doors, hallway color, consistent states; bundle: main 311 kB, 3D chunk lazy |
| 8 Morning docs | done | OVERNIGHT_REPORT.md, DEMO_SCRIPT.md, README, 39 screenshots |

## Log
- Phase 0 done: git init, .gitignore hardened, secret scan clean, baseline commit.
- Phase 1 done: camera presets (Top/Corner/Front/Side, rotate 45), wall cutaway shader, re-fit on resize, overlay labels moved off printed text, touch drag (1 finger piece / 2 fingers camera), foldable phone sheet, lazy 3D chunk. Backend pytest suite added (5 baseline tests). Screenshots: edit_corner/front/side/rotated, top_2d_labels, phone_edit.
- Phase 2 done: app/llm (usage ledger + Claude cap 80, text chain Groq->Gemini->Claude, vision helper, cache), app/rentcheck.py + endpoint, frontend rentCheck.ts + RentCheck.tsx, per-bedroom private-bath toggle, all 6 plans in public/demo, 16 checks bundled in public/demo/rentcheck. Claude calls used: 16/80 (Gemini quota exhausted).
- Phases 3-6 first pass done: roommate engine port + API + SSE, Roombae and LeaseHub portals, guided demo, root dev:all. Regenerating Meera/fill negotiations with verdict guards (log: scratchpad seed_roommates4.log). Claude calls 17/80.
- Phase 7 done: openings export + doors/windows/frames in 3D, door-based keep-clear zones, hallway color, verdict guards + lease check, scenarios final (find: strong / conditional / conditional / incompatible; fill: Rohan match, Jake no, Kavya exact budget no). All suites green: pytest 42, check, build, e2e viewer / rentcheck / demo (online + offline).
- Phase 8 done: report, demo script, README; fixed cold-start Vite dep optimization; all suites green from a cold `npm run dev:all` (pytest 42, check 49, e2e viewer 10, rentcheck 17, demo 42).

## 2026-10-15 fixes (from the tour)

| Fix | Status | Notes |
|---|---|---|
| 1 Chat auto scroll + replay controls | done | NegotiationView scroll box, Jump to latest, pause / 1×2×4× / Skip to verdict; `scripts/e2e-chat.mjs` |
| 2 Navigation | done | landing with 3 entries, PortalBar (Home + switcher), logos to portal home; `scripts/e2e-nav.mjs` |
| 3 Swipe to match | done | Discover + My matches (Tanvi's Setup Match / My Matches), avatars, deck filters; `scripts/e2e-swipe.mjs` (online, offline, phone) |
| 4 Clone conversation quality | todo | |
| 5 Reset view button | todo | |
| 6 Demo step bar sync | todo | |

API budget for these fixes: Groq first, Claude at most 40 more calls (cap 57 in total), everything cached.
