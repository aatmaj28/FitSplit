"""Tanvi's layout maker, ported into FitSplit.

Original: Tanvi Deshpande, github.com/Tanvi-15/Layout-maker (video2floorplan). Her Workflow A reads
timestamped contact sheets of a walkthrough video and writes the whole apartment as a schematic
layout (rooms as rectangles or polygons in metres, doors and windows as wall segments). Her
Workflow C measures rooms with Depth Anything 3 and fuses the sizes in by least squares on shared
grid lines.

  schema.py       her layout format, JSON schema and validation (v2p/layout.py)
  sheets.py       her contact sheets: one tile per second, time-stamped (v2p/sheets.py)
  automate.py     Workflow A as an API step (her repo did it by hand in a chat)
  fuse.py         her fuse step (v2p/fuse.py), plus weights for FitSplit's size estimates
  measure_da3.py  her Depth Anything 3 measurement (v2p/measure.py), optional, off by default
  adapter.py      her layout -> FitSplit's parsed plan JSON (3D, furniture fit, rent split)
  combine.py      the combined engine: her layout + FitSplit's per-room sizes, fused
  compare.py      scores a layout against a reference layout (room count, types, connections, sizes)
"""
