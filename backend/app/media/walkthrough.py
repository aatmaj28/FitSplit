"""Rooms and the walkthrough.

Grouping: frames are grouped into physical rooms from their walk order and tags, confirmed by one
vision call on numbered contact sheets (room order, which rooms connect, the entrance). Without a
provider the walk order alone is used: each run of same-type frames is a room, and rooms the walker
went between directly are connected.

Walkthrough: each room's longest run of frames is stitched into a panorama (OpenCV Stitcher,
PANORAMA mode). A room whose frames don't stitch (walking causes parallax, few frames) falls back to
its photos. Hotspots to connected rooms sit where the walker left the room: the frame next to the
other room in walk order, located in the panorama by feature matching.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np
from pydantic import BaseModel, Field, field_validator

from . import vision_multi
from .vocab import ROOM_TYPES

SHEET = 24            # frames per contact sheet
STITCH_SIDE = 800     # frames are stitched at this width
MAX_STITCH = 8        # at most this many frames per panorama
NAMES = {"living": "Living room", "kitchen": "Kitchen", "bedroom": "Bedroom", "bathroom": "Bathroom", "dining": "Dining area",
         "hallway": "Hallway", "closet": "Closet", "balcony": "Balcony", "laundry": "Laundry", "entry": "Entry", "other": "Other space"}

PROMPT = """The contact sheets above show numbered photos from one walkthrough of an apartment, in walk
order (Photo 1 was taken first). Tags from an earlier pass, one line per photo:
{lines}

Group the photos into the physical rooms of the apartment.
- A room can appear in several runs (the walker may come back to it). Two rooms of the same type
  are different rooms (Bedroom 1, Bedroom 2) when the photos show different spaces.
- A photo that mostly shows a doorway or the next room goes with the room it looks into.
- Every photo goes in exactly one room.
- type: one of {types}
- connections: pairs of rooms you can walk between directly (a doorway or an open plan), judged
  from the walk order and what the photos show; via_frames: the photos taken while passing from one to
  the other; kind: "door" or "opening".
- entrance: true for the room the walk starts in, if it looks like the way in.

