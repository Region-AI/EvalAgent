import logging
import pathlib
from typing import List

from app_evaluation_agent.schemas.agent import AgentContext

# Get the directory where this file is located
PROMPT_DIR = pathlib.Path(__file__).parent / "prompts"
logger = logging.getLogger(__name__)


def get_system_prompt() -> str:
    """Loads the system prompt from the markdown file."""
    try:
        with open(PROMPT_DIR / "system_prompt.md", "r", encoding="utf-8") as f:
            logger.debug(
                "Loaded system prompt from %s", PROMPT_DIR / "system_prompt.md"
            )
            return f.read()
    except FileNotFoundError:
        logger.debug("System prompt not found at %s", PROMPT_DIR / "system_prompt.md")
        return "Error: system_prompt.md not found."


def _build_action_history_str(action_history: List[str]) -> str:
    history_str = "\n".join(f"- {action}" for action in action_history)
    if not history_str:
        history_str = "No actions have been taken yet."
    return history_str


def _format_last_focus(last_focus) -> str:
    if not last_focus:
        return "No recent focus was reported."

    get_val = (
        (lambda key: getattr(last_focus, key, None))
        if not isinstance(last_focus, dict)
        else last_focus.get
    )
    x = get_val("x")
    y = get_val("y")
    space = get_val("space")
    method = get_val("method") or "unknown"
    confirmed = get_val("confirmed")
    normalized = get_val("normalized")

    parts = [
        f"method={method}" if method else None,
        f"coords=(x={x}, y={y})" if x is not None and y is not None else None,
        f"space={space}" if space else None,
        f"normalized={normalized}" if normalized is not None else None,
    ]
    if confirmed is not None:
        parts.append(f"confirmed={confirmed}")
    return "; ".join(p for p in parts if p)


def get_user_prompt(context: AgentContext) -> str:
    """
    Loads the user prompt template and formats it with the current context.

    Context includes high-level goal, action history, optional last focus,
    and scratchpad. UI elements are no longer supplied.
    """
    try:
        with open(PROMPT_DIR / "user_prompt.md", "r", encoding="utf-8") as f:
            prompt_template = f.read()
            logger.debug(
                "Loaded user prompt template from %s", PROMPT_DIR / "user_prompt.md"
            )

        history_str = _build_action_history_str(context.action_history)
        logger.debug(
            "Building user prompt with %s history items", len(context.action_history)
        )

        base_prompt = prompt_template.format(
            high_level_goal=context.high_level_goal,
            test_case_id=getattr(context, "test_case_id", "N/A"),
            test_case_description=getattr(context, "test_case_description", ""),
            action_history=history_str,
            last_focus=_format_last_focus(getattr(context, "last_focus", None)),
            scratchpad=context.scratchpad or "You are just starting.",
        )

        return base_prompt

    except FileNotFoundError:
        logger.debug("User prompt not found at %s", PROMPT_DIR / "user_prompt.md")
        return "Error: user_prompt.md not found."
