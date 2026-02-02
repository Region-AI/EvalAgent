import logging
from typing import Optional

from openai import AsyncOpenAI

from app_evaluation_agent.utils.config import settings

logger = logging.getLogger(__name__)

_client: Optional[AsyncOpenAI] = None


def get_client() -> AsyncOpenAI:
    """
    Lazily initialize and cache the AsyncOpenAI client used by
    the planner and summarizer agents.
    """
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=settings.llm.api_key,
            base_url=settings.llm.base_url,
        )
        logger.debug(
            "Agents LLM client initialized (base_url=%s, model=%s)",
            settings.llm.base_url,
            settings.llm.model_name,
        )
    return _client


async def call_llm(system_prompt: str, user_prompt: str) -> str:
    """
    Call the configured chat completion endpoint with optional system + user prompts.
    Returns the raw message content string, or an empty string on failure.
    """
    try:
        client = get_client()
    except Exception as exc:  # noqa: BLE001
        logger.error("Unable to initialize LLM client: %s", exc)
        return ""

    try:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})

        completion = await client.chat.completions.create(
            model=settings.llm.model_name,
            messages=messages,
        )
        content = completion.choices[0].message.content or ""
        logger.debug("LLM call succeeded, content_length=%s", len(content))
        return content
    except Exception as exc:  # noqa: BLE001
        logger.exception("LLM call failed: %s", exc)
        return ""
