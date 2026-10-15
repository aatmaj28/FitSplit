"""FastAPI app.

    POST /api/parse                  parse an uploaded plan (cached by image hash)
    GET  /api/health                 status + which provider keys are configured
    GET  /api/plans                  cached plans (name, unit info, thumbnail url)
    GET  /api/plans/{name}           parsed JSON
    GET  /api/plans/{name}/image     original image (?max_side=320 for a thumbnail)
    POST /api/rent-check             AI check of a rent split's inputs (?cache_only=1: never call a model)
    GET  /api/llm/usage              API calls per provider tonight + the Claude cap
    /api/roommates/...               roommate finder (app/roommates/api.py)

    uvicorn app.main:app --reload --port 8000      (from /backend)
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image

from . import cache, rentcheck
from .llm.text import TEXT_CHAIN_ORDER
from .config import FLOORPLANS_DIR, PARSED_DIR, PROVIDER_ORDER, PROVIDER_TIMEOUT_S, provider_settings
from .llm import usage as llm_usage
from .llm.vision import VisionError
from .roommates.api import router as roommates_router
from .pipeline import PIPELINE_VERSION, parse_floorplan
from .semantics import SemanticsError

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
WALL_STYLES = ("solid", "outline", "auto")
_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")
_DEFAULT_KEY = cache.cache_key(None, None, None)

app = FastAPI(title="Floor plan parser", version=PIPELINE_VERSION)
# the frontend (next step) will call this from another origin during the hackathon
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(roommates_router)


@app.get("/api/health")
def health() -> dict:
    settings = provider_settings()
    return {
        "status": "ok",
        "pipeline_version": PIPELINE_VERSION,
        "provider_order": PROVIDER_ORDER,  # = vision_chain_order (kept for older clients)
        "vision_chain_order": PROVIDER_ORDER,
        "text_chain_order": TEXT_CHAIN_ORDER,
        "provider_timeout_s": PROVIDER_TIMEOUT_S,
        "providers": {name: {"configured": bool(s["api_key"]), "model": s["model"]}
                      for name, s in settings.items()},
        "cached_plans": cache.cached_plans(),
    }


@app.post("/api/parse")
async def parse(
    image: UploadFile = File(..., description="floor plan image (png/jpg/webp)"),
    wall_style: Optional[str] = Form(None, description="solid | outline | auto (default auto)"),
    pixels_per_foot: Optional[float] = Form(None, description="manual scale in original-image px; "
                                                              "used only if printed dims and total_sqft can't give one"),
    provider: Optional[str] = Form(None, description="force gemini | claude | groq (no fallback)"),
    no_cache: bool = Form(False, description="ignore cached results and vision answers"),
) -> dict:
    if wall_style and wall_style not in WALL_STYLES:
        raise HTTPException(422, f"wall_style must be one of {WALL_STYLES}")
    if provider and provider not in PROVIDER_ORDER:
        raise HTTPException(422, f"provider must be one of {PROVIDER_ORDER}")
    if pixels_per_foot is not None and pixels_per_foot <= 0:
        raise HTTPException(422, "pixels_per_foot must be > 0")
    data = await image.read()
    if not data:
        raise HTTPException(400, "empty upload")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"image larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    try:
        return await run_in_threadpool(parse_floorplan, data, image.filename, wall_style=wall_style,
                                       pixels_per_foot=pixels_per_foot, provider=provider, no_cache=no_cache)
    except SemanticsError as e:
        raise HTTPException(502, {"error": str(e), "warnings": e.warnings, "attempts": e.attempts}) from e
    except ValueError as e:  # undecodable image, bad params
        raise HTTPException(400, str(e)) from e


def _load_plan(name: str) -> dict:
    path = PARSED_DIR / f"{name}.json"
    if not _NAME_RE.fullmatch(name) or not path.is_file():
        raise HTTPException(404, f"no parsed plan named {name!r}")
    return json.loads(path.read_text())


@app.get("/api/plans")
def list_plans(include_variants: bool = Query(False, description="also list provider / wall-style variants")
               ) -> list[dict]:
    plans = []
    for path in sorted(PARSED_DIR.glob("*.json")):
        try:
            d = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        variant = d.get("cache_key") != _DEFAULT_KEY
        if variant and not include_variants:
            continue
        name = path.stem
        plans.append({
            "name": name,
            "source_image": d.get("source_image"),
            "unit": d.get("unit"),
            "rooms": len(d.get("rooms", [])),
            "semantics_provider": d.get("semantics_provider"),
            "variant": variant,
            "url": f"/api/plans/{name}",
            "image_url": f"/api/plans/{name}/image",
            "thumbnail_url": f"/api/plans/{name}/image?max_side=320",
        })
    return plans


@app.get("/api/plans/{name}")
def get_plan(name: str) -> dict:
    return _load_plan(name)


@app.get("/api/plans/{name}/image")
def get_plan_image(name: str, max_side: Optional[int] = Query(None, ge=32, le=4096)) -> FileResponse:
    plan = _load_plan(name)
    path = cache.original_image_path(name)
    if path is None:  # parsed before originals were kept next to the JSON
        fallback = FLOORPLANS_DIR / Path(plan.get("source_image") or "").name
        path = fallback if fallback.is_file() else None
    if path is None:
        raise HTTPException(404, f"original image for {name!r} not found")
    if not max_side:
        return FileResponse(path)
    thumb = PARSED_DIR / name / f"thumb_{max_side}.png"
    if not thumb.exists() or thumb.stat().st_mtime < path.stat().st_mtime:
        thumb.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(path) as im:
            im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
            im.thumbnail((max_side, max_side))
            im.save(thumb, "PNG", optimize=True)
    return FileResponse(thumb, media_type="image/png")


@app.post("/api/rent-check")
def rent_check(req: rentcheck.RentCheckRequest,
               cache_only: bool = Query(False, description="answer from the cache only; 404 if this input was never checked")
               ) -> dict:
    try:
        result, hit = rentcheck.check(req, cache_only=cache_only)
    except rentcheck.NotCached as e:
        raise HTTPException(404, f"no cached check for input key {e}") from e
    except rentcheck.PlanNotFound as e:
        raise HTTPException(404, f"no parsed plan named {str(e)!r}") from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except VisionError as e:
        raise HTTPException(503, {"error": "AI check unavailable right now", "attempts": e.attempts}) from e
    return {**result.model_dump(), "cached": hit}


@app.get("/api/llm/usage")
def llm_usage_totals() -> dict:
    return llm_usage.totals()
