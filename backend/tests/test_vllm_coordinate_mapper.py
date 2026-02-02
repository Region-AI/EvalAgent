"""
Standalone test:
- Loads screenshot.png
- Explicitly instructs VLLM to click the Login button
- Gets raw coordinate output from VLLM
- Maps using VLLMCoordinateMapper
- Exports annotated output showing:
    RED   = raw VLLM coordinate (model space)
    GREEN = mapped coordinate (real image space)
"""

import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Add project root for imports
ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from app_evaluation_agent.schemas.agent import AgentContext
from app_evaluation_agent.services.vllm_coordinate_mapper import VLLMCoordinateMapper
from app_evaluation_agent.services.agents.analyzer import AnalyzerAgent


def await_or_sync(coro):
    """Run async function from sync context."""
    try:
        import asyncio

        return asyncio.run(coro)
    except RuntimeError:
        return coro


def draw_point(draw, x, y, color, label):
    r = 6
    draw.ellipse((x - r, y - r, x + r, y + r), fill=color)
    draw.text((x + 10, y + 10), label, fill=color)


def main():
    img_path = ROOT / "screenshot.png"
    if not img_path.exists():
        print(f"[!] screenshot.png not found at {img_path}")
        return

    print(f"[+] Loading screenshot: {img_path}")
    img = Image.open(img_path).convert("RGB")
    real_w, real_h = img.size

    # ------------------------------------------------------
    # Create explicit "CLICK LOGIN" agent context
    # ------------------------------------------------------
    context = AgentContext(
        high_level_goal=(
            "Look at the screenshot and click the Login button. "
            "Use a single click tool call with coordinates to do so."
        ),
        test_case_id=1,
        test_case_description="Verify the Login button is clickable.",
        action_history=[],
        scratchpad="Click Login button.",
        variables={},
    )

    # Encode image as PNG bytes
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    image_bytes = buf.getvalue()

    print("[*] Querying VLLM (explicit Login click)...")
    try:
        llm_result = await_or_sync(
            AnalyzerAgent.process_context_and_image(
                context=context, image_bytes=image_bytes, image_size=(real_w, real_h)
            )
        )
    except Exception as e:
        print(f"[!] VLLM call failed: {e}")
        return

    action = llm_result.action.model_dump()
    print("\n=== VLLM Raw Action ===")
    print(json.dumps(action, indent=2))

    point_tools = {"single_click", "double_click", "right_click"}
    if action["tool_name"] not in point_tools:
        print("\n[!] VLLM did NOT issue a point-and-click action!")
        print("It may not have understood the instruction. Check system prompt.")
        return

    params = action["parameters"]
    raw_coords = params.get("raw_model_coords") or {"x": params["x"], "y": params["y"]}
    raw_x = raw_coords["x"]
    raw_y = raw_coords["y"]
    mapped_x = params["x"]
    mapped_y = params["y"]

    print(f"Raw VLLM coords: ({raw_x}, {raw_y})")

    # ------------------------------------------------------
    # Map using your new coordinate transformer (sanity check)
    # ------------------------------------------------------
    mapper = VLLMCoordinateMapper()
    expected_mapped_x, expected_mapped_y = mapper(raw_x, raw_y, real_w, real_h)

    print(f"Mapped coords (service): ({mapped_x}, {mapped_y})")
    print(f"Sanity mapped coords (local): ({expected_mapped_x}, {expected_mapped_y})")

    # ------------------------------------------------------
    # Draw annotated output
    # ------------------------------------------------------
    annotated = img.copy()
    draw = ImageDraw.Draw(annotated)

    try:
        font = ImageFont.truetype("arial.ttf", 16)
    except Exception:
        font = ImageFont.load_default()

    draw_point(draw, raw_x, raw_y, "red", "raw (vllm)")
    draw_point(draw, mapped_x, mapped_y, "lime", "mapped (corrected)")

    # ------------------------------------------------------
    # Save output
    # ------------------------------------------------------
    out_path = ROOT / "tests" / "vllm_click_login.png"
    annotated.save(out_path)

    print(f"\n[+] Saved annotated VLLM click -> {out_path}")


if __name__ == "__main__":
    main()
