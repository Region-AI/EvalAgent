# **ENDPOINTS.md — Eval Agent**

This document specifies the **complete and accurate** HTTP API surface exposed by **Eval Agent**, a hierarchical automated test execution system composed of:

* **Coordinator Agent** — expands evaluations into a TestPlan and atomic TestCases
* **Vision Agent** — executes each TestCase step-by-step using LLM reasoning on screenshots
* **Desktop Runners** — poll for tasks and send screenshots to the backend for action selection

Interactive API docs:

* **`/docs`** (Swagger UI)
* **`/redoc`**

---

# **Table of Contents**

* [Apps](#apps)
* [Evaluations](#evaluations)
* [Test Plans](#test-plans)
* [Test Cases](#test-cases)
* [Bugs](#bugs)
* [Vision Execution](#vision-execution)
* [Logs](#logs)
* [Events (WebSocket)](#events-websocket)
* [Events (SSE - Deprecated)](#events-sse---deprecated)
* [Appendix: Data Models](#appendix-data-models)

---

# **Apps**

Apps group versions and evaluations.

---

## **GET /api/v1/apps**

List apps.

Query params:
* `app_type` (optional)
* `search` (optional)
* `limit` (optional, default 50)
* `offset` (optional, default 0)

Returns: `list[AppRead]`.

---

## **POST /api/v1/apps**

Create a new app.

Rules:
* `name` must be unique across all apps.

### Request Body

```json
{
  "name": "Example App",
  "app_type": "desktop_app"
}
```

### Response

```json
{
  "id": 10,
  "name": "Example App",
  "app_type": "desktop_app",
  "created_at": "2025-12-24T10:00:00+00:00"
}
```

---

## **GET /api/v1/apps/{app_id}**

Fetch a single app.

---

## **PATCH /api/v1/apps/{app_id}**

Update app metadata.

Rules:
* `name` must be unique across all apps.

### Request Body

```json
{
  "name": "Example App Renamed",
  "app_type": "web_app"
}
```

---

## **DELETE /api/v1/apps/{app_id}**

Delete an app and all of its child versions and evaluations.

* Returns **`204 No Content`** when the app is deleted
* Returns **`404 Not Found`** if the app does not exist

---

## **GET /api/v1/apps/{app_id}/versions**

List versions for an app.

Query params:
* `limit` (optional, default 50)
* `offset` (optional, default 0)

Returns: `list[AppVersionRead]`.

---

## **GET /api/v1/apps/{app_id}/versions/graph**

Return a lineage graph for all versions of an app.

Returns: `AppVersionGraph`.

Example response:

```json
{
  "nodes": [
    {
      "id": 6,
      "version": "1.0.0",
      "previous_version_id": null,
      "previous_version_ids": [],
      "release_date": "2025-12-20T10:00:00+00:00",
      "change_log": "Initial release."
    },
    {
      "id": 7,
      "version": "1.0.1",
      "previous_version_id": 6,
      "previous_version_ids": [6],
      "release_date": "2025-12-24T10:00:00+00:00",
      "change_log": "Fixed login crash."
    }
  ],
  "edges": [
    { "from_id": 6, "to_id": 7 }
  ],
  "warnings": []
}
```

Notes:
* `edges` represent `previous_version_ids -> id`.
* `warnings` includes missing references or detected cycles.

---

## **POST /api/v1/apps/{app_id}/versions**

Create a version (either URL or upload).

### Form Fields

| Field     | Required | Type   | Description                                  |
| --------- | -------- | ------ | -------------------------------------------- |
| version   | yes      | string | Unique version label                          |
| app_url   | no       | string | Web app URL (use when creating web versions) |
| app_path  | no       | string | Pre-uploaded artifact URI                     |
| file      | no       | file   | App executable to upload                      |
| previous_version_id | no | int | Prior version ID for lineage chaining (legacy) |
| previous_version_ids | no | list[int] | Prior version IDs for lineage (preferred) |
| release_date | no | string | Release timestamp (ISO 8601) |
| change_log | no | string | Summary of changes in this version |

Notes:
* Provide exactly one of `file`, `app_url`, or `app_path`.
* `version` must be unique within the app.

---

## **GET /api/v1/apps/{app_id}/versions/{version_id}**

Fetch a single app version.

---

## **PATCH /api/v1/apps/{app_id}/versions/{version_id}**

Update a version.

Rules:
* `version` must be unique within the app.

### Request Body

```json
{
  "version": "1.0.1",
  "artifact_uri": "s3://builds/my_app_v1_0_1.exe",
  "app_url": null,
  "previous_version_id": 6,
  "previous_version_ids": [6],
  "release_date": "2025-12-24T10:00:00+00:00",
  "change_log": "Fixed login crash and updated settings UI."
}
```

---

## **DELETE /api/v1/apps/{app_id}/versions/{version_id}**

Delete an app version and its evaluations.

* Returns **`204 No Content`** when the version is deleted
* Returns **`404 Not Found`** if the version does not exist

---

## **GET /api/v1/apps/{app_id}/versions/{version_id}/evaluations**

List evaluations for a version.

Query params:
* `limit` (optional, default 50)
* `offset` (optional, default 0)

Returns: `list[EvaluationRead]`.

---

## **POST /api/v1/apps/{app_id}/versions/{version_id}/evaluations**

Create an evaluation for a version.

### Request Body

```json
{
  "execution_mode": "cloud",
  "assigned_executor_id": "runner-01",
  "local_application_path": null,
  "high_level_goal": "Test the login page",
  "run_on_current_screen": false,
  "executor_ids": ["runner-01", "runner-02"]
}
```

Returns: `EvaluationWithTasksRead`.

---


# **Evaluations**

Evaluations represent top-level testing requests such as:

> “Test the login screen”,
> “Verify the checkout flow”,
> “Validate our desktop installer”.

When an evaluation is created:

1. A new **Evaluation** row is inserted
2. The **Coordinator Agent** generates a **TestPlan**
3. Coordinator expands this into a list of **TestCases**
4. Desktop Runners pick up TestCases via polling
5. When all TestCases finish, Coordinator generates a **final summary**

The API always returns evaluations using **`EvaluationWithTasksRead`**, which includes:

* evaluation metadata
* its generated TestCases
* the original `executor_ids` list (“selectable executors”)
* `app_name` and `high_level_goal`

All evaluation creation endpoints require the app to already exist in the app table.

---

## **POST /api/v1/evaluations**

Create a new evaluation using **JSON input**.

Notes:
* The app must already exist in the app table (create via `POST /api/v1/apps` first).

### Request Body — `EvaluationCreate`

```json
{
  "app_id": 10,
  "app_name": "Example App",
  "app_type": "desktop_app",
  "app_version": "1.0.0",
  "app_path": "s3://builds/my_app.exe",
  "app_url": null,
  "execution_mode": "cloud",
  "assigned_executor_id": "runner-01",
  "local_application_path": null,
  "high_level_goal": "Test the login page",
  "run_on_current_screen": false,
  "executor_ids": ["runner-01", "runner-02"]
}
```

### Response — `EvaluationWithTasksRead`

Includes evaluation + generated tasks + executor list.

Example:

```json
{
  "id": 42,
  "app_name": "Example App",
  "status": "READY",
  "execution_mode": "cloud",
  "high_level_goal": "Test the login page",
  "app_path": "s3://builds/my_app.exe",
  "app_url": null,
  "app_version_id": 7,
  "app_version": {
    "id": 7,
    "app_id": 10,
    "version": "1.0.0",
    "artifact_uri": "s3://builds/my_app.exe",
    "app_url": null
  },
  "tasks": [
    {
      "id": 101,
      "plan_id": 7,
      "evaluation_id": 42,
      "name": "Open login page",
      "description": "Navigate to the login page",
      "input_data": {},
      "status": "PENDING",
      "execution_order": 1,
      "assigned_executor_id": "runner-01"
    },
    {
      "id": 102,
      "plan_id": 7,
      "evaluation_id": 42,
      "name": "Verify username field",
      "description": "Ensure username input is present",
      "input_data": null,
      "status": "PENDING",
      "execution_order": 2,
      "assigned_executor_id": "runner-02"
    }
  ],
  "selectable_executor_ids": ["runner-01", "runner-02"]
}
```

---

## **POST /api/v1/evaluations/upload**

Upload a desktop app binary and immediately create an evaluation.

### Form Fields

| Field                | Required | Type     | Description                               |
| -------------------- | -------- | -------- | ----------------------------------------- |
| app_name             | yes      | string   | Application name                          |
| app_version          | yes      | string   | Unique version label                      |
| app_type             | no       | string   | `desktop_app` or `web_app`                |
| file                 | yes      | file     | App executable                            |
| execution_mode       | yes      | string   | `local` or `cloud`                        |
| assigned_executor_id | no       | string   | Required only when execution_mode=`local` |
| application_path     | no       | string   | Override local path                       |
| high_level_goal      | no       | string   | Natural-language task description         |
| executor_ids         | yes      | string[] | Candidate runners                         |

Returns: **`EvaluationWithTasksRead`**

---

## **POST /api/v1/evaluations/url**

Submit a Web application URL.

### Form Fields

| Field                | Required | Type     |
| -------------------- | -------- | -------- |
| app_name             | yes      | string   |
| app_version          | yes      | string   |
| target_url           | yes      | string   |
| execution_mode       | yes      | string   |
| assigned_executor_id | no       | string   |
| high_level_goal      | no       | string   |
| executor_ids         | yes      | string[] |

Returns: **`EvaluationWithTasksRead`**

---

## **POST /api/v1/evaluations/live**

Create an evaluation that uses the **runner’s current screen** (no app file or URL).

### Form Fields

| Field                | Required | Description               |
| -------------------- | -------- | ------------------------- |
| app_name             | yes      | Application name          |
| app_version          | yes      | Unique version label      |
| assigned_executor_id | yes      | Local runner ID           |
| execution_mode       | no       | Defaults to `local`       |
| app_type             | no       | Defaults to `desktop_app` |
| high_level_goal      | no       | Custom goal               |
| executor_ids         | yes      | Candidate runners         |

Returns: **`EvaluationWithTasksRead`**

---

## **GET /api/v1/evaluations/{evaluation_id}**

Retrieve the evaluation and its tasks.

Response shape:

```json
{
  "id": 42,
  "app_name": "Example App",
  "status": "READY",
  "app_version_id": 7,
  "app_path": "s3://builds/my_app.exe",
  "app_url": null,
  "app_version": {
    "id": 7,
    "app_id": 10,
    "version": "1.0.0",
    "artifact_uri": "s3://builds/my_app.exe",
    "app_url": null
  },
  "execution_mode": "local",
  "high_level_goal": "Test the login page",
  "results": null,
  "tasks": [...],
  "selectable_executor_ids": ["runner-01"]
}
```

---

## **PATCH /api/v1/evaluations/{evaluation_id}**

Update evaluation state (usually called after final summarization).

Example:

```json
{
  "status": "COMPLETED",
  "results": {
    "summary": "All login tests passed successfully.",
    "raw_summary": {...}
  }
}
```

---

## **PATCH /api/v1/evaluations/{evaluation_id}/summary**

Replace the evaluation summary stored in results without changing status.

Example:

```json
{
  "summary": "Updated summary text."
}
```

---

## **POST /api/v1/evaluations/{evaluation_id}/regenerate-summary**

Starts summary regeneration for a **COMPLETED** evaluation and returns immediately.

* Returns **`202 Accepted`** with the evaluation in `SUMMARIZING`.
* Returns **`400 Bad Request`** if the evaluation is not in `COMPLETED`.
* Returns **`404 Not Found`** if the evaluation does not exist.

Example response (`EvaluationRead`):

```json
{
  "id": 42,
  "app_name": "Example App",
  "status": "SUMMARIZING",
  "app_version_id": 7,
  "execution_mode": "cloud",
  "high_level_goal": "Test the login page",
  "results": {
    "summary": "Updated regenerated summary text."
  }
}
```

---

## **DELETE /api/v1/evaluations/{evaluation_id}**

Remove an evaluation and all of its generated artifacts (test plans and test cases).

* Returns **`204 No Content`** when the evaluation is deleted
* Returns **`404 Not Found`** if the evaluation does not exist

---

# **Test Plans**

Test plans are created automatically by the Coordinator.

---

## **GET /api/v1/testplans/{plan_id}**

Return a plan + its test cases.

Example:

```json
{
  "id": 7,
  "evaluation_id": 42,
  "status": "READY",
  "summary": {
    "objectives": [
      "Verify login success",
      "Verify invalid credentials error"
    ]
  },
  "test_cases": [
    { "id": 101, "name": "Valid login", "status": "PENDING" },
    { "id": 102, "name": "Invalid password", "status": "PENDING" }
  ]
}
```

### Valid `TestPlanStatus`

* `"PENDING"`
* `"GENERATING"`
* `"READY"`
* `"COMPLETED"`

---

# **Test Cases**

TestCases represent **atomic UI tasks** (ex: “Click submit button”, “Verify error message visible”).

Desktop Runners poll test cases and report completion.

---

## **POST /api/v1/testcases**

Create a new test case under a plan/evaluation.

### Request Body — `TestCaseCreate`

```json
{
  "evaluation_id": 42,
  "plan_id": 7,
  "name": "New step",
  "description": "Describe what to validate",
  "input_data": {},
  "execution_order": 3,
  "assigned_executor_id": "runner-01"
}
```

### Response — `TestCaseRead`

```json
{
  "id": 105,
  "plan_id": 7,
  "evaluation_id": 42,
  "name": "New step",
  "description": "Describe what to validate",
  "input_data": {},
  "status": "PENDING",
  "execution_order": 3,
  "assigned_executor_id": "runner-01"
}
```

---

## **GET /api/v1/testcases/next?executor_id=...**

Fetch the next pending test case for a runner (pending cases are visible to all executors).

* Returns **`200 OK` + TestCaseRead** if a task is available
* Returns **`204 No Content`** if none available

### Example Response

```json
{
  "id": 101,
  "plan_id": 7,
  "evaluation_id": 42,
  "name": "Click login button",
  "description": "Click the login button to submit credentials",
  "input_data": {},
  "status": "PENDING",
  "execution_order": 3,
  "assigned_executor_id": "runner-01"
}
```

> **Note:**
> There is no field `app_launch_path`.
> Runners derive launch paths from the app version metadata.

---

## **PATCH /api/v1/testcases/{testcase_id}**

Update a test case’s status or results.

### Request Body

```json
{
  "status": "COMPLETED",
  "result": {
    "success": true,
    "steps": [
      "Clicked login button",
      "Observed redirected dashboard"
    ]
  }
}
```

When all test cases in a plan become `"COMPLETED"`, the backend automatically runs Coordinator summarization.

Updates may also change `name`, `description`, `input_data`, `execution_order`, and `assigned_executor_id`.

If `result` is provided, the backend runs bug triage for the test case. This may create or update bugs
and will record new bug occurrences based on the result payload.

---

## **DELETE /api/v1/testcases/{testcase_id}**

Delete a test case by ID.

* Returns **`204 No Content`** when deleted
* Returns **`404 Not Found`** if the test case does not exist

---

# **Bugs**

Bug tracking is exposed via REST endpoints and supports branch-scoped fixes.

Concepts:
* A **Bug** is the canonical record (deduped by `fingerprint` per app).
* A **BugOccurrence** links a bug to a specific evaluation/test case/app version.
* A **BugFix** records branch-scoped fixes. A fix only applies to versions that are
  descendants of the `fixed_in_version_id` in the version lineage graph.

Notes:
* If a bug is fixed on a release branch, it is not considered fixed on main
  unless the fix version is a lineage ancestor of main.
* `fixed_in_version_id` is recorded in `bug_fixes`; there is no single global
  `fixed_version_id` field on `bugs`.

---

## **GET /api/v1/apps/{app_id}/bugs**

List bugs for an app.

Query params:
* `status` (optional)
* `severity_level` (optional)
* `app_version_id` (optional)
* `evaluation_id` (optional)
* `test_case_id` (optional)
* `limit` (optional, default 50)
* `offset` (optional, default 0)

Returns: `list[BugRead]`.

---

## **POST /api/v1/bugs**

Create a bug.

### Request Body

```json
{
  "app_id": 10,
  "title": "Login button unresponsive",
  "description": "Clicking login does nothing.",
  "severity_level": "P2",
  "priority": 2,
  "status": "NEW",
  "discovered_version_id": 7,
  "fingerprint": "login-button-noop",
  "environment": { "os": "Windows 11" },
  "reproduction_steps": { "steps": ["Open login", "Click login"] }
}
```

Returns: `BugRead`.

---

## **GET /api/v1/bugs/{bug_id}**

Fetch a bug by ID.

Returns: `BugRead`.

---

## **PATCH /api/v1/bugs/{bug_id}**

Update bug fields.

### Request Body

```json
{
  "status": "IN_PROGRESS",
  "severity_level": "P1",
  "priority": 1
}
```

Returns: `BugRead`.

---

## **DELETE /api/v1/bugs/{bug_id}**

Delete a bug and its occurrences/fixes.

* Returns **`204 No Content`** when deleted
* Returns **`404 Not Found`** if the bug does not exist

---

## **POST /api/v1/bugs/{bug_id}/occurrences**

Add a new occurrence for a bug.

### Request Body

```json
{
  "evaluation_id": 42,
  "test_case_id": 101,
  "app_version_id": 7,
  "step_index": 2,
  "action": { "tool_name": "click_coordinates", "parameters": { "x": 120, "y": 88 } },
  "expected": "Login succeeds",
  "actual": "No response",
  "screenshot_uri": "s3://artifacts/bug_42.png",
  "log_uri": "s3://artifacts/bug_42.log",
  "raw_model_coords": { "x": 0.12, "y": 0.09 },
  "observed_at": "2025-12-24T10:00:00+00:00",
  "executor_id": "runner-01"
}
```

Returns: `BugOccurrenceRead`.

---

## **GET /api/v1/bugs/{bug_id}/occurrences**

List occurrences for a bug.

Query params:
* `evaluation_id` (optional)
* `test_case_id` (optional)
* `app_version_id` (optional)
* `limit` (optional, default 50)
* `offset` (optional, default 0)

Returns: `list[BugOccurrenceRead]`.

---

## **POST /api/v1/bugs/{bug_id}/fixes**

Record a fix for a bug (branch-scoped).

### Request Body

```json
{
  "fixed_in_version_id": 9,
  "verified_by_evaluation_id": 50,
  "note": "Fixed on release branch."
}
```

Returns: `BugFixRead`.

---

## **GET /api/v1/bugs/{bug_id}/fixes**

List fixes for a bug.

Returns: `list[BugFixRead]`.

---

## **DELETE /api/v1/bugs/{bug_id}/fixes/{fix_id}**

Delete a bug fix record.

* Returns **`204 No Content`** when deleted
* Returns **`404 Not Found`** if the bug fix does not exist

---

# **Vision Execution**

The Vision Agent performs actions based on a screenshot + test case context.

No detection models are used.
All perception and action selection is LLM-driven.

The backend automatically maps **model coordinates → screen pixel coordinates** using `image.width × image.height`.

---

## **POST /api/v1/vision/analyze**

Perform a single reasoning/action step.

### Form Fields

| Field        | Required | Description                                   |
| ------------ | -------- | --------------------------------------------- |
| context_json | yes      | AgentContext (goal, history, test_case_id, …) |
| image        | no       | Screenshot PNG; improves reasoning & accuracy |

### Example Response — `VisionAnalysisResponse`

```json
{
  "thought": "I see the username field, I will click it.",
  "action": {
    "tool_name": "click_coordinates",
    "parameters": {
      "x": 412,
      "y": 295,
      "raw_model_coords": { "x": 0.48, "y": 0.37 }
    }
  },
  "description": "clicked username field"
}
```

Notes:

* `image` is optional.
* `x`/`y` are already **pixel coordinates**.
* `raw_model_coords` are preserved for debugging.

---

# **Logs**

## **GET /api/v1/logs/export**

Download backend logs.
Useful for debugging:

* failed test cases
* unexpected LLM outputs
* stalled runners
* database race conditions

---

# **Appendix: Data Models**

## **EvaluationStatus**

* `"PENDING"`
* `"GENERATING"`
* `"ASSIGNED"`
* `"IN_PROGRESS"`
* `"SUMMARIZING"`
* `"READY"`
* `"COMPLETED"`
* `"FAILED"`

(Typical lifecycle: `"PENDING"` -> `"GENERATING"` -> `"READY"` -> task execution -> `"COMPLETED"`/`"FAILED"`.) 

---

## **TestCaseStatus**

* `"PENDING"`
* `"ASSIGNED"`
* `"IN_PROGRESS"`
* `"COMPLETED"`
* `"FAILED"`

---

## **TestPlanStatus**

* `"PENDING"`
* `"GENERATING"`
* `"READY"`
* `"COMPLETED"`

---

## **BugSeverity**

Allowed values and expectations (aligns with product spec):

| Level | Definition          | Response Time      | Example               |
| ----- | ------------------- | ------------------ | --------------------- |
| P0    | Critical blocker    | 24 hours           | Crash on launch       |
| P1    | Severe abnormality  | 3 days             | Payment cannot submit |
| P2    | General abnormality | One iteration      | Button unresponsive   |
| P3    | Minor issue         | Next major release | UI contrast issue     |

Notes:
* Frontend should treat severity as an enum with fixed labels `P0`..`P3`.
* Do not send numeric values or lowercase variants.

---

## **BugStatus**

Allowed values and lifecycle guidance:

| Status               | Meaning                                | Typical Next |
| -------------------- | -------------------------------------- | ------------ |
| NEW                  | Newly created, not yet triaged          | IN_PROGRESS  |
| IN_PROGRESS          | Being investigated or worked on         | PENDING_VERIFICATION |
| PENDING_VERIFICATION | Fix applied, awaiting validation        | CLOSED or REOPENED |
| CLOSED               | Verified and done                       | (terminal)   |
| REOPENED             | Regression or still failing             | IN_PROGRESS  |

Notes:
* Backend does not enforce transition order today, but UI should follow the flow.
* Use uppercase enum values only (no lowercase or spaces).

---

## **GET /api/v1/evaluations/assigned**

List evaluations visible to all executors (newest first).

Query params:
* `executor_id` (optional, ignored for visibility)
* `limit` (optional, default 50)
* `offset` (optional, default 0)

Returns: `list[EvaluationRead]` (includes `app_name` and `high_level_goal`).

Each `EvaluationRead` now includes `app_name`.
Each `EvaluationRead` also includes `high_level_goal`.

---

# **Events (WebSocket)**

## **GET /api/v1/events/ws**

WebSocket endpoint for evaluation status updates.

### Subscribe

Client sends:

```json
{
  "action": "subscribe",
  "channel": "evaluation.status",
  "evaluation_id": 42
}
```

Server responds:

```json
{
  "type": "subscribed",
  "channel": "evaluation.status",
  "evaluation_id": 42
}
```

### Unsubscribe

Client sends:

```json
{
  "action": "unsubscribe",
  "channel": "evaluation.status",
  "evaluation_id": 42
}
```

### Status events

```json
{
  "type": "status",
  "channel": "evaluation.status",
  "evaluation_id": 42,
  "status": "READY",
  "updated_at": "2025-12-19T15:31:00+00:00"
}
```

Terminal statuses also emit:

```json
{
  "type": "close",
  "channel": "evaluation.status",
  "evaluation_id": 42
}
```

### Errors

```json
{
  "type": "error",
  "code": "invalid_request",
  "message": "evaluation_id must be an integer.",
  "evaluation_id": 42
}
```

### Heartbeat

Client sends:

```json
{ "type": "ping" }
```

Server responds:

```json
{ "type": "pong" }
```

---

# **Events (SSE - Deprecated)**

## **GET /api/v1/evaluations/{evaluation_id}/events**

Server-Sent Events stream of evaluation status changes.

### Query Params

* `poll_interval_seconds` (optional, default `2.0`): How often to poll the status internally.
* `max_seconds` (optional, default `300`): Maximum streaming duration before closing.

### Event format

```
event: status
data: READY
```

If the evaluation is missing, an `event: error` is sent and the stream closes.
