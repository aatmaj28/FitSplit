"""Roommate finder API (mounted under /api/roommates in app/main.py).

    GET  /questionnaire                 the 7-section questionnaire (schema + section labels)
    GET  /profiles                      student profiles
    PUT  /profiles/{id}                 create / update a profile (validated)
    POST /negotiations                  {a, b, room?} start or fetch a negotiation (cached by inputs)
    GET  /negotiations/{id}             the record so far (events, messages, verdict, analysis)
    GET  /negotiations/{id}/stream      Server-Sent Events: checks, phase_start, agent_message, analyzing, complete
    POST /fill-room                     {candidate, members, room, rule} candidate vs each current roommate
    POST /fill-room/status              {ids, rule} group verdict once all negotiations finished
    POST /groups                        {profile_ids, size} best groups from finished pairwise negotiations
"""
from __future__ import annotations

import asyncio
import json
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import service
from .checks import RoomContext
from .questionnaire import get_all_questions, get_section_labels

router = APIRouter(prefix="/api/roommates", tags=["roommates"])


class StartBody(BaseModel):
    a: str
    b: str
    room: Optional[RoomContext] = None


class FillBody(BaseModel):
    candidate: str
    members: list[str] = Field(min_length=1, max_length=6)
    room: RoomContext
    rule: Literal["all", "majority"] = "all"


class FillStatusBody(BaseModel):
    ids: list[str] = Field(min_length=1)
    rule: Literal["all", "majority"] = "all"


class GroupsBody(BaseModel):
    profile_ids: list[str] = Field(min_length=2)
    size: int = Field(ge=2, le=4)


def _summary(rec: dict) -> dict:
    return {k: rec.get(k) for k in ("id", "mode", "a", "b", "room", "status", "checks", "result", "analysis", "providers", "created", "error")} | {
        "messages": rec.get("messages") or [m["data"] for m in rec.get("events", []) if m["type"] == "agent_message"]}


@router.get("/questionnaire")
def questionnaire() -> dict:
    return {"sections": get_section_labels(), "questions": get_all_questions()}


@router.get("/profiles")
def profiles() -> list[dict]:
    return service.load_profiles()


@router.put("/profiles/{pid}")
def put_profile(pid: str, profile: dict) -> dict:
    if not isinstance(profile.get("name"), str) or not profile["name"].strip():
        raise HTTPException(422, "name is required")
    try:
        return service.save_profile({**profile, "id": pid})
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@router.post("/negotiations")
def start(body: StartBody) -> dict:
    try:
        return _summary(service.start(body.a, body.b, body.room))
    except service.NotFound as e:
        raise HTTPException(404, str(e)) from e


@router.get("/negotiations/{nid}")
def get(nid: str) -> dict:
    rec = service.load_negotiation(nid)
    if rec is None:
        raise HTTPException(404, f"no negotiation {nid!r}")
    return _summary(rec)


def _sse(event: dict) -> str:
    return f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"


@router.get("/negotiations/{nid}/stream")
async def stream(nid: str, request: Request) -> StreamingResponse:
    if service.load_negotiation(nid) is None:
        raise HTTPException(404, f"no negotiation {nid!r}")

    async def events():
        sent = 0
        while True:
            rec = service.load_negotiation(nid)
            evs = rec["events"] if rec else []
            while sent < len(evs):
                yield _sse(evs[sent])
                sent += 1
            if not rec or rec["status"] in ("complete", "error") or await request.is_disconnected():
                return
            await asyncio.sleep(0.25)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/fill-room")
def fill_room(body: FillBody) -> dict:
    try:
        return service.fill_room(body.candidate, body.members, body.room, body.rule)
    except service.NotFound as e:
        raise HTTPException(404, str(e)) from e


@router.post("/fill-room/status")
def fill_room_status(body: FillStatusBody) -> dict:
    recs = [service.load_negotiation(i) for i in body.ids]
    if any(r is None for r in recs):
        raise HTTPException(404, "unknown negotiation id")
    return service.fill_room_status(recs, body.rule)


@router.post("/groups")
def groups(body: GroupsBody) -> list[dict]:
    return service.best_groups(body.profile_ids, body.size)
