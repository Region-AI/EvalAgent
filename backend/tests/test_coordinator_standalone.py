"""
Standalone test runner for the new coordinator modules.
This file intentionally avoids pytest/unit-test and can be run directly:

    python tests/test_coordinator_standalone.py

It exercises:
 - generate_test_plan
 - generate_test_cases

and prints all outputs to the terminal.
"""

import asyncio
from datetime import datetime

from app_evaluation_agent.storage.database import AsyncSessionLocal
from app_evaluation_agent.storage.models import (
    Evaluation,
    AppType,
    EvaluationStatus,
    App,
    AppVersion,
)
from app_evaluation_agent.services.agents import PlannerAgent


async def run():
    print("=== Standalone Coordinator Test ===")
    print(f"Start time: {datetime.now()}")
    print("----------------------------------")

    # ------------------------------------
    # 1. Open DB session
    # ------------------------------------
    async with AsyncSessionLocal() as db:
        print("DB session created.")

        # ------------------------------------
        # 2. Insert a dummy Evaluation row
        # ------------------------------------
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
            status=EvaluationStatus.PENDING,
            execution_mode="cloud",
            assigned_executor_id=None,
            local_application_path=None,
            high_level_goal="Verify the login page works.",
            run_on_current_screen=False,
        )

        db.add(evaluation)
        await db.commit()
        await db.refresh(evaluation)

        print(f"Created Evaluation: id={evaluation.id}")
        print(f"  goal = {evaluation.high_level_goal}")
        print("----------------------------------")

        # ------------------------------------
        # 3. Generate Test Plan
        # ------------------------------------
        print("Calling PlannerAgent.generate_test_plan()...\n")
        plan = await PlannerAgent.generate_test_plan(db, evaluation)

        print("=== Generated Test Plan ===")
        print(f"Plan ID: {plan.id}")
        print(f"Status:  {plan.status}")
        print(f"Summary:")
        print(plan.summary)
        print("----------------------------------")

        # ------------------------------------
        # 4. Generate Test Cases
        # ------------------------------------
        print("Calling PlannerAgent.generate_test_cases()...\n")
        cases = await PlannerAgent.generate_test_cases(db, plan, evaluation)

        print("=== Generated Test Cases ===")
        for tc in cases:
            print(f"- ID: {tc.id}")
            print(f"  Name: {tc.name}")
            print(f"  Desc: {tc.description}")
            print(f"  Order: {tc.execution_order}")
            print(f"  Assigned Exec: {tc.assigned_executor_id}")
            print("  -------------------------")

        print("----------------------------------")
        print("Coordinator test run completed!")


if __name__ == "__main__":
    asyncio.run(run())
