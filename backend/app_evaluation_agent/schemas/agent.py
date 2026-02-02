from typing import Any, Dict, List, Optional, Literal
from pydantic import BaseModel, Field


class LastFocus(BaseModel):
    """
    Represents the last known focused point reported by the frontend.
    Coordinates are expected to be screen-space after mapping.
    """

    x: float = Field(description="Screen-space x after mapping.")
    y: float = Field(description="Screen-space y after mapping.")
    space: Optional[Literal["screen", "capture", "analysis"]] = Field(
        default=None, description='Coordinate space origin (e.g., "screen").'
    )
    normalized: Optional[bool] = Field(
        default=None, description="Whether the original coords were normalized."
    )
    raw_model_coords: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Raw model-produced coordinates (e.g., normalized) if provided.",
    )
    method: Optional[str] = Field(
        default=None, description="Which action set focus (e.g., single_click)."
    )
    confirmed: Optional[bool] = Field(
        default=None, description="Whether focus is believed to be established."
    )


class AgentContext(BaseModel):
    """
    Represents the full context/state of the agent that is passed
    with every backend analysis request.
    """

    high_level_goal: str = Field(description="The main objective for the entire task.")
    test_case_id: int = Field(
        description="Identifier of the current test case being executed."
    )
    test_case_description: str = Field(
        description="Detailed instructions or checks for this test case."
    )

    action_history: List[str] = Field(
        default_factory=list, description="Sequence of the agent's past actions."
    )

    scratchpad: Optional[str] = Field(
        None, description="The agent's internal monologue or recent thoughts."
    )

    variables: Dict[str, Any] = Field(
        default_factory=dict,
        description="Values or metadata extracted during agent execution.",
    )

    last_focus: Optional[LastFocus] = Field(
        default=None,
        description=(
            "Last known focused point reported by the frontend after coordinate mapping."
        ),
    )


class ToolCall(BaseModel):
    """
    Represents a single tool call action decided by the agent.
    """

    tool_name: str = Field(description="The name of the tool to be executed.")
    parameters: Dict[str, Any] = Field(
        description="The parameters to pass to the tool."
    )


class VisionAnalysisResponse(BaseModel):
    """
    The structured response from the vision API, containing the agent's decision.
    """

    thought: str = Field(
        description="The step-by-step reasoning behind the chosen action."
    )
    action: ToolCall = Field(
        description="The specific tool and parameters for the action to be taken."
    )
    description: Optional[str] = Field(
        default=None,
        description="Optional natural-language summary of what the action accomplished.",
    )
