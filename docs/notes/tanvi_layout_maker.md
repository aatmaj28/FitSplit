# Tanvi's layout maker (video2floorplan)

Repo: https://github.com/Tanvi-15/Layout-maker, by **Tanvi Deshpande**. One commit, 2026-10-16,
"video2floorplan: walkthrough video to 2D floor plan". Read from `external/Layout-maker` (a read-only
clone, gitignored).

**License: the repo has no license file.** Without one, the default is "all rights reserved". Aatmaj
is confirming with Tanvi that FitSplit may use and publish the ported code.

## What it does, in short

It turns a handheld apartment walkthrough video (phone, ultra-wide, often WhatsApp-compressed) into
a 2D floor plan. It has three workflows.

### Workflow A: schematic floor plan (the default, and the one that works on these videos)

1. **Contact sheets** (`v2p/sheets.py`). ffmpeg takes one frame per second, 200 px wide. They are
   tiled 10 × 4 per sheet, and each tile is stamped with its time ("16s", yellow on black).
2. **A model reads the sheets and writes two files.**
   - `timeline.json`: which seconds show which room, e.g. `{"t": [16, 24], "room": "living",
     "label": "living room", "objects": ["3-window bay", "ceiling fan"]}`.
   - `layout.json`: the whole apartment at once. Each room has a type, a label, a rectangle in metres
     (`rect: [x, y, w, h]`, with x across the building and y going back from the street), a
     confidence, the seconds that show it (`evidence_s`) and features. An optional `polygon` gives
     the exact outline for bay windows, L shapes and angled walls. Openings (door, opening, window,
     bay_window) are wall segments in metres with the rooms they join. Free-text notes record what
     can't be confirmed.

   **This step is not automated in her repo.** Claude wrote both files in a chat, frame by frame
   ("manual reading of videos/apartment1.mp4 (Claude, frame-by-frame)"). The README says "a
   Gemini/Claude API step can automate it later", and `v2p/layout.py` already holds the JSON schema
   meant as that step's structured-output contract (`SCHEMA`).
3. **Render** (`v2p/layout.py`). It validates the layout (duplicate ids, unknown types, polygon
   points outside their rectangle, overlapping rooms, openings that name unknown rooms), prints a room
   table with areas (shoelace area for polygons) and draws `layout.png` / `layout.svg` with
   matplotlib. Sizes are labelled as estimates; a ✓ marks measured ones.

Sizes in Workflow A come from visual cues: doors are about 0.8 m wide, windows 0.8 to 0.9 m, and a
queen bed about 1.5 × 2.0 m.

### Workflow C: schematic layout plus measured sizes (her recommended path)

1. **Measure** (`v2p/measure.py`). For each room in the timeline, it takes that room's frames
   (re-decoded at 8 fps if the room was seen only briefly) and runs **Depth Anything 3**.
   DA3-LARGE-1.1 gives camera poses and depth, and DA3METRIC-LARGE gives the metric scale. Then:
   - it finds the floor plane with RANSAC, and the floor and ceiling heights;
   - it takes the wall points between 30% and 80% of the room height and aligns them to the
     Manhattan axes;
   - it snaps each side of the room to the strongest wall peak.

   A measurement counts only if the ceiling is 2.2 to 3.2 m high, the room has at least 12 frames,
   and at least 60% of the wall points lie on the box outline.
2. **Fuse** (`v2p/fuse.py`). The layout keeps its arrangement, and every room edge sits on a shared
   grid line. Per axis, a least-squares fit moves the grid lines so each room gets close to its
   target size. Measured sizes weigh 10, estimates 1 and hallways 6 (standard widths); small gaps
   (bay depths, insets) are held and the first line is anchored. Because neighbours share grid
   lines, rooms stay attached. A measurement outside 0.6 to 1.6 times the estimate is rejected.
   Doors, windows and polygons move along by piecewise-linear interpolation.

### Workflow B: geometric reconstruction (needs sharp, textured video)

Keyframes (the sharpest per window), then VGGT-1B in overlapping chunks aligned with Sim(3), or
COLMAP, then a floor plan from the point cloud (Manhattan alignment, Hough walls). Her README says
it fails on these videos: COLMAP registers 14 of 421 frames, and VGGT gives a smeared cloud. VGGT's
weights are non-commercial. `v2p/shape.py` (room outlines from points) is kept for debugging only.

## Inputs and outputs

- **In:** a walkthrough video (Workflow A needs only the video); for C, also the frames at 3 fps
  and the timeline.
- **Out:** `timeline.json`, `layout.json`, `layout.png/.svg`, plus (C) `measurements.json` and
  `layout_fused.json/.png/.svg`.

## Dependencies and keys

- Workflow A: numpy, Pillow, matplotlib and system ffmpeg.
- Workflows B and C: torch, torchvision, huggingface_hub, safetensors and einops. Depth Anything 3
  is cloned into `third_party/` and installed with
  `pip install --no-deps --ignore-requires-python -e`, plus omegaconf, moviepy 1.0.3, trimesh,
  imageio, plyfile, addict and evo. pycolmap is needed for COLMAP; its OpenMP clashes with torch's,
  so the two never load in one process.
- No API keys: the model step was done by hand in a chat.

## Examples (finished results in `examples/`; the videos aren't in the repo)

| Folder | What | Rooms | Measured |
|---|---|---|---|
| `apartment1` | empty triple-decker unit, WhatsApp-compressed 576×1024. **The same video as FitSplit's bundled demo job `mj_e0087b208573`** | 12, incl. 3 bedrooms | bed1, bed2, bed3 (ceiling 2.67 m) |
| `apt2` | a furnished listing, 1080p | 7 | bed1, living, office |
| `apt5` | an empty high-rise 3 bed / 2 bath, 272×480 | 10 | living, kitchen, bed1 |

## Her strengths and ours

- **Hers:** reasoning about the whole apartment at once (from the whole video, one tile per
  second), room outlines with bays and L shapes, exact door and window positions, and the fuse
  step (sizes change while rooms stay attached).
- **Ours (FitSplit):** a fully automated pipeline, amenity tagging with photo evidence, the
  walkthrough, sizing from reference objects in each room with ± ranges, honest labels, and
  integration with 3D, furniture fit and rent split.

What FitSplit took from it, and how the engines compare, is in `docs/DECISIONS.md` (Tanvi layout
section) and the README's "Layout engines" section.
