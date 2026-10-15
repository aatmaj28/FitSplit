"""Write the 8 sample student profiles to data/roommates/profiles.json (profiles people created
through the API are kept).   .venv/bin/python scripts/seed_roommates.py"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.roommates import service  # noqa: E402
from app.roommates.seed import PROFILES  # noqa: E402

kept = [p for p in service.load_profiles() if not p.get("sample") and p["id"] not in {s["id"] for s in PROFILES}]
service.DATA.mkdir(parents=True, exist_ok=True)
service.PROFILES.write_text(json.dumps(PROFILES + kept, indent=2, ensure_ascii=False))
print(f"wrote {len(PROFILES)} sample profiles (+{len(kept)} kept) to {service.PROFILES}")
