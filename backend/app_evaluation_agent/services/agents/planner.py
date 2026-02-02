import json
import logging
from typing import Any, List

from sqlalchemy.ext.asyncio import AsyncSession

from app_evaluation_agent.storage.models import (
    TestPlan,
    TestPlanStatus,
    Evaluation,
    TestCase,
    TestCaseStatus,
)
from .prompt_loader import load_agent_prompt, safe_json_loads, extract_case_dicts
from .llm_client import call_llm

logger = logging.getLogger(__name__)


class PlannerAgent:
    """LLM-powered planner that produces plans and concrete test cases."""

    @staticmethod
    async def generate_test_plan(db: AsyncSession, evaluation: Evaluation) -> TestPlan:
        """
        Create a TestPlan row for the given evaluation by calling the planner prompts.

        Steps:
        - insert plan with status GENERATING
        - call LLM
        - store parsed JSON (or raw text) into plan.summary
        - set status=READY
        """
        logger.info(
            "Starting test plan generation for evaluation %s (goal=%r)",
            evaluation.id,
            evaluation.high_level_goal,
        )
        system_prompt = load_agent_prompt("planner", "system_prompt.md")
        user_template = load_agent_prompt("planner", "user_prompt_generate_plan.md")

        user_prompt = user_template.format(
            high_level_goal=evaluation.high_level_goal or "Run an app evaluation"
        )
        logger.debug("Planner user prompt: %s", user_prompt)

        plan = TestPlan(
            evaluation_id=evaluation.id,
            status=TestPlanStatus.GENERATING,
        )
        db.add(plan)
        await db.commit()
        await db.refresh(plan)
        logger.info(
            "Persisted plan %s in status %s for evaluation %s",
            plan.id,
            plan.status,
            evaluation.id,
        )

        llm_content = await call_llm(
            system_prompt=system_prompt, user_prompt=user_prompt
        )
        logger.info(
            "Planner LLM response for evaluation %s: %s chars; preview=%r",
            evaluation.id,
            len(llm_content) if llm_content else 0,
            (
                (llm_content[:500] + "…")
                if llm_content and len(llm_content) > 500
                else llm_content
            ),
        )
        summary_data: Any = safe_json_loads(llm_content) if llm_content else None

        if summary_data is None:
            logger.warning(
                "Planner JSON parse failed for evaluation %s; storing raw text",
                evaluation.id,
            )
            summary_data = {
                "summary": llm_content or "Auto-generated test plan.",
            }

        plan.summary = summary_data
        plan.status = TestPlanStatus.READY

        await db.commit()
        await db.refresh(plan)

        logger.info(
            "Generated test plan %s for evaluation %s with keys %s; status=%s",
            plan.id,
            evaluation.id,
            (
                list(summary_data.keys())
                if isinstance(summary_data, dict)
                else type(summary_data).__name__
            ),
            plan.status,
        )
        return plan

    @staticmethod
    async def generate_test_cases(
        db: AsyncSession,
        plan: TestPlan,
        evaluation: Evaluation,
    ) -> List[TestCase]:
        """
        Expand a test plan into executable test cases using planner prompts.
        """
        system_prompt = load_agent_prompt("planner", "system_prompt.md")
        user_template = load_agent_prompt(
            "planner", "user_prompt_generate_testcases.md"
        )

        logger.info(
            "Starting testcase generation for plan %s (evaluation %s, goal=%r)",
            plan.id,
            evaluation.id,
            evaluation.high_level_goal,
        )

        user_prompt = user_template.format(
            high_level_goal=evaluation.high_level_goal or "Run an app evaluation",
            plan_summary=json.dumps(plan.summary or {}, ensure_ascii=False),
        )

        llm_content = await call_llm(
            system_prompt=system_prompt, user_prompt=user_prompt
        )
        logger.info(
            "Testcase LLM response for plan %s (evaluation %s): %s chars; preview=%r",
            plan.id,
            evaluation.id,
            len(llm_content) if llm_content else 0,
            (
                (llm_content[:500] + "…")
                if llm_content and len(llm_content) > 500
                else llm_content
            ),
        )

        case_dicts = list(
            extract_case_dicts(
                raw=llm_content,
                goal=evaluation.high_level_goal or "",
            )
        )

        test_cases: List[TestCase] = []

        for idx, case in enumerate(case_dicts, start=1):
            tc = TestCase(
                plan_id=plan.id,
                evaluation_id=evaluation.id,
                name=case.get("name") or f"Test Case {idx}",
                description=case.get("description"),
                input_data=(
                    case.get("input_data")
                    if isinstance(case.get("input_data"), dict)
                    else None
                ),
                status=TestCaseStatus.PENDING,
                execution_order=case.get("execution_order") or idx,
            )
            db.add(tc)
            test_cases.append(tc)

        await db.commit()
        for tc in test_cases:
            await db.refresh(tc)

        logger.info(
            "Generated %s test cases for plan %s (evaluation %s)",
            len(test_cases),
            plan.id,
            evaluation.id,
        )

        return test_cases
