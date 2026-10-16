"""Timestamped contact sheets of a video, for a human/VLM to read the layout from.

Ported from Tanvi Deshpande's layout maker, github.com/Tanvi-15/Layout-maker (v2p/sheets.py): one
tile per second, 200 px wide, 10 x 4 tiles per sheet, each stamped with its time. Changes for
FitSplit: the sheets stay in memory (JPEG bytes) for the API step, ffmpeg is the bundled
imageio-ffmpeg binary, and the time stamp uses a larger font so it survives the API's downscaling
(a 2000 px sheet is read at about 1568 px). Photo uploads get the same sheets, stamped "#N".
"""
from __future__ import annotations

import io
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from ..frames import ffmpeg_exe, load_photo

SEND_SIDE = 1568  # what the vision API reads anyway; sending more only costs bytes


def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # older Pillow
        return ImageFont.load_default()


def _tiles_from_video(video: Path, tmp: Path, every_s: float, tile_w: int) -> list[tuple[str, Path]]:
    subprocess.run([ffmpeg_exe(), "-loglevel", "error", "-i", str(video),
                    "-vf", f"fps=1/{every_s},scale={tile_w}:-2", "-q:v", "3",
                    str(tmp / "f_%05d.jpg")], check=True)
    return [(f"{k * every_s:.0f}s", p) for k, p in enumerate(sorted(tmp.glob("f_*.jpg")))]


def make_sheets(video: Path | None = None, photos: list[Path] | None = None, every_s: float = 1.0,
                cols: int = 10, rows: int = 4, tile_w: int = 200) -> list[dict]:
    """[{"label": "Sheet 1: 0s-39s", "jpeg": bytes, "first": "0s", "last": "39s"}] in video order."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        if video is not None:
            tiles = _tiles_from_video(video, tmp, every_s, tile_w)
        else:
            tiles = []
            for k, p in enumerate(photos or [], 1):
                im = load_photo(p, side=tile_w * 4)
                im = im.resize((tile_w, round(im.height * tile_w / im.width)))
                out = tmp / f"p_{k:05d}.jpg"
                im.save(out, quality=88)
                tiles.append((f"#{k}", out))
        if not tiles:
            return []
        tw, th = Image.open(tiles[0][1]).size
        font = _font(16)
        per = cols * rows
        sheets = []
        for s in range(0, len(tiles), per):
            batch = tiles[s:s + per]
            sheet = Image.new("RGB", (tw * cols, th * ((len(batch) + cols - 1) // cols)), "white")
            draw = ImageDraw.Draw(sheet)
            for k, (stamp, p) in enumerate(batch):
                x, y = (k % cols) * tw, (k // cols) * th
                with Image.open(p) as im:
                    sheet.paste(im.convert("RGB").resize((tw, th)), (x, y))
                draw.rectangle([x, y, x + 58, y + 24], fill="black")
                draw.text((x + 5, y + 3), stamp, fill="yellow", font=font)
            if sheet.width > SEND_SIDE:
                sheet = sheet.resize((SEND_SIDE, round(sheet.height * SEND_SIDE / sheet.width)), Image.LANCZOS)
            buf = io.BytesIO()
            sheet.save(buf, "JPEG", quality=82)
            first, last = batch[0][0], batch[-1][0]
            sheets.append({"label": f"Sheet {len(sheets) + 1}: {first}-{last}", "jpeg": buf.getvalue(), "first": first, "last": last})
        return sheets
