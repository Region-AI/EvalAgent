# Architecture

Eval Agent is a two-part system:

- Control plane: FastAPI backend that plans, reasons, and stores results.
- Execution plane: Desktop Runner (local) or a cloud executor (out of repo) that captures the app and performs actions.

## Execution Modes

1. Secure cloud execution
   - Headless VM workflow for CI and regression.
   - Backend enqueues jobs via Redis ARQ.
   - Cloud executor is outside this repository.
2. Interactive local execution
   - Desktop Runner polls for test cases and executes them on a developer machine.
   - Backend performs all perception and reasoning.

## Control Plane (Backend)

The backend owns evaluation state, planning, vision analysis, and persistence.

Key locations (from repo root):

- FastAPI app: `backend/app_evaluation_agent/main.py`
- Worker: `backend/app_evaluation_agent/worker.py`
- API routes: `backend/app_evaluation_agent/api/v1/`
- Services: `backend/app_evaluation_agent/services/`
- Agents: `backend/app_evaluation_agent/services/agents/`
- Vision mapping: `backend/app_evaluation_agent/services/vllm_coordinate_mapper.py`
- Storage: `backend/app_evaluation_agent/storage/`
- Schemas: `backend/app_evaluation_agent/schemas/`

Vision pipeline:

- Runner uploads a PNG screenshot plus agent context.
- AnalyzerAgent calls the vision LLM.
- Model coordinates are remapped to real pixels using VLLMCoordinateMapper.
- Raw model coordinates are preserved for debugging.

Background tasks:

- Redis ARQ worker handles planning, summarization, and cloud queueing.
- Local execution can bypass the queue for responsiveness.

## Desktop Runner

The desktop app is a deterministic executor. It captures screens and executes exactly one backend-selected action per step.

Execution model:

1. Poll `GET /api/v1/testcases/next?executor_id=...`
2. If assigned, fetch the parent evaluation and launch the target app.
3. Step loop:
   - Capture screenshot
   - Assemble execution context
   - POST to `/api/v1/vision/analyze`
   - Receive one action
   - Execute locally
4. Repeat until `finish_task`.
5. Upload final results and mark TestCase complete.

Process split:

- Main process: windows, orchestrator, IPC, native capture.
- Renderer process: UI, logs, timeline, history.
- Preload script: secure IPC boundary.

Capture and execution:

- Native capture uses Windows Desktop Duplication API.
- Actions execute via `@nut-tree-fork/nut-js`.
- Coordinate mapping converts backend coordinates to screen space.

Desktop layout (from repo root):

```
desktop/
  src/
    main.ts
    preload.ts
    config.ts
    core/
    agent/
    api/
    renderer/
  test/
```

## Local Execution Data Flow

1. Runner polls for a pending TestCase.
2. Backend assigns the TestCase and returns evaluation context.
3. Runner captures a screenshot and sends it to the backend.
4. Backend returns a single action.
5. Runner executes the action and updates context.
6. Runner repeats until the backend signals completion.
