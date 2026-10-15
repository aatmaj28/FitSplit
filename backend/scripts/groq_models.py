"""List Groq models and flag the ones that accept image input (used to pick GROQ_MODEL).

    python scripts/groq_models.py           # list
    python scripts/groq_models.py --probe   # also send a tiny image to each vision model
"""
from __future__ import annotations

import argparse
import base64
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image  # noqa: E402

from app.config import GROQ_DEFAULT_MODEL, provider_settings  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true", help="send a tiny test image to each vision model")
    args = ap.parse_args()
    key = provider_settings()["groq"]["api_key"]
    if not key:
        print("GROQ_API_KEY is not set (backend/.env)", file=sys.stderr)
        return 1
    from groq import Groq

    client = Groq(api_key=key, max_retries=0, timeout=30)
    models = [m.model_dump() for m in client.models.list().data]
    vision = [m for m in models if "image" in (m.get("input_modalities") or [])]
    for m in sorted(models, key=lambda m: m["id"]):
        tag = "VISION" if m in vision else "      "
        print(f"{tag}  {m['id']:45s} ctx={m.get('context_window')} active={m.get('active')} "
              f"features={m.get('supported_features')}")
    print(f"\ncurrent default GROQ_MODEL: {GROQ_DEFAULT_MODEL}")
    if args.probe:
        buf = io.BytesIO()
        Image.new("RGB", (64, 64), (255, 0, 0)).save(buf, "PNG")
        url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        for m in vision:
            try:
                r = client.chat.completions.create(
                    model=m["id"], max_completion_tokens=20,
                    messages=[{"role": "user", "content": [
                        {"type": "text", "text": "What color is this square? One word."},
                        {"type": "image_url", "image_url": {"url": url}}]}])
                print(f"probe {m['id']}: {r.choices[0].message.content!r}")
            except Exception as e:  # noqa: BLE001
                print(f"probe {m['id']}: FAILED {str(e)[:160]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
