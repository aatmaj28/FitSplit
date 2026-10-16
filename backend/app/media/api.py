"""Media job API.

    POST /api/media/jobs                 multipart: files (one video OR several photos), listing_id?,
                                         existing_amenities? (comma-separated ids) -> the job
    GET  /api/media/jobs/{id}            status, current step, progress, results when done
    GET  /api/media/jobs/{id}/files/...  frames/, pano/, plan/ files of a job
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from . import frames as frames_mod
from . import jobs

router = APIRouter(prefix="/api/media")
_SAFE = re.compile(r"^(frames|pano|plan|walk)/[A-Za-z0-9_\-]+\.(jpg|png|svg|json)$")


@router.post("/jobs")
async def create_job(files: list[UploadFile] = File(...), listing_id: Optional[str] = Form(None),
                     existing_amenities: Optional[str] = Form(None)) -> dict:
    kinds = [frames_mod.kind_of(f.filename or "") for f in files]
    if None in kinds:
        bad = [f.filename for f, k in zip(files, kinds) if k is None]
        raise HTTPException(415, f"unsupported file type: {', '.join(bad[:3])} (videos: .mov .mp4 .m4v; photos: .jpg .png .heic .webp)")
    if "video" in kinds and len(files) > 1:
        raise HTTPException(422, "upload one video, or several photos")
    incoming = jobs.MEDIA_DIR / "_incoming" / uuid.uuid4().hex
    incoming.mkdir(parents=True, exist_ok=True)
    total, paths = 0, []
    try:
        for i, f in enumerate(files):
            name = re.sub(r"[^A-Za-z0-9_.\-]+", "_", Path(f.filename or f"file{i}").name) or f"file{i}"
            dest = incoming / (name if name not in {p.name for p in paths} else f"{i}_{name}")
            with open(dest, "wb") as out:
                while chunk := await f.read(1 << 20):
                    total += len(chunk)
                    if total > jobs.MAX_UPLOAD_BYTES:
                        raise HTTPException(413, f"upload larger than {jobs.MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
                    out.write(chunk)
            paths.append(dest)
        existing = [a.strip() for a in (existing_amenities or "").split(",") if a.strip()]
        # hashing a large video takes a moment: keep it off the event loop
        return jobs.summary(await run_in_threadpool(jobs.create, paths, listing_id=listing_id, existing=existing))
    finally:
        for p in incoming.glob("*"):
            p.unlink(missing_ok=True)
        incoming.rmdir()


@router.get("/jobs/{jid}")
def get_job(jid: str) -> dict:
    job = jobs.load(jid) if re.fullmatch(r"mj_[0-9a-f]{12}", jid) else None
    if job is None:
        raise HTTPException(404, f"no media job {jid!r}")
    return jobs.summary(job)


@router.get("/jobs/{jid}/files/{path:path}")
def job_file(jid: str, path: str) -> FileResponse:
    if not re.fullmatch(r"mj_[0-9a-f]{12}", jid) or not _SAFE.fullmatch(path):
        raise HTTPException(404, "not found")
    f = jobs.job_dir(jid) / path
    if not f.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(f, headers={"Cache-Control": "public, max-age=86400"})
