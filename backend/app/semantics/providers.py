"""One function per vision provider, all with the same signature:

    call_<provider>(image, mime, prompt, *, model, api_key, timeout_s) -> ProviderReply

Each returns the raw text answer; parsing/validation/retries live in chain.py, so
providers can be reordered or forced without touching anything else.
"""
from __future__ import annotations

import base64
import io
import os
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from PIL import Image

from ..llm.usage import tracked


@dataclass
class ProviderReply:
    text: str
    model: str
    latency_s: float
    usage: dict = field(default_factory=dict)
    # multiply the reported normalized label coords by this to get image-normalized coords
    # (used when a provider was sent a padded image)
    coord_scale: tuple[float, float] = (1.0, 1.0)


# ----------------------------------------------------------------------------- gemini

def call_gemini(image: bytes, mime: str, prompt: str, *, model: str, api_key: str,
                timeout_s: float) -> ProviderReply:
    from google import genai
    from google.genai import types

    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(
            timeout=int(timeout_s * 1000),
            retry_options=types.HttpRetryOptions(attempts=1),  # chain handles fallbacks
        ),
    )
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        media_resolution=types.MediaResolution.MEDIA_RESOLUTION_HIGH,
        max_output_tokens=8192,
    )
    if "2.5" in model or "2.0" in model:
        config.thinking_config = types.ThinkingConfig(thinking_budget=1024)
    else:  # Gemini 3.x: keep thinking short so we stay inside the timeout
        level = os.getenv("GEMINI_THINKING_LEVEL", "low").upper()
        config.thinking_config = types.ThinkingConfig(thinking_level=types.ThinkingLevel[level])
    t0 = time.monotonic()
    resp = client.models.generate_content(
        model=model,
        contents=[types.Part.from_bytes(data=image, mime_type=mime), prompt],
        config=config,
    )
    text = resp.text
    if not text:
        reason = resp.candidates[0].finish_reason if resp.candidates else resp.prompt_feedback
        raise RuntimeError(f"Gemini returned no text (finish_reason={reason})")
    um = resp.usage_metadata
    usage = {
        "input_tokens": getattr(um, "prompt_token_count", None),
        "output_tokens": getattr(um, "candidates_token_count", None),
        "thinking_tokens": getattr(um, "thoughts_token_count", None),
    } if um else {}
    return ProviderReply(text, resp.model_version or model, time.monotonic() - t0, usage)


# ----------------------------------------------------------------------------- claude

def call_claude(image: bytes, mime: str, prompt: str, *, model: str, api_key: str,
                timeout_s: float) -> ProviderReply:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key, timeout=timeout_s, max_retries=0)
    t0 = time.monotonic()
    msg = client.messages.create(
        model=model,
        max_tokens=8192,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mime,
                                             "data": base64.b64encode(image).decode()}},
                {"type": "text", "text": prompt},
            ],
        }],
    )
    text = "".join(b.text for b in msg.content if b.type == "text")
    if msg.stop_reason == "max_tokens":
        raise RuntimeError("Claude hit max_tokens before finishing the JSON")
    usage = {"input_tokens": msg.usage.input_tokens, "output_tokens": msg.usage.output_tokens}
    return ProviderReply(text, msg.model, time.monotonic() - t0, usage)


# ----------------------------------------------------------------------------- groq

GROQ_MAX_IMAGE_B64_BYTES = 4_000_000  # base64 payload cap we enforce (Groq's docs cap requests at 20MB)
# Groq's on_demand tier rejects any request whose expected output exceeds its output-tokens-per-
# minute limit (1000 for qwen/qwen3.8-27b on this account), so max_tokens has to stay under it.
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "1000"))


def pad_to_square(image: bytes) -> tuple[bytes, tuple[float, float]]:
    """Qwen reports y normalized by the image *width* on non-square inputs; a square canvas
    (image top-left, white padding) makes both axes consistent. Returns the PNG and the
    factors that map square-normalized coords back to image-normalized ones."""
    im = Image.open(io.BytesIO(image)).convert("RGB")
    side = max(im.width, im.height)
    if im.width == im.height:
        return image, (1.0, 1.0)
    canvas = Image.new("RGB", (side, side), (255, 255, 255))
    canvas.paste(im, (0, 0))
    buf = io.BytesIO()
    canvas.save(buf, "PNG", optimize=True)
    return buf.getvalue(), (side / im.width, side / im.height)


def fit_image_for_groq(image: bytes, mime: str, max_b64_bytes: int = GROQ_MAX_IMAGE_B64_BYTES
                       ) -> tuple[bytes, str]:
    """Re-encode (JPEG) and downscale until the base64 payload fits under the limit."""
    if len(image) * 4 / 3 <= max_b64_bytes:
        return image, mime
    im = Image.open(io.BytesIO(image)).convert("RGB")
    for scale in (1.0, 0.85, 0.7, 0.55, 0.4):
        size = (max(1, int(im.width * scale)), max(1, int(im.height * scale)))
        candidate = im if scale == 1.0 else im.resize(size, Image.LANCZOS)
        for quality in (90, 80):
            buf = io.BytesIO()
            candidate.save(buf, "JPEG", quality=quality, optimize=True)
            data = buf.getvalue()
            if len(data) * 4 / 3 <= max_b64_bytes:
                return data, "image/jpeg"
    return data, "image/jpeg"


def call_groq(image: bytes, mime: str, prompt: str, *, model: str, api_key: str,
              timeout_s: float) -> ProviderReply:
    from groq import Groq

    image, coord_scale = pad_to_square(image)
    image, mime = fit_image_for_groq(image, "image/png")
    client = Groq(api_key=api_key, timeout=timeout_s, max_retries=0)
    t0 = time.monotonic()
    resp = client.chat.completions.create(
        model=model,
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url",
                 "image_url": {"url": f"data:{mime};base64,{base64.b64encode(image).decode()}"}},
            ],
        }],
        response_format={"type": "json_object"},
        reasoning_format="hidden",  # JSON mode requires parsed|hidden for reasoning models
        reasoning_effort="none",  # reasoning tokens would eat the tiny output budget
        temperature=0.2,
        max_completion_tokens=GROQ_MAX_TOKENS,
    )
    choice = resp.choices[0]
    if choice.finish_reason == "length":
        raise RuntimeError(f"Groq output truncated at max_completion_tokens={GROQ_MAX_TOKENS}")
    text = choice.message.content or ""
    usage = {"input_tokens": resp.usage.prompt_tokens, "output_tokens": resp.usage.completion_tokens} \
        if resp.usage else {}
    return ProviderReply(text, resp.model or model, time.monotonic() - t0, usage, coord_scale)


ProviderFn = Callable[..., ProviderReply]

# every request is counted in data/llm/usage.json; Claude stops at its call cap (app/llm/usage.py)
PROVIDERS: dict[str, ProviderFn] = {
    "gemini": tracked("gemini", call_gemini),
    "claude": tracked("claude", call_claude),
    "groq": tracked("groq", call_groq),
}


def get_provider(name: str) -> Optional[ProviderFn]:
    return PROVIDERS.get(name)
