"""Export-only parser extra: wall openings from gap rays (synthetic rays)."""
from __future__ import annotations

from app.geometry import extras


def test_openings_group_rays_and_classify():
    door = [{"kind": "open", "axis": "h", "row": y, "span": [100, 130], "width_px": 30, "open_px": 30} for y in range(50, 56)]
    window = [{"kind": "lined", "axis": "v", "row": x, "span": [10, 60], "width_px": 50, "open_px": 0.5} for x in range(200, 205)]
    noise = [{"kind": "open", "axis": "h", "row": 300, "span": [0, 30], "width_px": 30, "open_px": 30}]  # a single row
    out = extras.openings(door + window + noise, ppf=10.0, door_px=40.0)
    kinds = sorted((o["kind"], o["axis"], o["width_px"]) for o in out)
    assert kinds == [("door", "h", 30.0), ("window", "v", 50.0)]
    d = next(o for o in out if o["kind"] == "door")
    assert d["rect"].tolist() == [[100, 50], [130, 50], [130, 56], [100, 56]]
