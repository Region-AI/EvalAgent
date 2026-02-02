import json
import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app_evaluation_agent.storage.models import TestPlan, Evaluation
from .prompt_loader import load_agent_prompt
from .llm_client import call_llm

logger = logging.getLogger(__name__)


class SummarizerAgent:
    """LLM-powered summarizer that produces evaluation-level Markdown."""

    @staticmethod
    def _escape_braces(text: str) -> str:
        """
        Protect any curly braces inside JSON strings before str.format
        to avoid KeyError when prompt templates contain placeholders.
        """
        if not text:
            return text
        return text.replace("{", "{{").replace("}", "}}")

    @staticmethod
    def _strip_code_fences(text: str) -> str:
        """
        Remove surrounding Markdown code fences from the summary if present.
        """
        if not text:
            return text
        stripped = text.strip()
        if stripped.startswith("```") and stripped.endswith("```"):
            inner = stripped.strip("`")
            # Handle ```lang\n...\n``` cases
            first_newline = stripped.find("\n")
            last_newline = stripped.rfind("\n")
            if (
                first_newline != -1
                and last_newline != -1
                and last_newline > first_newline
            ):
                return stripped[first_newline + 1 : last_newline].strip()
            return stripped.strip("`").strip()
        return stripped

    @staticmethod
    async def summarize_evaluation(
        db: AsyncSession,
        plan: TestPlan,
    ) -> Optional[Evaluation]:
        """
        Produce a final evaluation-level summary once all test cases in a plan complete.

        Responsibilities:
        - Collect test_cases under the given plan
        - Call the summarizer prompt
        - Store markdown in evaluation.results
        - Do not mutate TestPlan state
        """
        await db.refresh(plan)

        evaluation = plan.evaluation
        if evaluation is None:
            logger.warning(
                "summarize_evaluation called for plan %s but no evaluation is attached",
                plan.id,
            )
            return None

        system_prompt = load_agent_prompt("summarizer", "system_prompt.md")
        user_template = load_agent_prompt("summarizer", "user_prompt_summarize.md")

        cases = plan.test_cases if hasattr(plan, "test_cases") else []

        case_payload = [
            {
                "name": tc.name,
                "status": getattr(tc.status, "value", tc.status),
                "result": tc.result,
            }
            for tc in cases
        ]

        plan_summary_json = json.dumps(plan.summary or {}, ensure_ascii=False)
        test_cases_json = json.dumps(case_payload, ensure_ascii=False)

        user_prompt = user_template.format(
            plan_summary=SummarizerAgent._escape_braces(plan_summary_json),
            test_cases=SummarizerAgent._escape_braces(test_cases_json),
        )

        llm_content = await call_llm(
            system_prompt=system_prompt, user_prompt=user_prompt
        )

        summary_payload = llm_content or "Test plan completed."
        summary_payload = SummarizerAgent._strip_code_fences(summary_payload)

        evaluation.results = {"summary": summary_payload}

        await db.commit()
        await db.refresh(evaluation)

        logger.info(
            "Completed evaluation summary for evaluation %s (via plan %s)",
            evaluation.id,
            plan.id,
        )
        return evaluation
