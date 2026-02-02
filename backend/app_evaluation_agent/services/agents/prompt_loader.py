import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

PROMPTS_ROOT = Path(__file__).resolve().parents[1] / "prompts"

# Reusable JSON helpers
JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)
JSON_ARRAY_RE = re.compile(r"\[.*\]", re.DOTALL)


def load_agent_prompt(agent: str, name: str) -> str:
    """
    Load a prompt file from services/prompts/<agent>/<name>.
    Returns empty string and logs a warning if not found.
    """
    path = PROMPTS_ROOT / agent / name
    try:
        text = path.read_text(encoding="utf-8")
        logger.debug("Loaded %s prompt from %s", agent, path)
        return text
    except FileNotFoundError:
        logger.warning("Prompt file not found: %s", path)
        return ""


def strip_markdown_fences(text: str) -> str:
    """Remove wrapping ``` fences from LLM output."""
    if not text:
        return text

    text = text.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline:].strip()

    if text.endswith("```"):
        text = text[:-3].strip()

    return text


def extract_json_payload(text: str) -> Optional[str]:
    """
    Extract the first JSON object or array from the text.
    Returns the JSON substring or None.
    """
    if not text:
        return None

    text = strip_markdown_fences(text)

    arr_match = JSON_ARRAY_RE.search(text)
    if arr_match:
        return arr_match.group(0).strip()

    obj_match = JSON_OBJECT_RE.search(text)
    if obj_match:
        return obj_match.group(0).strip()

    return None


def safe_json_loads(text: str) -> Optional[Any]:
    """
    Attempts to extract a JSON object/array from messy LLM output.
    """
    if not text:
        return None

    extracted = extract_json_payload(text)
    if not extracted:
        return None

    try:
        return json.loads(extracted)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Failed to json.loads extracted payload: %s", exc)
        return None


def fallback_test_cases(goal: str) -> List[Dict[str, Any]]:
    """Deterministic test case list used when the LLM output is unusable."""
    return [
        {
            "name": "Smoke test",
            "description": f"Basic sanity check for goal: {goal or 'Run an app evaluation'}",
            "input_data": {},
            "execution_order": 1,
        }
    ]


def extract_case_dicts(raw: str, goal: str) -> Iterable[Dict[str, Any]]:
    """
    Extract a list of test case dictionaries from LLM output.
    Supports:
    - pure JSON array
    - { "cases": [ ... ] }
    - JSON wrapped in markdown fences
    - JSON embedded inside natural language

    Falls back to a smoke test otherwise.
    """
    parsed = safe_json_loads(raw)

    if isinstance(parsed, list):
        return parsed

    if isinstance(parsed, dict) and isinstance(parsed.get("cases"), list):
        return parsed["cases"]

    logger.debug("extract_case_dicts: fallback triggered, raw was not valid JSON.")
    return fallback_test_cases(goal)
