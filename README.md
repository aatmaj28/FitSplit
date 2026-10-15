# Roombae × LeaseHub: floor plan parser + 3D viewer

Floor plan image → wall polygons + labeled room regions with areas + scale (backend), rendered as an
interactive 3D model with a furniture fit check and a fair rent split (frontend).

```
backend/
  app/
    main.py            FastAPI: POST /api/parse, GET /api/health
    pipeline.py        orchestration, output JSON, caching
    config.py          paths, provider settings, DEFAULT_CONFIG (every kernel/threshold) + PLAN_CONFIGS
    cache.py           result cache (by image hash + params) and vision-answer cache
    meta.py            data/floorplans/meta.json lookup (by filename, else by identical bytes)
    debug.py           debug images
    geometry/
      preprocess.py    load, composite on white, resize longest side to 1600px, grayscale
      walls.py         wall mask: solid | outline | auto, wall polygons (outer ring + holes)
      gaps.py          door/window gap closing (rays from free wall ends), segmentation only
      rooms.py         room regions: fragments -> merge -> split shared regions
      scale.py         pixels per foot: printed room dims > total_sqft > manual
    semantics/
      prompt.py        the single prompt all providers get
      providers.py     call_gemini / call_claude / call_groq (same signature)
      chain.py         fallback chain Gemini -> Claude -> Groq, retries, validation
      schema.py        pydantic models + feet/inch parser
  scripts/
    parse_all.py       parse every plan in data/floorplans, print summary table
    groq_models.py     list Groq models, flag the ones with image input
  requirements.txt  .env (not committed)  .env.example
frontend/
  src/components/FloorPlan3D/   <FloorPlan3D plan={json} imageUrl=... editable />, reusable viewer
    furniture.ts                furniture library, fit check (polygon-clipping), auto-place along walls
    FurnitureLayer.tsx          3D furniture boxes, drag on the floor
    FurniturePanel.tsx          "Add furniture" / "Will my stuff fit?" side panel
    useLayout.ts                per-plan layout in localStorage
  src/components/RentSplit.tsx  <RentSplit plan={json} />, rent split cards
  src/rentSplit.ts              rent split math (fair / by room size), whole-dollar rounding
  src/App.tsx                   dev page: plan picker, upload, 3D view + rent split, offline fallback
  public/demo/                  jvue_3bed + longwood_2bed JSON/images for offline demos
  scripts/sync-demo.mjs         refresh public/demo from data/parsed
  scripts/check-step3.mjs       offline checks: rent split totals, fit check (no browser, no backend)
  scripts/screenshots.mjs       regenerate docs/screenshots (3D views)
  scripts/screenshots-step3.mjs regenerate docs/screenshots (furniture fit, rent split)
data/
  floorplans/          input images + meta.json
  parsed/              <plan>.json, <plan>/ debug images + original image, _semantics/ cached vision answers
docs/screenshots/      3D, top view with 2D overlay, furniture fit (green / red / 3D), rent split
```

## Run

```bash
cd backend
uv venv --python 3.11 .venv && VIRTUAL_ENV=.venv uv pip install -r requirements.txt
cp .env.example .env    # fill GEMINI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY

.venv/bin/python scripts/parse_all.py                         # all plans (uses cache when present)
.venv/bin/python scripts/parse_all.py --no-cache              # fresh vision calls + geometry
.venv/bin/python scripts/parse_all.py --provider claude --no-cache --only jvue_3bed,longwood_2bed
.venv/bin/python scripts/parse_all.py --reuse-semantics       # re-run OpenCV only (config tuning, no API calls)

.venv/bin/uvicorn app.main:app --reload --port 8000
curl localhost:8000/api/health
curl -F image=@../data/floorplans/jvue_3bed.png localhost:8000/api/parse
curl -F image=@../data/floorplans/jvue_3bed.png -F provider=claude -F wall_style=solid localhost:8000/api/parse
curl localhost:8000/api/plans                       # cached plans: name, unit, thumbnail_url
curl localhost:8000/api/plans/jvue_3bed             # parsed JSON
curl -o plan.png localhost:8000/api/plans/jvue_3bed/image   # original image (?max_side=320 = thumbnail)
```

Frontend (second terminal; the dev server proxies `/api` to `localhost:8000`):

```bash
cd frontend
npm install
npm run dev              # http://localhost:5173  (?plan=jvue_3bed&view=top&overlay=1 also works)
npm run build            # type-check + production build
npm run demo:sync        # copy data/parsed -> public/demo for the offline fallback
npm run check            # offline checks: rent split totals + furniture fit (demo JSONs)
npm run screenshots      # needs dev server + backend; writes docs/screenshots
npm run screenshots:step3
```

