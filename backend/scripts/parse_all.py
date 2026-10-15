"""Parse every floor plan in /data/floorplans and print a summary table.

    python scripts/parse_all.py                       # cached results when available
    python scripts/parse_all.py --no-cache            # re-run everything (fresh vision calls)
    python scripts/parse_all.py --provider claude --no-cache --only jvue_3bed
    python scripts/parse_all.py --reuse-semantics     # re-run OpenCV only (config tuning, no API calls)
"""
from __future__ import annotations

import argparse
import sys
import textwrap
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import FLOORPLANS_DIR, PARSED_DIR  # noqa: E402
from app.pipeline import parse_floorplan  # noqa: E402
from app.semantics import SemanticsError  # noqa: E402

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def _fmt(v, nd=1, suffix=""):
    return "-" if v is None else f"{v:.{nd}f}{suffix}"


def summary_rows(results: list[tuple[str, dict]]) -> list[list[str]]:
    rows = []
    for name, r in results:
        if "error" in r:
            rows.append([name, "ERROR", "-", "-", "-", "-", "-", "-", r["error"][:60]])
            continue
        rooms = r["rooms"]
        found = sum(1 for x in rooms if x["area_sqft"] is not None)
        ch = r["checks"]
        sum_vs = "-" if ch["rooms_vs_total_pct"] is None else \
            f"{ch['rooms_sum_sqft']:.0f}/{ch['total_sqft']:g} ({ch['rooms_vs_total_pct']:+.0f}%)"
        errs = ", ".join(f"{x['name'].split()[0][:10]} {x['area_vs_printed_pct']:+.0f}%"
                         for x in rooms if x["area_vs_printed_pct"] is not None) or "-"
        rows.append([
            name,
            r["semantics_provider"] + (" (cache)" if r.get("cached") else ""),
            str(len(r["walls"])),
            f"{found}/{len(rooms)}",
            r["scale"]["method"] or "-",
            _fmt(r["scale"]["pixels_per_foot"], 2),
            errs,
            sum_vs,
            str(len(r["warnings"])),
        ])
    return rows


def print_table(headers: list[str], rows: list[list[str]]) -> None:
    widths = [max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)] if rows else \
        [len(h) for h in headers]
    line = "  ".join(h.ljust(w) for h, w in zip(headers, widths))
    print(line)
    print("  ".join("-" * w for w in widths))
    for r in rows:
        print("  ".join(c.ljust(w) for c, w in zip(r, widths)))


def print_details(name: str, r: dict) -> None:
    print(f"\n== {name}  [{r['semantics_provider']} / {r.get('semantics_model')}]  "
          f"walls={r['processing']['wall_style']['used']}  "
          f"ppf={_fmt(r['scale']['pixels_per_foot'], 2)} ({r['scale']['method']})")
    rows = []
    for x in r["rooms"]:
        pd = x["printed_dims_ft"]
        rows.append([
            x["id"], x["name"][:24], x["type"],
            _fmt(x["area_sqft"]),
            f"{pd['w']:g}x{pd['l']:g}={x['printed_area_sqft']:.0f}" if pd else "-",
            "-" if x["area_vs_printed_pct"] is None else f"{x['area_vs_printed_pct']:+.1f}%",
            "" if x["has_private_bath"] is None else ("yes" if x["has_private_bath"] else "no"),
            x["segmentation"],
        ])
    print_table(["id", "room", "type", "sqft", "printed", "err", "priv.bath", "seg"], rows)
    if r["warnings"]:
        print("warnings:")
        for wmsg in r["warnings"]:
            print(textwrap.fill(wmsg, width=110, initial_indent="  - ", subsequent_indent="    "))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--provider", choices=["gemini", "claude", "groq"], help="force one vision provider")
    ap.add_argument("--no-cache", action="store_true", help="ignore cached results and vision answers")
    ap.add_argument("--reuse-semantics", action="store_true",
                    help="re-run the geometry but reuse cached vision answers (no API calls if cached)")
    ap.add_argument("--only", action="append", help="plan name (file stem); repeatable or comma-separated")
    ap.add_argument("--wall-style", choices=["solid", "outline", "auto"])
    ap.add_argument("--pixels-per-foot", type=float, help="manual scale (original px); fallback 2")
    ap.add_argument("--quiet", action="store_true", help="summary table only")
    args = ap.parse_args()

    only = {o.strip() for opt in (args.only or []) for o in opt.split(",") if o.strip()}
    images = sorted(p for p in FLOORPLANS_DIR.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if only:
        images = [p for p in images if p.stem in only or p.name in only]
        missing = only - {p.stem for p in images} - {p.name for p in images}
        if missing:
            print(f"no such plan(s): {', '.join(sorted(missing))}", file=sys.stderr)
    if not images:
        print("nothing to do", file=sys.stderr)
        return 1

    results = []
    for p in images:
        t0 = time.monotonic()
        try:
            r = parse_floorplan(p.read_bytes(), p.name, wall_style=args.wall_style,
                                pixels_per_foot=args.pixels_per_foot, provider=args.provider,
                                no_cache=args.no_cache, reuse_semantics=args.reuse_semantics)
        except SemanticsError as e:
            r = {"error": f"{e} | " + " | ".join(e.warnings)}
        print(f"[{time.monotonic() - t0:5.1f}s] {p.name}", file=sys.stderr)
        results.append((r.get("plan_name", p.stem), r))

    print()
    print_table(["plan", "provider", "walls", "rooms", "scale", "px/ft", "area vs printed dims",
                 "rooms vs total_sqft", "warn"], summary_rows(results))
    if not args.quiet:
        for name, r in results:
            if "error" not in r:
                print_details(name, r)
    print(f"\noutputs: {PARSED_DIR}")
    return 0 if all("error" not in r for _, r in results) else 2


if __name__ == "__main__":
    raise SystemExit(main())
