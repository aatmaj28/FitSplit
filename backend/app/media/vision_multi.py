"""Several images in one vision request, cached by the images' hashes.

Claude and Gemini take the images as separate parts, each labelled "Photo N". Groq takes one
image per request, so it gets them tiled into a numbered contact sheet. The order is the vision
chain (VISION_CHAIN_ORDER, Claude first). Every request goes through usage.track, so the Claude cap
applies."""
from __future__ import annotations

import base64
import contextvars
import hashlib
import io
import json
import time
from typing import Callable, Optional, TypeVar

from PIL import Image, ImageDraw, ImageFont
from pydantic import ValidationError

from ..config import PROVIDER_ORDER, provider_settings
from ..llm import cache, usage
from ..semantics.chain import _call_with_timeout, _short
from ..semantics.providers import ProviderReply, call_groq

T = TypeVar("T")
CACHE_VERSION = "media-v1"
TIMEOUT_S = 150.0
RETRY_SUFFIX = "\n\nYour previous answer was not valid ({error}). Reply again with ONLY the JSON object described above."
Images = list[tuple[str, bytes]]  # (label, jpeg bytes)


def jpeg(path_or_img, side: int = 896, quality: int = 80) -> bytes:
    """A request-sized JPEG (the frames on disk are 1024 px)."""
    im = path_or_img if isinstance(path_or_img, Image.Image) else Image.open(path_or_img)
    im = im.convert("RGB")
    im.thumbnail((side, side), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def contact_sheet(images: Images, cols: int = 4, cell: int = 360) -> bytes:
    """One JPEG with every image as a numbered tile (for one-image providers and overview calls)."""
    rows = (len(images) + cols - 1) // cols
    pad, bar = 8, 34
    sheet = Image.new("RGB", (cols * (cell + pad) + pad, rows * (cell + bar + pad) + pad), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default(size=24)
    except TypeError:  # older Pillow
        font = ImageFont.load_default()
    for i, (label, data) in enumerate(images):
        im = Image.open(io.BytesIO(data)).convert("RGB")
        im.thumbnail((cell, cell), Image.LANCZOS)
        x = pad + (i % cols) * (cell + pad)
        y = pad + (i // cols) * (cell + bar + pad)
        draw.rectangle([x, y, x + cell, y + bar - 4], fill=(15, 23, 42))
        draw.text((x + 8, y + 3), label, fill=(255, 255, 255), font=font)
        sheet.paste(im, (x + (cell - im.width) // 2, y + bar))
    buf = io.BytesIO()
    sheet.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def call_claude_multi(images: Images, prompt: str, *, model: str, api_key: str, timeout_s: float, max_tokens: int) -> ProviderReply:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key, timeout=timeout_s, max_retries=0)
    content: list[dict] = []
    for label, data in images:
        content.append({"type": "text", "text": label})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(data).decode()}})
    content.append({"type": "text", "text": prompt})
    t0 = time.monotonic()
    msg = client.messages.create(model=model, max_tokens=max_tokens, messages=[{"role": "user", "content": content}])
    if msg.stop_reason == "max_tokens":
        raise RuntimeError("Claude hit max_tokens before finishing the JSON")
    text = "".join(b.text for b in msg.content if b.type == "text")
    return ProviderReply(text, msg.model, time.monotonic() - t0, {"input_tokens": msg.usage.input_tokens, "output_tokens": msg.usage.output_tokens})


def call_gemini_multi(images: Images, prompt: str, *, model: str, api_key: str, timeout_s: float, max_tokens: int) -> ProviderReply:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=int(timeout_s * 1000), retry_options=types.HttpRetryOptions(attempts=1)))
    parts: list = []
    for label, data in images:
        parts += [label, types.Part.from_bytes(data=data, mime_type="image/jpeg")]
    t0 = time.monotonic()
    resp = client.models.generate_content(model=model, contents=[*parts, prompt],
                                          config=types.GenerateContentConfig(response_mime_type="application/json", max_output_tokens=max_tokens))
    if not resp.text:
        raise RuntimeError("Gemini returned no text")
    um = resp.usage_metadata
    return ProviderReply(resp.text, resp.model_version or model, time.monotonic() - t0,
                         {"input_tokens": getattr(um, "prompt_token_count", None), "output_tokens": getattr(um, "candidates_token_count", None)} if um else {})


def call_groq_multi(images: Images, prompt: str, *, model: str, api_key: str, timeout_s: float, max_tokens: int) -> ProviderReply:
    sheet = contact_sheet(images)
    note = "\n\nThe image is a contact sheet: each tile is labelled with its photo number at the top."
    return call_groq(sheet, "image/jpeg", prompt + note, model=model, api_key=api_key, timeout_s=timeout_s)


CALLS: dict[str, Callable[..., ProviderReply]] = {
    "claude": usage.tracked("claude", call_claude_multi),
    "gemini": usage.tracked("gemini", call_gemini_multi),
    "groq": usage.tracked("groq", call_groq_multi),
}


def vision_multi_json(images: Images, prompt: str, parse: Callable[[str], T], *, kind: str, max_tokens: int = 6000,
                      order: Optional[list[str]] = None, sleep: Callable[[float], None] = time.sleep) -> tuple[T, str]:
    """(parsed value, provider or "cache"). Raises RuntimeError when no provider gives a valid answer."""
    key = cache.key_of([CACHE_VERSION, kind, prompt, [(lbl, hashlib.sha256(d).hexdigest()) for lbl, d in images]])
    hit = cache.get("media", key)
    if hit is not None:
        return parse(json.dumps(hit["value"])) if not isinstance(hit["value"], str) else parse(hit["value"]), "cache"
    settings = provider_settings()
    errors: list[str] = []
    for name in order or PROVIDER_ORDER:
        s = settings[name]
        if not s["api_key"]:
            continue
        if usage.cooling(name):
            errors.append(f"{name}: cooling down")
            continue
        p, waits = prompt, [3.0, 8.0]
        attempt = 0
        while attempt < 2:
            attempt += 1
            try:
                with usage.purpose("media"):
                    # the provider runs in a worker thread: carry the usage purpose label over
                    ctx = contextvars.copy_context()
                    reply = _call_with_timeout(lambda **kw: ctx.run(CALLS[name], **kw), TIMEOUT_S, images=images, prompt=p,
                                               model=s["model"], api_key=s["api_key"], max_tokens=max_tokens)
            except Exception as e:  # noqa: BLE001 - API error, timeout or cap: next provider
                errors.append(f"{name}: {_short(e)}")
                if waits and not usage.quota_exhausted(e) and any(t in str(e) for t in ("503", "UNAVAILABLE", "overloaded", "529", "Connection", "timed out")):
                    sleep(waits.pop(0))
                    attempt -= 1
                    continue
                if usage.quota_exhausted(e):
                    usage.cool_down(name)
                break
            try:
                value = parse(reply.text)
            except (json.JSONDecodeError, ValidationError, ValueError) as e:
                errors.append(f"{name}: invalid output ({_short(e, 120)})")
                p = prompt + RETRY_SUFFIX.format(error=_short(e, 200))
                continue
            cache.put("media", key, reply.text, provider=name, model=reply.model)
            return value, name
    raise RuntimeError("no vision provider produced a valid answer: " + "; ".join(errors[-4:]))
