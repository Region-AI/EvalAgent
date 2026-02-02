import base64
import io
import json
import logging
from typing import Optional, Tuple

from openai import AsyncOpenAI
from PIL import Image
from pydantic import ValidationError

from app_evaluation_agent.schemas.agent import (
    AgentContext,
    LastFocus,
    ToolCall,
    VisionAnalysisResponse,
)
from app_evaluation_agent.services import prompts
from app_evaluation_agent.services.vllm_coordinate_mapper import VLLMCoordinateMapper
from app_evaluation_agent.utils.config import settings

logger = logging.getLogger(__name__)


class AnalyzerAgent:
    """Handles /analyze vision calls against the vLLM endpoint."""

    _client: Optional[AsyncOpenAI] = None
    _coord_mapper = VLLMCoordinateMapper()
    _POINT_TOOLS = {"single_click", "double_click", "right_click"}

    @classmethod
    def _get_client(cls) -> AsyncOpenAI:
        if cls._client is None:
            api_key = settings.vllm.api_key
            base_url = settings.vllm.base_url
            model_name = settings.vllm.model_name
            if not api_key or api_key == "placeholder":
                raise ValueError(
                    "LLM API Key is not configured in the backend settings."
                )
            if not base_url or base_url == "placeholder":
                raise ValueError(
                    "LLM base_url is not configured in the backend settings."
                )
            if not model_name or model_name == "placeholder":
                raise ValueError(
                    "VLLM model_name is not configured in the backend settings."
                )

            cls._client = AsyncOpenAI(api_key=api_key, base_url=base_url)
            logger.debug(
                "VLLM client configured successfully (base_url=%s, model=%s)",
                base_url,
                model_name,
            )
        return cls._client

    @classmethod
    def _normalize_last_focus_to_canonical(
        cls, context: AgentContext, image_size: Optional[Tuple[int, int]]
    ) -> AgentContext:
        """
        Prefer raw_model_coords for canonical last_focus. If absent, leave as-is.
        """
        last_focus = getattr(context, "last_focus", None)
        if last_focus is None:
            return context

        raw_model_coords = getattr(last_focus, "raw_model_coords", None) or {}
        try:
            model_x = float(raw_model_coords.get("x"))
            model_y = float(raw_model_coords.get("y"))
            model_normalized = bool(raw_model_coords.get("normalized"))
        except (TypeError, ValueError):
            model_x = model_y = None

        if model_x is not None and model_y is not None:
            if model_normalized:
                cx = (
                    max(0.0, min(1.0, model_x)) * cls._coord_mapper.prof.canonical_width
                )
                cy = (
                    max(0.0, min(1.0, model_y))
                    * cls._coord_mapper.prof.canonical_height
                )
            else:
                cx, cy = model_x, model_y

            new_last_focus = last_focus.model_copy(
                update={
                    "x": cx,
                    "y": cy,
                    "space": "analysis",
                    "normalized": False,
                }
            )
            return context.model_copy(update={"last_focus": new_last_focus})

        return context

    @staticmethod
    def _prune_last_focus_for_prompt(context: AgentContext) -> AgentContext:
        """
        Drop non-essential last_focus fields before sending to the model prompt.
        Keeps only canonical coords and space flag to avoid leaking noisy metadata.
        """
        last_focus = getattr(context, "last_focus", None)
        if last_focus is None:
            return context

        minimal_focus = LastFocus(
            x=last_focus.x,
            y=last_focus.y,
            space=None,
            normalized=None,
        )
        return context.model_copy(update={"last_focus": minimal_focus})

    @staticmethod
    def _compact_action_history(history: list[str]) -> list[str]:
        """
        Pass through the history as human-readable action summaries.
        Trims to the most recent 20 entries to keep prompts small.
        """
        if not history:
            return []
        return history[-20:]

    @classmethod
    def _map_action_coordinates(
        cls, action: ToolCall, image_size: Optional[Tuple[int, int]]
    ) -> ToolCall:
        """
        Map model coordinates to screen pixels; preserve raw coords for debugging.
        """
        if image_size is None:
            return action

        width, height = image_size
        params = action.parameters or {}
        normalized = bool(params.get("normalized")) if "normalized" in params else False
        space = params.get("space") or "analysis"

        def _map_point(x: float, y: float) -> Tuple[int, int, dict]:
            try:
                raw_x = float(x)
                raw_y = float(y)
            except (TypeError, ValueError):
                raise ValueError("Invalid coordinate values")

            if normalized:
                rx = max(0.0, min(1.0, raw_x))
                ry = max(0.0, min(1.0, raw_y))
                mapped_x = int(round(rx * (width - 1)))
                mapped_y = int(round(ry * (height - 1)))
            else:
                mapped_x, mapped_y = cls._coord_mapper(raw_x, raw_y, width, height)

            return (
                mapped_x,
                mapped_y,
                {
                    "x": raw_x,
                    "y": raw_y,
                    "normalized": normalized,
                },
            )

        if action.tool_name in cls._POINT_TOOLS:
            try:
                mapped_x, mapped_y, raw = _map_point(params.get("x"), params.get("y"))
            except ValueError:
                return action

            new_params = dict(params)
            new_params.update(
                {
                    "x": mapped_x,
                    "y": mapped_y,
                    "space": space,
                    "normalized": False,
                    "raw_model_coords": raw,
                }
            )

            logger.debug(
                "Mapped %s coords (raw=%s,%s) -> (mapped=%s,%s) using image_size=%sx%s",
                action.tool_name,
                raw["x"],
                raw["y"],
                mapped_x,
                mapped_y,
                width,
                height,
            )
            return action.model_copy(update={"parameters": new_params})

        if action.tool_name == "drag":
            try:
                start = params.get("from") or {}
                end = params.get("to") or {}
                from_x, from_y, raw_from = _map_point(start.get("x"), start.get("y"))
                to_x, to_y, raw_to = _map_point(end.get("x"), end.get("y"))
            except ValueError:
                return action

            new_params = dict(params)
            new_params.update(
                {
                    "from": {"x": from_x, "y": from_y},
                    "to": {"x": to_x, "y": to_y},
                    "space": space,
                    "normalized": False,
                    "raw_model_coords": {"from": raw_from, "to": raw_to},
                }
            )

            logger.debug(
                "Mapped drag coords (raw_from=%s raw_to=%s) -> (from=%s,%s to=%s,%s) using image_size=%sx%s",
                raw_from,
                raw_to,
                from_x,
                from_y,
                to_x,
                to_y,
                width,
                height,
            )
            return action.model_copy(update={"parameters": new_params})

        return action

    @classmethod
    async def process_context_and_image(
        cls,
        context: AgentContext,
        image_bytes: Optional[bytes] = None,
        image_size: Optional[Tuple[int, int]] = None,
    ) -> VisionAnalysisResponse:
        """
        Calls an OpenAI-compatible chat completion endpoint (supports vision)
        and returns a structured VisionAnalysisResponse.
        """
        try:
            client = cls._get_client()

            resolved_size = image_size
            if resolved_size is None and image_bytes:
                try:
                    with Image.open(io.BytesIO(image_bytes)) as img:
                        resolved_size = img.size
                except Exception:
                    logger.debug(
                        "Unable to infer image size from bytes; skipping mapping"
                    )

            compacted_history_context = context.model_copy(
                update={
                    "action_history": cls._compact_action_history(
                        context.action_history
                    )
                }
            )
            normalized_context = cls._normalize_last_focus_to_canonical(
                compacted_history_context, resolved_size
            )
            prompt_context = cls._prune_last_focus_for_prompt(normalized_context)
            logger.debug(
                "Prepared prompt context for VLLM call; image_size=%s payload=%s",
                resolved_size,
                prompt_context.model_dump(),
            )

            system_prompt = prompts.get_system_prompt()
            user_prompt_text = prompts.get_user_prompt(prompt_context)
            logger.debug(
                "Prepared prompts for VLLM call; action_history=%s",
                len(prompt_context.action_history),
            )

            # Build user content with optional image part
            user_content: list[dict] | list[str] = []
            user_content = [{"type": "text", "text": user_prompt_text}]
            if image_bytes:
                b64 = base64.b64encode(image_bytes).decode("utf-8")
                data_url = f"data:image/png;base64,{b64}"
                user_content.append(
                    {"type": "image_url", "image_url": {"url": data_url}}
                )

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ]

            logger.debug(
                "Calling chat.completions with model=%s include_image=%s",
                settings.vllm.model_name,
                bool(image_bytes),
            )
            completion = await client.chat.completions.create(
                model=settings.vllm.model_name,
                messages=messages,
                response_format={"type": "json_object"},
            )

            response_content = completion.choices[0].message.content or "{}"
            response_data = json.loads(response_content)
            logger.debug("LLM response parsed successfully")
            llm_result = VisionAnalysisResponse.model_validate(response_data)
            mapped_action = cls._map_action_coordinates(
                llm_result.action, resolved_size
            )
            return llm_result.model_copy(update={"action": mapped_action})

        except (json.JSONDecodeError, ValidationError):
            logger.exception("Failed to parse or validate model response")
            return VisionAnalysisResponse(
                thought=(
                    "The model returned an invalid JSON response. "
                    "See server logs for details."
                ),
                action=ToolCall(
                    tool_name="finish_task",
                    parameters={"status": "failed"},
                ),
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected error in the VLLM service")
            return VisionAnalysisResponse(
                thought=f"An API or configuration error occurred: {exc}",
                action=ToolCall(
                    tool_name="finish_task",
                    parameters={"status": "failed"},
                ),
            )


__all__ = ["AnalyzerAgent"]
