"""
Manual probe for vision LLM click bias.

Workflow:
- Synthesize canvases at fixed size.
- Place the provided login button PNG at several positions.
- Query the configured vision LLM for the login button click point.
- Append JSONL rows capturing expected vs. returned coordinates.

Run directly with a configured LLM in config/settings.toml.
This is not a pytest; execute via `poetry run python tests/test_vllm_coordinate_bias.py`.
"""

from __future__ import annotations

import asyncio
import base64
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple

from openai import AsyncOpenAI
from PIL import Image

# Ensure project package is importable when run directly (e.g. `poetry run python tests/test_vllm_coordinate_bias.py`)
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from app_evaluation_agent.utils.config import settings

CANVAS_HEIGHT = 768  # keep height invariant
CANVAS_WIDTHS = [800, 1024, 1280, 1440]  # test multiple widths
OUTPUT_PATH = Path(__file__).resolve().parent / "vllm_coordinate_bias.jsonl"
BUTTON_PATH = Path(__file__).resolve().parents[1] / "login.png"


@dataclass
class Placement:
    name: str
    center: Tuple[int, int]


def _placements_for_width(width: int) -> List[Placement]:
    return [
        Placement("center", (width // 2, CANVAS_HEIGHT // 2)),
        Placement("upper_left_quarter", (width // 4, CANVAS_HEIGHT // 4)),
        Placement("upper_right_quarter", (3 * width // 4, CANVAS_HEIGHT // 4)),
        Placement("lower_left_quarter", (width // 4, 3 * CANVAS_HEIGHT // 4)),
        Placement("lower_right_quarter", (3 * width // 4, 3 * CANVAS_HEIGHT // 4)),
    ]


def _image_to_bytes(img: Image.Image) -> bytes:
    from io import BytesIO

    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _compose_canvas(
    button_img: Image.Image, width: int, center: Tuple[int, int]
) -> Image.Image:
    canvas = Image.new("RGB", (width, CANVAS_HEIGHT), color="white")
    bw, bh = button_img.size
    top_left = (int(center[0] - bw / 2), int(center[1] - bh / 2))
    canvas.paste(button_img, box=top_left)
    return canvas


async def _query_llm(client: AsyncOpenAI, image_bytes: bytes, width: int) -> Dict:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    user_parts = [
        {
            "type": "text",
            "text": (
                "Canvas origin is top-left. "
                f"Canvas size: {width}x{CANVAS_HEIGHT}. "
                "Locate the login button and reply with JSON: "
                '{"x": <int>, "y": <int>} giving the click coordinates in pixels.'
            ),
        },
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
    ]

    completion = await client.chat.completions.create(
        model=settings.llm.model_name,
        messages=[
            {
                "role": "system",
                "content": "Return only JSON with x and y coordinates for the login button center.",
            },
            {"role": "user", "content": user_parts},
        ],
        response_format={"type": "json_object"},
    )

    content = completion.choices[0].message.content or "{}"
    return json.loads(content)


def _check_env() -> bool:
    placeholders = {"placeholder", "", None}
    if (
        settings.llm.api_key in placeholders
        or settings.llm.base_url in placeholders
        or settings.llm.model_name in placeholders
    ):
        print("LLM settings are not configured; update config/settings.toml.")
        return False
    return True


async def _async_main() -> None:
    if not _check_env():
        return

    if not BUTTON_PATH.exists():
        raise FileNotFoundError(f"Login button asset missing at {BUTTON_PATH}")

    button_img = Image.open(BUTTON_PATH).convert("RGB")
    rows = []

    client: AsyncOpenAI | None = None
    try:
        client = AsyncOpenAI(
            api_key=settings.llm.api_key, base_url=settings.llm.base_url
        )

        for width in CANVAS_WIDTHS:
            placements = _placements_for_width(width)
            for placement in placements:
                canvas = _compose_canvas(button_img, width, placement.center)
                image_bytes = _image_to_bytes(canvas)
                response = await _query_llm(client, image_bytes, width)

                parsed_x = response.get("x")
                parsed_y = response.get("y")
                row = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "placement": placement.name,
                    "canvas": {"width": width, "height": CANVAS_HEIGHT},
                    "expected": {"x": placement.center[0], "y": placement.center[1]},
                    "response": response,
                    "delta": {
                        "dx": (
                            None if parsed_x is None else parsed_x - placement.center[0]
                        ),
                        "dy": (
                            None if parsed_y is None else parsed_y - placement.center[1]
                        ),
                    },
                }
                rows.append(row)
    finally:
        if client is not None:
            await client.close()

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "a", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"Wrote {len(rows)} rows to {OUTPUT_PATH}")


if __name__ == "__main__":
    asyncio.run(_async_main())
