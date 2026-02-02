import math

from app_evaluation_agent.schemas.agent import AgentContext, LastFocus
from app_evaluation_agent.services.agents.analyzer import AnalyzerAgent


def _assert_close(actual: float, expected: float, tol: float = 1e-9):
    if not math.isclose(actual, expected, rel_tol=tol):
        raise AssertionError(f"{actual} != {expected} within tolerance {tol}")


def test_raw_model_coords_normalized_used_for_canonical():
    context = AgentContext(
        high_level_goal="map focus point (raw coords)",
        test_case_id=1,
        test_case_description="Map focus point.",
        action_history=[],
        last_focus=LastFocus(
            x=512,
            y=420,
            normalized=False,
            raw_model_coords={"x": 0.51, "y": 0.42, "normalized": True},
        ),
    )

    mapped = AnalyzerAgent._normalize_last_focus_to_canonical(context, (1920, 1080))

    print("\n[raw_model_coords normalized -> canonical]")
    print(f"input (raw_model_coords): ({0.51}, {0.42}) normalized")
    print(
        f"mapped (analysis): ({mapped.last_focus.x:.2f}, {mapped.last_focus.y:.2f}) space={mapped.last_focus.space}"
    )

    assert mapped.last_focus.space == "analysis"
    assert mapped.last_focus.normalized is False
    _assert_close(mapped.last_focus.x, 510.0)  # 0.51 * 1000
    _assert_close(mapped.last_focus.y, 420.0)  # 0.42 * 1000
    # Original context unchanged
    assert context.last_focus.x == 512
    assert context.last_focus.y == 420


def test_fallback_leaves_focus_untouched_when_no_raw_coords():
    context = AgentContext(
        high_level_goal="pass-through focus",
        test_case_id=2,
        test_case_description="Pass-through focus.",
        action_history=[],
        last_focus=LastFocus(
            x=960,
            y=540,
            space="screen",
            normalized=False,
        ),
    )

    mapped = AnalyzerAgent._normalize_last_focus_to_canonical(context, (200, 100))

    print("\n[no raw_model_coords -> pass-through]")
    print(f"input (screen): ({context.last_focus.x}, {context.last_focus.y})")
    print(f"mapped (analysis): {mapped.last_focus}")

    assert mapped.last_focus.x == context.last_focus.x
    assert mapped.last_focus.y == context.last_focus.y
    assert mapped.last_focus.space == context.last_focus.space
    assert mapped.last_focus.normalized == context.last_focus.normalized


def main():
    test_raw_model_coords_normalized_used_for_canonical()
    test_fallback_leaves_focus_untouched_when_no_raw_coords()
    print("[+] last_focus reverse mapping checks passed")


if __name__ == "__main__":
    main()
