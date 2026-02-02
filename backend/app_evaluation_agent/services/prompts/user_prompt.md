You are interacting with a real application UI as part of an evaluation.

Below is your current execution context.

---

## High-Level Goal
{high_level_goal}

---

## Current Test Case
ID: {test_case_id}

Description:
{test_case_description}

---

## Action History (oldest → newest)
{action_history}

---

## Last Known Focus
{last_focus}

---

## Previous Thought (Persistent Memory)
{scratchpad}

---

## Decision Task

Based on:
- the current UI state (from the provided image),
- the action history,
- and whether the previous action produced visible results,

determine the **single best next action**.

Before acting, implicitly consider:
- What outcome was expected from the last action?
- Is that outcome now visible?
- If not, is waiting, retrying once, or concluding failure more appropriate?

Guidelines:
- Prefer `wait` or `scroll` when the situation is ambiguous.
- Do NOT repeat completed actions.
- If progress is blocked by missing or broken functionality, use `finish_task`.

Respond using the required JSON format.
Include a concise `description` that clearly states what the action does.
