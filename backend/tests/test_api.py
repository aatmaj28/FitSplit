"""Baseline API behaviour (Steps 1-3): cached plans are served without any provider calls."""
from __future__ import annotations

from app.config import FLOORPLANS_DIR

DEMO_PLANS = {"jvue_1bed", "jvue_3bed", "longwood_1bed", "longwood_2bed", "missionmain_3bed", "serenity_1bed"}


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert DEMO_PLANS <= set(body["cached_plans"])
    assert "api_key" not in r.text  # never leak key material


def test_plans_list(client):
    plans = client.get("/api/plans").json()
    assert {p["name"] for p in plans} == DEMO_PLANS
    jvue = next(p for p in plans if p["name"] == "jvue_3bed")
    assert jvue["unit"] == {"total_sqft": 1500, "beds": 3, "baths": 2.5, "rent": 4200}


def test_plan_detail(client):
    plan = client.get("/api/plans/jvue_3bed").json()
    beds = [r for r in plan["rooms"] if r["type"] == "bedroom"]
    assert len(beds) == 3
    assert all(r["area_sqft_final"] for r in beds)
    assert sum(1 for r in beds if r["has_private_bath"]) == 1
    assert client.get("/api/plans/nope").status_code == 404


def test_plan_thumbnail(client):
    r = client.get("/api/plans/jvue_3bed/image?max_side=320")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/")


def test_parse_known_plan_is_cached(client):
    data = (FLOORPLANS_DIR / "jvue_3bed.png").read_bytes()
    r = client.post("/api/parse", files={"image": ("jvue_3bed.png", data, "image/png")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cached"] is True
    assert len([x for x in body["rooms"] if x["type"] == "bedroom"]) == 3
