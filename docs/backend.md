# Backend Setup

This directory contains the FastAPI control plane for Eval Agent.

## Prerequisites

- Python 3.10+
- Poetry
- Docker and Docker Compose

## Configure Services

From repo root:

```bash
cp backend/config/settings.example.toml backend/config/settings.toml
cp backend/docker-compose.example.yaml backend/docker-compose.yaml
docker-compose -f backend/docker-compose.yaml up -d
```

Edit `backend/config/settings.toml` and set:

- PostgreSQL URL
- Redis host
- LLM base URL and API key
- Model paths (if applicable)

## Install Dependencies

```bash
cd backend
poetry install
```

## Database Migrations

```bash
cp env.example.py alembic/env.py
poetry run alembic upgrade head
```

## Run the Backend

Terminal 1 (worker):

```bash
arq app_evaluation_agent.worker.WorkerSettings
```

Terminal 2 (API server):

```bash
uvicorn app_evaluation_agent.main:app --reload
```

API docs:

- http://127.0.0.1:8000/docs
- http://127.0.0.1:8000/redoc

## Vision Notes

- The vision LLM works directly on screenshots.
- Backend remaps model coordinates to pixel space.
- Raw model coordinates are preserved for debugging.

## Testing

```bash
cd backend
poetry run pytest tests/test_vllm_coordinate_mapper.py -q
```