Return JSON only:
{{"rooms": [{{"id": "r1", "type": "living", "name": "Living room", "frames": [1, 2, 3], "entrance": true}}],
"connections": [{{"a": "r1", "b": "r2", "via_frames": [4], "kind": "opening"}}]}}"""


class RoomOut(BaseModel):
    id: str
    type: str = "other"
    name: str = ""
    frames: list[int] = Field(default_factory=list)
    entrance: bool = False

    @field_validator("type", mode="before")
    @classmethod
    def _type(cls, v):
        v = str(v or "").strip().lower().replace("living room", "living").replace("dining room", "dining")
        return v if v in ROOM_TYPES else "other"


class ConnOut(BaseModel):
    a: str
    b: str
    via_frames: list[int] = Field(default_factory=list)
    kind: str = "door"


class GroupOut(BaseModel):
    rooms: list[RoomOut]
    connections: list[ConnOut] = Field(default_factory=list)


# ----------------------------------------------------------------------------- grouping

def runs(seq: list[int], owner: dict[int, str]) -> list[tuple[str, list[int]]]:
    """Consecutive frames with the same owner: [(owner, [frame ids])] in walk order."""
    out: list[tuple[str, list[int]]] = []
    for f in seq:
        if out and out[-1][0] == owner[f]:
            out[-1][1].append(f)
        else:
            out.append((owner[f], [f]))
    return out


def heuristic(tags: list[dict]) -> GroupOut:
    """Walk order only: a run of same-type frames is a room; a one-frame blip between two runs of
    the same type joins them (a glance through a door)."""
    types = [t["room_type"] for t in tags]
    for i in range(1, len(types) - 1):
        if types[i - 1] == types[i + 1] != types[i] and (i < 2 or types[i - 2] != types[i]):
            types[i] = types[i - 1]
    rooms: list[RoomOut] = []
    for t, tag in zip(types, tags):
        if rooms and rooms[-1].type == t:
            rooms[-1].frames.append(tag["frame"])
        else:
            rooms.append(RoomOut(id=f"r{len(rooms) + 1}", type=t, frames=[tag["frame"]]))
    conns = [ConnOut(a=a.id, b=b.id, via_frames=[a.frames[-1], b.frames[0]], kind="door") for a, b in zip(rooms, rooms[1:])]
    return GroupOut(rooms=rooms, connections=conns)


def finalize(out: GroupOut, tags: list[dict]) -> dict:
    """Clean a grouping: every frame in one room, ids r1.. in walk order, unique names, connections
    between known rooms, a connected graph (walk-order transitions fill gaps), an entrance."""
    order = [t["frame"] for t in tags]
    known = set(order)
    owner: dict[int, str] = {}
    for r in out.rooms:
        for f in r.frames:
            if f in known and f not in owner:
                owner[f] = r.id
    by_id = {r.id: r for r in out.rooms}
    # unassigned frames join the room of the nearest assigned frame in walk order
    for i, f in enumerate(order):
        if f in owner:
            continue
        for d in range(1, len(order)):
            near = [order[j] for j in (i - d, i + d) if 0 <= j < len(order) and order[j] in owner]
            if near:
                owner[f] = owner[near[0]]
                break
        else:
            owner[f] = out.rooms[0].id if out.rooms else "r1"
            by_id.setdefault(owner[f], RoomOut(id=owner[f], type=tags[i]["room_type"]))
    first = {}
    for f in order:
        first.setdefault(owner[f], f)
    old_ids = sorted(first, key=lambda r: order.index(first[r]))
    new_id = {old: f"r{i + 1}" for i, old in enumerate(old_ids)}
    rooms = []
    for old in old_ids:
        r = by_id[old]
        frames = [f for f in order if owner[f] == old]
        rooms.append({"id": new_id[old], "type": r.type, "name": (r.name or "").strip()[:40], "frames": frames, "entrance": bool(r.entrance)})
    # names: model's name if it reads as that type, numbered when a type repeats
    count = defaultdict(int)
    for r in rooms:
        count[r["type"]] += 1
    seen = defaultdict(int)
    for r in rooms:
        seen[r["type"]] += 1
        base = NAMES.get(r["type"], "Room")
        r["name"] = f"{base} {seen[r['type']]}" if count[r["type"]] > 1 and r["type"] in ("bedroom", "bathroom", "closet", "hallway", "other") else base
    # connections
    pairs: dict[tuple[str, str], dict] = {}
    for c in out.connections:
        a, b = new_id.get(c.a), new_id.get(c.b)
        if a and b and a != b:
            key = tuple(sorted((a, b)))
            pairs.setdefault(key, {"a": key[0], "b": key[1], "via": [f for f in c.via_frames if f in known][:4],
                                   "kind": c.kind if c.kind in ("door", "opening") else "door", "source": "model"})
    owner_new = {f: new_id[owner[f]] for f in order}
    transitions = [(owner_new[x], owner_new[y], x, y) for x, y in zip(order, order[1:]) if owner_new[x] != owner_new[y]]
    parent = {r["id"]: r["id"] for r in rooms}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in pairs:
        parent[find(a)] = find(b)
    for a, b, x, y in transitions:  # walking straight from a to b means they connect
        if find(a) != find(b):
            key = tuple(sorted((a, b)))
            pairs[key] = {"a": key[0], "b": key[1], "via": [x, y], "kind": "door", "source": "walk order"}
            parent[find(a)] = find(b)
    ids = [r["id"] for r in rooms]
    for a, b in zip(ids, ids[1:]):  # still apart (never walked between): chain in walk order
        if find(a) != find(b):
            pairs[(a, b)] = {"a": a, "b": b, "via": [], "kind": "door", "source": "assumed"}
            parent[find(a)] = find(b)
    entrance = next((r["id"] for r in rooms if r["entrance"]), rooms[0]["id"] if rooms else None)
    for r in rooms:
        r["entrance"] = r["id"] == entrance
    return {"rooms": rooms, "connections": list(pairs.values()), "entrance": entrance}


def parse_group(text: str) -> GroupOut:
    data = json.loads(text[text.find("{"): text.rfind("}") + 1])
    out = GroupOut.model_validate(data)
    if not out.rooms:
        raise ValueError("no rooms")
    return out


def group_rooms(job: dict, d: Path, progress: Callable[[float, str], None]) -> str:
    tags = job["tags"]
    if not tags:
        job["rooms"], job["connections"], job["entrance"] = [], [], None
        return "no tagged photos"
    source = "walk order"
    out = heuristic(tags)
    if len(tags) >= 2:
        progress(0.2, "checking which photos show the same room")
        images = []
        frames = {f["id"]: f for f in job["frames"]}
        for i in range(0, len(tags), SHEET):
            chunk = tags[i:i + SHEET]
            tiles = [(f"Photo {t['frame']}", vision_multi.jpeg(d / frames[t["frame"]]["file"], side=420, quality=78)) for t in chunk]
            images.append((f"Contact sheet {i // SHEET + 1}: photos {chunk[0]['frame']}-{chunk[-1]['frame']}",
                           vision_multi.contact_sheet(tiles, cols=6, cell=300)))
        lines = "\n".join(f"{t['frame']}: {t['room_type']}; {t['caption'] or '-'}; floor {t['flooring']}; walls {t['wall_color'] or '?'}" for t in tags)
        prompt = PROMPT.format(lines=lines, types=", ".join(ROOM_TYPES))
        try:
            out, provider = vision_multi.vision_multi_json(images, prompt, parse_group, kind="rooms", max_tokens=4000)
            source = provider
        except RuntimeError as e:
            print(f"[media] room grouping fell back to walk order: {e}")
    g = finalize(out, tags)
    job["rooms"], job["connections"], job["entrance"] = g["rooms"], g["connections"], g["entrance"]
    job["rooms_source"] = source
    kinds = defaultdict(int)
    for r in g["rooms"]:
        kinds[r["type"]] += 1
    return f"{len(g['rooms'])} rooms ({', '.join(f'{n} {k}' for k, n in kinds.items())}) via {source}"


# ----------------------------------------------------------------------------- panoramas

def _read(path: Path, side: int = STITCH_SIDE) -> np.ndarray:
    img = cv2.imread(str(path))
    h, w = img.shape[:2]
    s = side / max(w, h)
    return cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else img


def crop_valid(pano: np.ndarray) -> np.ndarray:
    """Largest axis-aligned rectangle without the black border the stitcher leaves (greedy shrink)."""
    mask = cv2.cvtColor(pano, cv2.COLOR_BGR2GRAY) > 0
    mask = cv2.erode(mask.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    ys, xs = np.where(mask)
    if not len(xs):
        return pano
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    for _ in range(4000):
        sub = mask[y0:y1, x0:x1]
        if sub.all() or x1 - x0 < 20 or y1 - y0 < 20:
            break
        bad = {"top": (~sub[0]).sum() / sub.shape[1], "bottom": (~sub[-1]).sum() / sub.shape[1],
               "left": (~sub[:, 0]).sum() / sub.shape[0], "right": (~sub[:, -1]).sum() / sub.shape[0]}
        side = max(bad, key=bad.get)
        if side == "top":
            y0 += 1
        elif side == "bottom":
            y1 -= 1
        elif side == "left":
            x0 += 1
        else:
            x1 -= 1
    return pano[y0:y1, x0:x1]


def stitch(imgs: list[np.ndarray]) -> Optional[np.ndarray]:
    """A panorama wider than one frame, or None."""
    if len(imgs) < 2:
        return None
    st = cv2.Stitcher_create(cv2.Stitcher_PANORAMA)
    try:
        st.setPanoConfidenceThresh(0.8)
    except AttributeError:
        pass
    try:
        status, pano = st.stitch(imgs)
    except cv2.error:
        return None
    if status != cv2.Stitcher_OK or pano is None:
        return None
    pano = crop_valid(pano)
    h, w = pano.shape[:2]
    fh, fw = imgs[0].shape[:2]
    if w < 1.2 * fw or h < 0.55 * fh or w / max(h, 1) > 7:
        return None  # barely wider than a frame, squashed, or a runaway warp
    return pano


def locate(frame: np.ndarray, pano: np.ndarray) -> Optional[float]:
    """Where (0-1 across the panorama) the frame's center lands, by ORB matches + homography."""
    orb = cv2.ORB_create(1500)
    g1, g2 = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.cvtColor(pano, cv2.COLOR_BGR2GRAY)
    k1, d1 = orb.detectAndCompute(g1, None)
    k2, d2 = orb.detectAndCompute(g2, None)
    if d1 is None or d2 is None or len(k1) < 12 or len(k2) < 12:
        return None
    good = []
    for pair in cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(d1, d2, k=2):
        if len(pair) == 2 and pair[0].distance < 0.75 * pair[1].distance:
            good.append(pair[0])
    if len(good) < 12:
        return None
    src = np.float32([k1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([k2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, inl = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
    if H is None or inl is None or inl.sum() < 10:
        return None
    h, w = frame.shape[:2]
    c = H @ np.array([w / 2, h / 2, 1.0])
    x = c[0] / c[2] / pano.shape[1]
    return float(x) if -0.1 <= x <= 1.1 else None


def spread(xs: list[float], gap: float = 0.12, lo: float = 0.04, hi: float = 0.96) -> list[float]:
    """Push hotspots apart so two doors never sit on top of each other (keeps their order; only
    the crowded ones move)."""
    if not xs:
        return xs
    idx = sorted(range(len(xs)), key=lambda i: xs[i])
    out = [min(hi, max(lo, xs[i])) for i in idx]
    for i in range(1, len(out)):  # push right
        out[i] = max(out[i], out[i - 1] + gap)
    out[-1] = min(out[-1], hi)
    for i in range(len(out) - 2, -1, -1):  # then back from the right edge
        out[i] = min(out[i], out[i + 1] - gap)
    if out[0] < lo:  # too many to fit with the full gap: share the width evenly
        out = [lo + k * (hi - lo) / max(1, len(out) - 1) for k in range(len(out))]
    res = [0.0] * len(xs)
    for k, i in enumerate(idx):
        res[i] = round(out[k], 3)
    return res


def _exit_frames(room: dict, other: dict, order: list[int]) -> tuple[int, int]:
    """(frame of `room`, frame of `other`) closest together in walk order: where you cross over."""
    pos = {f: i for i, f in enumerate(order)}
    return min(((a, b) for a in room["frames"] for b in other["frames"]), key=lambda ab: abs(pos[ab[0]] - pos[ab[1]]))


def build_walkthrough(job: dict, d: Path, progress: Callable[[float, str], None]) -> str:
    rooms = job.get("rooms") or []
    if not rooms:
        return "no rooms to stitch"
    frames = {f["id"]: f for f in job["frames"]}
    order = [f["id"] for f in job["frames"]]
    (d / "pano").mkdir(exist_ok=True)
    out_rooms, stitched = [], 0
    for i, r in enumerate(rooms):
        progress(i / len(rooms), f"{r['name']}: stitching {len(r['frames'])} photos")
        run = max(runs(order, {f: ("in" if f in r["frames"] else "out") for f in order}), key=lambda x: (x[0] == "in", len(x[1])))[1]
        run = [f for f in run if f in r["frames"]]
        imgs = {f: _read(d / frames[f]["file"]) for f in run}
        pano, used = None, []
        tries = [run[:MAX_STITCH]] + ([run[-MAX_STITCH:]] if len(run) > MAX_STITCH else []) + ([run[:4]] if len(run) > 4 else [])
        for attempt in tries:
            pano = stitch([imgs[f] for f in attempt])
            if pano is not None:
                used = attempt
                break
        entry = {"id": r["id"], "name": r["name"], "type": r["type"], "frames": r["frames"],
                 "photos": [frames[f]["file"] for f in r["frames"]], "pano": None, "pano_size": None, "pano_frames": [], "hotspots": []}
        if pano is not None:
            h, w = pano.shape[:2]
            if w > 4096:
                pano = cv2.resize(pano, (4096, round(h * 4096 / w)), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(d / "pano" / f"{r['id']}.jpg"), pano, [cv2.IMWRITE_JPEG_QUALITY, 84])
            entry.update(pano=f"pano/{r['id']}.jpg", pano_size=[pano.shape[1], pano.shape[0]], pano_frames=used)
            stitched += 1
        out_rooms.append((entry, pano))
    by_id = {e["id"]: (e, p) for e, p in out_rooms}
    for c in job.get("connections", []):
        for here, there in ((c["a"], c["b"]), (c["b"], c["a"])):
            e, pano = by_id[here]
            other = by_id[there][0]
            mine, theirs = _exit_frames(e, other, order)
            x = None
            if pano is not None:
                x = locate(_read(d / frames[mine]["file"]), pano)
                if x is None and mine in e["pano_frames"]:
                    x = (e["pano_frames"].index(mine) + 0.5) / len(e["pano_frames"])
            e["hotspots"].append({"to": there, "name": other["name"], "frame": mine, "x": None if x is None else round(min(0.97, max(0.03, x)), 3),
                                  "photo": e["frames"].index(mine)})
    for e, _ in out_rooms:
        placed = [h for h in e["hotspots"] if h["x"] is not None]
        for h, x in zip(placed, spread([h["x"] for h in placed])):
            h["x"] = x
    job["walkthrough"] = {"rooms": [e for e, _ in out_rooms], "entrance": job.get("entrance"), "connections": job.get("connections", [])}
    (d / "walk").mkdir(exist_ok=True)
    (d / "walk" / "walkthrough.json").write_text(json.dumps(job["walkthrough"], indent=1))
    return f"{stitched} of {len(rooms)} rooms stitched into panoramas, {len(rooms) - stitched} shown as photos"
