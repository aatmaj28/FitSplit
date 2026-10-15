"""Paths, environment, provider settings and the tunable pipeline config.

Every kernel size / threshold the geometry code uses lives in DEFAULT_CONFIG.
Per-plan tweaks go in PLAN_CONFIGS (keyed by image stem) and are deep-merged
over the defaults. Pixel values refer to the *processed* image (longest side =
target_long_side); "_ft" values are converted with the current pixels-per-foot
estimate so they carry over between plans drawn at different scales.
"""
from __future__ import annotations

import copy
import os
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
DATA_DIR = ROOT_DIR / "data"
FLOORPLANS_DIR = DATA_DIR / "floorplans"
PARSED_DIR = DATA_DIR / "parsed"
SEMANTICS_CACHE_DIR = PARSED_DIR / "_semantics"
META_PATH = FLOORPLANS_DIR / "meta.json"

load_dotenv(BACKEND_DIR / ".env")

# ----------------------------------------------------------------------------- providers

# vision chain (floor plan labels, AI rent check): Claude first since 2026-10-15, like the text chain;
# VISION_CHAIN_ORDER=gemini,claude,groq restores the original order
VISION_PROVIDERS = ("claude", "gemini", "groq")
PROVIDER_ORDER = [p.strip() for p in os.getenv("VISION_CHAIN_ORDER", "claude,gemini,groq").split(",")
                  if p.strip() in VISION_PROVIDERS] or list(VISION_PROVIDERS)
PROVIDER_TIMEOUT_S = float(os.getenv("PROVIDER_TIMEOUT_S", "30"))

# Groq: only model whose /models entry lists "image" in input_modalities (checked 2026-10-15
# with scripts/groq_models.py). Re-run that script if Groq changes its lineup.
GROQ_DEFAULT_MODEL = "qwen/qwen3.8-27b"
# Spec default was claude-sonnet-5-5; on these plans Sonnet misplaced a closet label and missed the
# JVUE suite bath, while Opus 5.5 (and Fable 5.1, slightly faster but less precise) got both right.
CLAUDE_DEFAULT_MODEL = "claude-opus-5-5"


def provider_settings() -> dict[str, dict[str, Optional[str]]]:
    return {
        "gemini": {
            "api_key": os.getenv("GEMINI_API_KEY") or None,
            "model": os.getenv("GEMINI_MODEL") or "gemini-flash-latest",
            "env_key": "GEMINI_API_KEY",
        },
        "claude": {
            "api_key": os.getenv("ANTHROPIC_API_KEY") or None,
            "model": os.getenv("CLAUDE_MODEL") or CLAUDE_DEFAULT_MODEL,
            "env_key": "ANTHROPIC_API_KEY",
        },
        "groq": {
            "api_key": os.getenv("GROQ_API_KEY") or None,
            "model": os.getenv("GROQ_MODEL") or GROQ_DEFAULT_MODEL,
            "env_key": "GROQ_API_KEY",
        },
    }


# ----------------------------------------------------------------------------- pipeline