If the backend is unreachable the dev page loads `public/demo/` and shows an "Offline demo data" badge.

```tsx
import { FloorPlan3D } from "./components/FloorPlan3D";
import { RentSplit } from "./components/RentSplit";
<FloorPlan3D plan={parsedJson} imageUrl="/api/plans/jvue_3bed/image" wallHeight={9} onRoomSelect={(r) => ...} />

// furniture editing + rent split, room selection shared both ways
const [roomId, setRoomId] = useState<string | null>(null);
<FloorPlan3D plan={parsedJson} editable selectedRoomId={roomId} onRoomSelect={(r) => setRoomId(r?.id ?? null)} />
<RentSplit plan={parsedJson} selectedRoomId={roomId} onSelectRoom={setRoomId} />
```
1 scene unit = 1 ft; image x -> scene X, image y -> scene Z (top view matches the 2D image, not mirrored).

**Furniture fit** (`editable`): "Edit layout" → click a room → "Add furniture" (library or custom
W×D×H inches) or "Will my stuff fit?" (pick counts, places them along the walls). Drag pieces on the
floor (3" snap), R / "Rotate 90°", Delete. The check is 2D in feet: a piece is red if it overlaps a
wall polygon, another piece, or leaves its room polygon (1.5" tolerance for drawing slop); the panel
says what it hits and how much floor is left. The parser exports no doors, so doorways come from the
geometry: stretches of a room outline with no wall next to them that don't lead out of the building
(doors, archways, closet fronts; windows are dropped). The 2.5 ft in front of each is a dashed
"keep clear" zone: auto-place avoids it, and a piece standing in it still fits but gets an amber
"blocks a doorway" note. Edit mode lowers the walls to 4 ft so furniture stays visible in 3D (the
slider still works). Layouts are saved per plan in localStorage ("Reset layout").

**Rent split**: *Fair split*: private area = bedroom `area_sqft_final` (+ its private bath when
`has_private_bath`; the nearest bathroom within 10 ft). The private share of the rent is
`rent × Σprivate / unit.total_sqft` (sum of all rooms if the unit has no total), split by private
area; the rest (shared space) is split equally.
*By room size only*: the whole rent by bedroom area. "Include attached closets" uses
`area_with_closets_sqft`. Shares are rounded to whole dollars (largest remainder) and always sum to the rent.

`/api/parse` form fields: `image` (file), optional `wall_style` (solid|outline|auto), `pixels_per_foot`
(original-image px; only used when neither printed dims nor total_sqft give a scale), `provider`
(force one, no fallback), `no_cache`.

## Caching / offline demo

Results are keyed by image hash + the params that change the output (`provider`, `wall_style`,
`pixels_per_foot`). Default runs are saved as `data/parsed/<plan>.json`; forced-param runs as
`<plan>__claude.json`, `<plan>__solid.json`, etc., so comparisons never overwrite the demo files.
Vision answers are cached separately in `data/parsed/_semantics/`, so geometry can be re-run or
re-tuned without network access. With `data/parsed/` present the API never calls a provider.

## Output

All coordinates are original-image pixels; `scale.pixels_per_foot` is in the same pixels.
Spec fields: `source_image, image_size, semantics_provider, scale, walls, rooms, unit, warnings`.
Additions: `walls[].holes` (wall rings enclose rooms, so the inner rings are needed to extrude them),
`footprint` (building outline for a continuous 3D floor slab),
`rooms[].area_sqft_final` (printed dims area if present, else measured) + `area_source`,
bedroom `closet_ids` + `area_with_closets_sqft` (measured bedroom + measured closets, since printed
bedroom dims sometimes already include the closet strip),
`rooms[].label_point_norm / printed_dims_text / printed_area_sqft / area_vs_printed_pct /
segmentation / segmentation_notes / shared_region_with`, plus `checks` and `processing` (provider
attempts, wall-style scores, scale iterations and per-room scale votes, effective config, timings).

## Tuning

Every kernel size and threshold is in `DEFAULT_CONFIG` (`backend/app/config.py`); feet-based values
are converted with the running pixels-per-foot estimate, pixel values refer to the 1600px image.
Per-plan overrides go in `PLAN_CONFIGS["<plan stem>"]` and are deep-merged. After editing, run
`parse_all.py --reuse-semantics` and look at `data/parsed/<plan>/rooms_overlay.png`.
