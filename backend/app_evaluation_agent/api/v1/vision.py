import io
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from pydantic import ValidationError
from PIL import Image

from app_evaluation_agent.api.dependencies import get_optional_file
from app_evaluation_agent.schemas.agent import AgentContext, VisionAnalysisResponse
from app_evaluation_agent.services.agents.analyzer import AnalyzerAgent

router = APIRouter()
logger = logging.getLogger(__name__)

_IMAGE_KEYS = {
    "image",
    "image_bytes",
    "image_base64",
    "screenshot",
    "screenshot_base64",
}


def _redact_images(payload: dict) -> dict:
    if not isinstance(payload, dict):
        return payload
    out = {}
    for k, v in payload.items():
        if k in _IMAGE_KEYS:
            out[k] = "<omitted image data>"
        else:
            out[k] = v
    return out


@router.post("/analyze", response_model=VisionAnalysisResponse)
async def analyze_agent_context(
    context_json: str = Form(
        ...,
        description="A JSON string representing the agent's current context (goal, history, etc.).",
    ),
    image: Optional[UploadFile] = Depends(get_optional_file),
):
    """Receives the agent context + optional screenshot and returns LLM thought/action."""
    try:
        context_data = json.loads(context_json)
        logger.debug(
            "Received analyze request with context keys=%s image_supplied=%s",
            list(context_data.keys()),
            image is not None,
        )
        context = AgentContext.model_validate(context_data)
    except (json.JSONDecodeError, ValidationError) as e:
        logger.warning("Context JSON validation failed: %s", e)
        raise HTTPException(status_code=400, detail=f"Invalid context JSON: {e}")

    image_bytes = None
    image_size = None
    if image:
        image_bytes = await image.read()
        logger.debug("Read %s bytes from uploaded image", len(image_bytes))
        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                image_size = img.size
        except Exception:
            logger.warning(
                "Invalid image supplied to analyze endpoint (bytes=%s)",
                len(image_bytes),
            )
            raise HTTPException(status_code=400, detail="Invalid image data")

    logger.debug(
        "Analyze endpoint context payload: %s", _redact_images(context.model_dump())
    )

    try:
        result = await AnalyzerAgent.process_context_and_image(
            context=context, image_bytes=image_bytes, image_size=image_size
        )
        logger.debug(
            "Vision analysis completed; action=%s description=%s response=%s",
            result.action.tool_name,
            getattr(result, "description", None),
            result.model_dump(),
        )
        return result
    except Exception as e:
        logger.exception("Error during VLLM processing")
        raise HTTPException(
            status_code=500, detail=f"An error occurred during VLLM processing: {e}"
        )
