# Overnight progress

Resume here after a context reset: read this file, `docs/DECISIONS.md`, then `git log --oneline`.
Branch: `overnight` (baseline on `main`). Checks after every phase: `cd frontend && npm run check && npm run build`, `cd backend && .venv/bin/python -m pytest -q`.

| Phase | Status | Notes |
|---|---|---|
| 0 Safety (git, .gitignore, baseline commit) | done | baseline `main`, work on `overnight` |
| 1 3D view upgrades | done | presets, cutaway, resize re-fit, overlay labels, touch, lazy load; `npm run e2e:viewer` 10/10 |
| 2 AI-checked rent split | done | POST /api/rent-check, 16 precomputed checks, badge + Apply suggestion; `npm run e2e:rentcheck` 17/17 |
| 3 Roommate finder engine | in progress | repo cloned to external/AI-Roommate-Finder; analysis -> docs/notes/roommate_engine_analysis.md |
| 4 Roombae portal | todo | |
| 5 LeaseHub portal | todo | |
| 6 End-to-end demo flow | todo | |
| 7 Polish | todo | |
| 8 Morning docs | todo | |

## Log
- Phase 0 done: git init, .gitignore hardened, secret scan clean, baseline commit.
- Phase 1 done: camera presets (Top/Corner/Front/Side, rotate 45), wall cutaway shader, re-fit on resize, overlay labels moved off printed text, touch drag (1 finger piece / 2 fingers camera), foldable phone sheet, lazy 3D chunk. Backend pytest suite added (5 baseline tests). Screenshots: edit_corner/front/side/rotated, top_2d_labels, phone_edit.
- Phase 2 done: app/llm (usage ledger + Claude cap 80, text chain Groq->Gemini->Claude, vision helper, cache), app/rentcheck.py + endpoint, frontend rentCheck.ts + RentCheck.tsx, per-bedroom private-bath toggle, all 6 plans in public/demo, 16 checks bundled in public/demo/rentcheck. Claude calls used: 16/80 (Gemini quota exhausted).
