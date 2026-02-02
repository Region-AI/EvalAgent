# Eval Agent

Eval Agent is an automated application evaluation system with a FastAPI control plane and a local Desktop Runner for deterministic execution.

## Components

- Backend (control plane): planning, vision analysis, storage, APIs
- Desktop Runner (execution plane): capture, action execution, UI visualization

## Repo Layout

```
backend/   FastAPI control plane
desktop/   Electron Desktop Runner
docs/      consolidated documentation
```

## Quickstart (Local)

### Backend

```bash
cp backend/config/settings.example.toml backend/config/settings.toml
cp backend/docker-compose.example.yaml backend/docker-compose.yaml
docker-compose -f backend/docker-compose.yaml up -d

cd backend
poetry install
cp env.example.py alembic/env.py
poetry run alembic upgrade head
```

Terminal 1 (worker):

```bash
arq app_evaluation_agent.worker.WorkerSettings
```

Terminal 2 (API server):

```bash
uvicorn app_evaluation_agent.main:app --reload
```

### Desktop Runner

```bash
cp desktop/.env.example desktop/.env
cd desktop
npm install
npm run build
npm start
```

## Documentation

- `docs/overview.md`
- `docs/architecture.md`
- `docs/backend.md`
- `docs/desktop.md`
- `docs/api.md`
- `docs/troubleshooting.md`

## License

Apache 2.0. See `LICENSE`.
