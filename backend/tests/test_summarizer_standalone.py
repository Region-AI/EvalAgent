"""
Standalone test runner for the Coordinator Summarizer (v2).

This version loads TestPlan.test_cases using selectinload
to avoid MissingGreenlet caused by lazy-loading in async.
"""

import asyncio
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app_evaluation_agent.storage.database import AsyncSessionLocal
from app_evaluation_agent.storage.models import (
    Evaluation,
    TestPlan,
    TestCase,
    AppType,
    EvaluationStatus,
    TestCaseStatus,
    App,
    AppVersion,
)
from app_evaluation_agent.services.agents import SummarizerAgent


async def run():
    print("=== Standalone Summarizer Test (v2) ===")
    print(f"Start time: {datetime.now()}")
    print("----------------------------------")

    async with AsyncSessionLocal() as db:
        # ----------------------------------------------------
        # 1) Create Evaluation
        # ----------------------------------------------------
        app = App(name="Example App", app_type=AppType.WEB_APP)
        db.add(app)
        await db.commit()
        await db.refresh(app)

        app_version = AppVersion(
            app_id=app.id,
            version="1.0.0",
            app_url="https://example.com",
        )
        db.add(app_version)
        await db.commit()
        await db.refresh(app_version)

        evaluation = Evaluation(
            app_version_id=app_version.id,
            status=EvaluationStatus.IN_PROGRESS,
            execution_mode="cloud",
            assigned_executor_id=None,
            local_application_path=None,
            high_level_goal="Test login flow",
            run_on_current_screen=False,
        )

        db.add(evaluation)
        await db.commit()
        await db.refresh(evaluation)

        print(f"Created Evaluation: id={evaluation.id}")

        # ----------------------------------------------------
        # 2) Create TestPlan (empty)
        # ----------------------------------------------------
        plan = TestPlan(
            evaluation_id=evaluation.id,
            status=None,
            summary=None,
        )

        db.add(plan)
        await db.commit()
        await db.refresh(plan)

        print(f"Created TestPlan: id={plan.id}")
        print("----------------------------------")

        # ----------------------------------------------------
        # 3) Insert completed TestCases
        # ----------------------------------------------------
        results = [
            {
                "success": True,
                "steps": [
                    "Opened login page",
                    "Entered valid credentials",
                    "Clicked login",
                ],
            },
            {
                "success": False,
                "steps": ["Entered wrong password", "Clicked login"],
                "error": "Error message text incorrect",
            },
        ]

        for i, result in enumerate(results, start=1):
            tc = TestCase(
                plan_id=plan.id,
                evaluation_id=evaluation.id,
                name=f"Test Case {i}",
                description="Dummy case for summarizer test",
                input_data={},
                status=TestCaseStatus.COMPLETED,
                result=result,
                execution_order=i,
                assigned_executor_id=None,
            )
            db.add(tc)

        await db.commit()
        print(f"Inserted {len(results)} completed TestCases.")
        print("----------------------------------")

        # ----------------------------------------------------
        # 4) Reload TestPlan WITH test_cases preloaded
        # ----------------------------------------------------
        stmt = (
            select(TestPlan)
            .where(TestPlan.id == plan.id)
            .options(selectinload(TestPlan.test_cases))
        )
        result = await db.execute(stmt)
        plan = result.scalars().first()

        # ----------------------------------------------------
        # 5) Run summarization
        # ----------------------------------------------------
        print("Calling summarize_evaluation()...\n")
        updated_eval = await SummarizerAgent.summarize_evaluation(db, plan)

        assert updated_eval is not None

        print("=== Summarization Complete ===")
        print(f"Evaluation ID: {updated_eval.id}")
        print("Evaluation.results:")
        print(updated_eval.results)
        print("----------------------------------")

        # Mark evaluation as COMPLETED manually for the standalone test
        updated_eval.status = EvaluationStatus.COMPLETED
        await db.commit()
        await db.refresh(updated_eval)

        print("Final Evaluation.status:", updated_eval.status)
        print("----------------------------------")

        print("Summarizer standalone test completed!")


if __name__ == "__main__":
    asyncio.run(run())
