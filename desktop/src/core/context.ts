/**
 * AgentExecutionContext
 *
 * A stateful object carried through the entire evaluation workflow.
 * Mirrors the Python version.
 */

export interface AgentExecutionContext {
  /**
   * The agent's current high-level objective (required by backend AgentContext).
   */
  high_level_goal: string;

  /**
   * Human-readable description of the current test case (required by backend).
   */
  test_case_description: string;

  /**
   * Optional copy of the description (ignored by backend but useful internally).
   */
  description?: string;

  /**
   * The LLM's chain-of-thought (external scratchpad).
   * Accumulates across steps so earlier thoughts stay visible.
   */
  scratchpad: string;

  /**
   * A chronological list of action entries for local display
   * (includes tool + parameters, e.g. coords or text).
   */
  action_history: string[];

  /**
   * Optional history of concise, human-readable action descriptions sent
   * to the backend model (e.g., ["clicked username", "entered 'abc'"]).
   * Coordinates are intentionally omitted in this stream to keep the prompt lean.
   */
  action_history_descriptions?: string[];

  /**
   * Optional variable bag for downstream tools (backend defaults to {}).
   */
  variables?: Record<string, any>;

  /**
   * Pixel coordinates (relative to the current screenshot) of the last mouse
   * click executed by the agent. Helps the backend keep track of where the
   * cursor is already focused for typing.
   */
  last_focus?: {
    x: number;
    y: number;
    normalized?: boolean;
    raw_model_coords?: {
      x: number;
      y: number;
      normalized?: boolean;
    };
  } | null;

  /**
   * The TestCase ID the agent is working on.
   * (For backend vision/analyze context_json)
   */
  test_case_id: number;
}
