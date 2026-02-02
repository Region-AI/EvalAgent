# Desktop Runner

The desktop app is a deterministic executor. It captures the screen, sends context to the backend, and executes exactly one backend-selected action per step.

## Responsibilities

- Capture: native screen capture (Windows Desktop Duplication API)
- Execution: mouse/keyboard actions via `@nut-tree-fork/nut-js`
- Orchestration: TestCase polling, app lifecycle, pause/resume/stop
- Visualization: logs, timeline, history, evaluations

## Configuration

Create `desktop/.env` from the example:

```bash
cp desktop/.env.example desktop/.env
```

Required values:

```
API_BASE_URL=http://127.0.0.1:8000
EXECUTOR_ID=<unique-machine-id>
```

## Build and Run

```bash
cd desktop
npm install
npm run build
npm start
```

Package app:

```bash
npm run make
```

Test native capture:

```bash
npx ts-node test/test-window-capture.ts
```

## Troubleshooting

See `docs/troubleshooting.md`.