DEFAULT_CONFIG: dict[str, Any] = {
    "target_long_side": 1600,
    "wall_style": "auto",  # "solid" | "outline" | "auto"
    "threshold": {
        "method": "otsu",  # "otsu" | "fixed" | "adaptive"
        "offset": 0,  # added to the Otsu level (negative = only darker pixels count as ink)
        "fixed_value": 160,
        "adaptive_block": 51,
        "adaptive_c": 10,
        # "any visible line" (window glass, sliders, railings are often light gray): used for
        # line barriers and window detection, never for walls
        "ink_max_gray": 230,
    },
    # Walls drawn as thick filled strokes: an opening removes everything thinner.
    "solid": {
        "open_kernel_px": 9,
        "min_component_area_px": 150,
        "fill_holes_max_area_px": 400,
    },
    # Walls drawn as two thin parallel lines: drop glyph-sized blobs (text, dotted
    # closet lines), close to fill between the line pairs, then open away leftovers.
    "outline": {
        "glyph_max_side_px": 80,
        "close_kernel_px": 35,  # must exceed the widest white gap between paired lines (~30-34px on Longwood exteriors)
        "fill_holes_max_area_px": 8000,  # outlined columns (~4500px); labeled pockets are never filled
        "open_kernel_px": 15,
        "min_component_area_px": 400,
    },
    # auto: solid wins if its mask explains at least this share of the ink the outline mask
    # explains (solid adds no fill, so it is the cleaner result whenever it is viable).
    # Measured: solid plans 0.99-1.41, Longwood outline plans 0.16-0.42.
    "auto_solid_ink_ratio": 0.7,
    "polygon_epsilon_px": 2.0,
    "wall_polygon_min_area_px": 150,
    # Gap closing for room segmentation only (never written into the 3D walls).
    "gaps": {
        "door_max_ft": 4.0,  # open width up to this is closed (doors ~2.5-3.5 ft + drawing/scale slack)
        "merge_split_max_ft": 7.0,  # if two labels share a region, try closing wider gaps up to this
        "merge_split_step_ft": 0.75,
        "lined_gap_max_ft": 14.0,  # longest ray considered (windows / sliders / window+door runs)
        "line_min_run_ft": 0.75,  # ink running along a ray at least this long counts as a line (glass, track)
        "lined_tolerance_ft": 0.25,  # open width below this = fully lined (window) -> always closed
        "free_end_max_thickness_ft": 1.6,  # thicker than this at a run end = junction, not a wall end
        "run_min_factor": 1.5,  # a wall piece must be this many wall-thicknesses long to cast rays...
        "run_min_ft": 1.0,  # ...and at least this long...
        "end_min_elongation": 2.5,  # ...and this much longer than thick (column faces/bulges are blocky)
    },
    "rooms": {
        "label_snap_max_px": 60,  # max distance to move a label point off a wall
        "label_exterior_snap_px": 150,  # label outside the plan (vision glitch): max move to enclosed space
        "label_text_radius_ft": 1.0,  # a well-placed label point has ink (its text) within this distance
        "min_room_area_sqft": 2.0,
        "max_room_area_frac": 0.6,  # a region bigger than this fraction of the image = leaked
        "barrier_dilate_px": 2,  # thicken thin ink lines when they are used as barriers (seals px gaps)
        "barrier_min_side_px": 80,  # ink blobs smaller than this (text glyphs, dashes) are not barriers
        "min_fragment_sqft": 1.0,  # label points never snap into smaller pockets (fixture/glyph interiors)
        "merge_fragment_max_sqft": 20.0,  # unlabeled pieces up to this join the room across a thin line
        "line_adjacency_steps": 12,  # px; how thick a line can be and still count as "shared" between pieces
        # dotted / dashed lines (Longwood closets, cabinet outlines) become thin barriers too
        "dash_bridge_ft": 0.35,  # max gap between dots/dashes
        "dash_min_len_ft": 1.5,  # shortest dotted line kept
        "dash_max_thick_ft": 0.4,  # thicker bars are bridged text, not lines
        "dash_min_blobs": 3,  # a dotted line is made of at least this many dots/dashes
        "split_downsample": 3,  # watershed split runs on a 1/3-scale crop
    },
    "scale": {
        "initial_long_side_ft": 48.0,  # rough first guess when nothing else is known
        "outlier_tolerance": 0.15,  # drop room estimates further than this from the median
        "max_dims_inconsistency": 0.30,  # |ppf_x - ppf_y| / mean above this = room shape doesn't match dims
        "consistency_weight_floor": 0.03,  # room weight = 1 / (x/y inconsistency + this)
        "max_iterations": 3,
        "converge_tolerance": 0.03,
        "total_sqft_basis": "interior",  # "interior" (net floor area) | "gross" (incl. walls)
    },
    "sanity": {"total_sqft_tolerance": 0.25, "closet_max_sqft": 30},
    "balcony_wall_margin_px": 4,
}

# Per-plan overrides, keyed by image stem. Only put tuned values here.
PLAN_CONFIGS: dict[str, dict[str, Any]] = {}


def deep_merge(base: dict, override: Optional[dict]) -> dict:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def get_config(plan_name: Optional[str] = None, overrides: Optional[dict] = None) -> dict:
    cfg = deep_merge(DEFAULT_CONFIG, PLAN_CONFIGS.get(plan_name or "", {}))
    return deep_merge(cfg, overrides)
