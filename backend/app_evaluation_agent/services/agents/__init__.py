"""
Agent-facing service layer.

Agents:
- CoordinatorAgent: orchestration/bootstrap of plans and cases
- PlannerAgent: plan + test case generation
- SummarizerAgent: final reporting once execution completes
- AnalyzerAgent: vision loop that serves /analyze
"""

from .analyzer import AnalyzerAgent
from .coordinator import CoordinatorAgent
from .planner import PlannerAgent
from .summarizer import SummarizerAgent

# Convenience exports
generate_test_plan = PlannerAgent.generate_test_plan
generate_test_cases = PlannerAgent.generate_test_cases
summarize_evaluation = SummarizerAgent.summarize_evaluation

__all__ = [
    "AnalyzerAgent",
    "CoordinatorAgent",
    "PlannerAgent",
    "SummarizerAgent",
    "generate_test_plan",
    "generate_test_cases",
    "summarize_evaluation",
]
