"""Score every layout engine on a media job against a reference layout of the same video.

    .venv/bin/python scripts/compare_layouts.py [job id] [reference folder]

Defaults: the bundled demo job and Tanvi's hand-checked apartment1 (the same video), from
tests/fixtures/tanvi_layout_maker/apartment1. Uses what the job already holds; makes no model calls.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.media import jobs  # noqa: E402
from app.media.layout_tanvi import compare  # noqa: E402

JOB = sys.argv[1] if len(sys.argv) > 1 else "mj_e0087b208573"
REF = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / "tests/fixtures/tanvi_layout_maker/apartment1"


def main() -> dict:
    job = jobs.load(JOB) or json.loads((Path(__file__).resolve().parents[2] / f"frontend/public/demo/media/{JOB}/job.json").read_text())
    ref, ref_edges = compare.rooms_from_tanvi(json.loads((REF / "layout_fused.json").read_text()), json.loads((REF / "timeline.json").read_text()))
    tl = (job.get("tanvi") or {}).get("timeline")
    rows = {}
    if job.get("plans", {}).get("fitsplit") or job.get("plan"):
        rows["fitsplit"] = compare.score(*compare.rooms_from_fitsplit(job, job.get("plans", {}).get("fitsplit") or job["plan"]), ref, ref_edges)
    if job.get("tanvi"):
        rows["tanvi"] = compare.score(*compare.rooms_from_tanvi(job["tanvi"]["layout"], tl), ref, ref_edges)
    if job.get("combined_layout"):
        rows["combined"] = compare.score(*compare.rooms_from_tanvi(job["combined_layout"], tl), ref, ref_edges)
    print(f"| engine | score | rooms (ref {len(ref)}) | bedrooms (ref 3) | connections P / R | measured bedrooms, area error | total sq ft (ref {rows and next(iter(rows.values()))['ref_total_sqft']}) |")
    print("|---|---|---|---|---|---|---|")
    for name, r in rows.items():
        errs = ", ".join(f"{k} {v:+d}%" for k, v in sorted(r["measured_room_error_pct"].items())) or "-"
        print(f"| {name} | **{r['score']}** | {r['rooms']} ({r['matched']} matched) | {r['bedrooms']} | {r['connections']['precision']} / {r['connections']['recall']} | {errs} | {r['total_sqft']} ({r['total_error_pct']:+d}%) |")
    print()
    for name, r in rows.items():
        print(name, r["parts"], "unmatched reference rooms:", r["unmatched_reference_rooms"])
    return rows


if __name__ == "__main__":
    main()
