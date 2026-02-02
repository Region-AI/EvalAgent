import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import InterfaceError
from sqlalchemy.ext.asyncio import AsyncSession

from app_evaluation_agent.schemas.evaluation import (
    EvaluationCreate,
    EvaluationRead,
    EvaluationSummaryUpdate,
    EvaluationUpdate,
    EvaluationWithTasksRead,
)
from app_evaluation_agent.services import evaluations as evaluation_service
from app_evaluation_agent.storage.database import AsyncSessionLocal, get_db_session

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/assigned", response_model=list[EvaluationRead])
async def list_assigned_evaluations(
    executor_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db_session),
):
    """
    List evaluations visible to all executors, newest first.
    """
    evaluations = await evaluation_service.list_evaluations_for_executor(
        db=db, executor_id=executor_id, limit=limit, offset=offset
    )
    return evaluations


@router.post("/", response_model=EvaluationWithTasksRead, status_code=202)
async def request_evaluation(
    evaluation_in: EvaluationCreate,  # accepts app info + version
    db: AsyncSession = Depends(get_db_session),
):
    """Accepts an evaluation request, creates a job record."""
    logger.debug(
        "Received evaluation request: app=%s version=%s mode=%s executor=%s",
        evaluation_in.app_id or evaluation_in.app_name,
        evaluation_in.app_version,
        evaluation_in.execution_mode,
        evaluation_in.assigned_executor_id,
    )
    try:
        new_evaluation = await evaluation_service.create_evaluation(db, evaluation_in)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # Fire-and-forget plan/test case generation
    evaluation_service.launch_bootstrap_plan_and_cases(
        new_evaluation.id, evaluation_in.executor_ids
    )
    return await evaluation_service.get_evaluation_with_tasks(
        db=db,
        evaluation=new_evaluation,
        selectable_executor_ids=evaluation_in.executor_ids,
    )


@router.post("/upload", response_model=EvaluationWithTasksRead, status_code=202)
async def request_evaluation_with_upload(
    db: AsyncSession = Depends(get_db_session),
    app_name: str = Form(..., description="Display name for the application."),
    app_version: str = Form(..., description="Unique version label for this app."),
    app_type: Literal["desktop_app", "web_app"] = Form(
        "desktop_app", description="Type of app under test."
    ),
    execution_mode: str = Form(...),
    assigned_executor_id: str | None = Form(None),
    application_path: str | None = Form(None),
    high_level_goal: str | None = Form(None),
    executor_ids: list[str] = Form(
        ..., description="Candidate executor IDs that may be assigned tasks."
    ),
    file: UploadFile = File(...),
):
    """
    Accepts a file upload, scans it, stores it, and creates a job (desktop app).
    """
    logger.debug(
        "Received evaluation upload: file=%s app=%s version=%s mode=%s executor=%s local_path=%s",
        file.filename,
        app_name,
        app_version,
        execution_mode,
        assigned_executor_id,
        application_path,
        high_level_goal,
    )
    goal = high_level_goal.strip() if high_level_goal else None
    try:
        new_evaluation = await evaluation_service.create_evaluation_from_upload(
            db=db,
            file=file,
            execution_mode=execution_mode,
            executor_id=assigned_executor_id,
            local_path=application_path,
            high_level_goal=goal,
            executor_ids=executor_ids,
            app_name=app_name,
            app_version=app_version,
            app_type=app_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    evaluation_service.launch_bootstrap_plan_and_cases(new_evaluation.id, executor_ids)

    return await evaluation_service.get_evaluation_with_tasks(
        db=db,
        evaluation=new_evaluation,
        selectable_executor_ids=executor_ids,
    )


@router.post("/url", response_model=EvaluationWithTasksRead, status_code=202)
async def request_evaluation_for_url(
    db: AsyncSession = Depends(get_db_session),
    app_name: str = Form(..., description="Display name for the application."),
    app_version: str = Form(..., description="Unique version label for this app."),
    target_url: str = Form(
        ..., description="HTTP/HTTPS URL of the web app under test."
    ),
    execution_mode: str = Form(..., description="'cloud' or 'local'"),
    assigned_executor_id: str | None = Form(None),
    high_level_goal: str | None = Form(None),
    executor_ids: list[str] = Form(
        ..., description="Candidate executor IDs that may be assigned tasks."
    ),
):
    """
    Accepts a web app URL and creates an evaluation job (web app).
    """
    # basic URL validation
    if not target_url.lower().startswith(("http://", "https://")):
        logger.debug("Invalid URL supplied for evaluation: %s", target_url)
        raise HTTPException(
            status_code=400, detail="Invalid URL: must start with http:// or https://"
        )

    logger.debug(
        "Received URL evaluation request: app=%s version=%s url=%s mode=%s executor=%s",
        app_name,
        app_version,
        target_url,
        execution_mode,
        assigned_executor_id,
    )
    goal = high_level_goal.strip() if high_level_goal else None

    evaluation_in = EvaluationCreate(
        app_name=app_name,
        app_version=app_version,
        app_url=target_url,
        app_type="web_app",
        execution_mode=execution_mode,
        assigned_executor_id=assigned_executor_id,
        high_level_goal=goal,
        executor_ids=executor_ids,
    )
    try:
        new_evaluation = await evaluation_service.create_evaluation(db, evaluation_in)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    evaluation_service.launch_bootstrap_plan_and_cases(new_evaluation.id, executor_ids)
    # Queue only cloud jobs
    return await evaluation_service.get_evaluation_with_tasks(
        db=db,
        evaluation=new_evaluation,
        selectable_executor_ids=executor_ids,
    )


@router.post("/live", response_model=EvaluationWithTasksRead, status_code=202)
async def request_live_screen_evaluation(
    db: AsyncSession = Depends(get_db_session),
    app_name: str = Form(..., description="Display name for the application."),
    app_version: str = Form(..., description="Unique version label for this app."),
    assigned_executor_id: str = Form(
        ...,
        description="Identifier for the local agent to attach to the user's current screen.",
    ),
    execution_mode: str = Form(
        "local", description="Must be 'local' to operate on the user's current screen."
    ),
    app_type: Literal["desktop_app", "web_app"] = Form(
        "desktop_app", description="Type of app currently in view."
    ),
    high_level_goal: str | None = Form(None),
    executor_ids: list[str] = Form(
        ..., description="Candidate executor IDs that may be assigned tasks."
    ),
):
    """
    Create an evaluation that attaches to the client's existing screen session.
    No upload or URL is required; the local runner should immediately operate on
    the current UI for the provided executor_id.
    """
    if execution_mode != "local":
        logger.debug(
            "Live-screen request rejected because execution_mode=%s", execution_mode
        )
        raise HTTPException(
            status_code=400,
            detail="Live-screen evaluations require execution_mode='local'.",
        )

    goal = high_level_goal.strip() if high_level_goal else None
    evaluation_in = EvaluationCreate(
        app_name=app_name,
        app_version=app_version,
        app_type=app_type,
        execution_mode=execution_mode,
        assigned_executor_id=assigned_executor_id,
        high_level_goal=goal,
        run_on_current_screen=True,
        executor_ids=executor_ids,
    )
    try:
        new_evaluation = await evaluation_service.create_evaluation(db, evaluation_in)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    logger.debug(
        "Live-screen evaluation %s created for executor=%s",
        new_evaluation.id,
        assigned_executor_id,
    )
    evaluation_service.launch_bootstrap_plan_and_cases(new_evaluation.id, executor_ids)
    return await evaluation_service.get_evaluation_with_tasks(
        db=db,
        evaluation=new_evaluation,
        selectable_executor_ids=executor_ids,
    )


@router.get("/{evaluation_id}", response_model=EvaluationWithTasksRead)
async def get_evaluation_status(
    evaluation_id: int, db: AsyncSession = Depends(get_db_session)
):
    """
    Retrieves the status and details of a specific evaluation job.
    """
    logger.debug("Fetching evaluation status for id=%s", evaluation_id)
    evaluation = await evaluation_service.get_evaluation(db, evaluation_id)
    if not evaluation:
        logger.debug("Evaluation not found for id=%s", evaluation_id)
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return await evaluation_service.get_evaluation_with_tasks(
        db=db,
        evaluation=evaluation,
        selectable_executor_ids=[],
    )


@router.patch("/{evaluation_id}", response_model=EvaluationRead)
async def update_evaluation_status(
    evaluation_id: int,
    update_data: EvaluationUpdate,
    db: AsyncSession = Depends(get_db_session),
):
    """
    Allows a runner to update the status and results of an evaluation.
    """
    logger.debug(
        "Updating evaluation %s with status=%s has_results=%s",
        evaluation_id,
        update_data.status,
        update_data.results is not None,
    )
    updated_evaluation = await evaluation_service.update_evaluation(
        db, evaluation_id, update_data
    )
    if not updated_evaluation:
        logger.debug("Update failed because evaluation %s was not found", evaluation_id)
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return updated_evaluation


@router.patch("/{evaluation_id}/summary", response_model=EvaluationRead)
async def update_evaluation_summary(
    evaluation_id: int,
    update_data: EvaluationSummaryUpdate,
    db: AsyncSession = Depends(get_db_session),
):
    """
    Replace the evaluation summary stored inside results.
    """
    updated_evaluation = await evaluation_service.update_evaluation_summary(
        db, evaluation_id, update_data.summary
    )
    if not updated_evaluation:
        logger.debug(
            "Summary update failed because evaluation %s was not found",
            evaluation_id,
        )
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return updated_evaluation


@router.post(
    "/{evaluation_id}/regenerate-summary",
    response_model=EvaluationRead,
    status_code=202,
)
async def regenerate_evaluation_summary(
    evaluation_id: int, db: AsyncSession = Depends(get_db_session)
):
    """
    Re-run the final summary generation for a completed evaluation.
    """
    try:
        regenerated = await evaluation_service.regenerate_summary(db, evaluation_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not regenerated:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return regenerated


@router.delete("/{evaluation_id}", status_code=204)
async def delete_evaluation(
    evaluation_id: int, db: AsyncSession = Depends(get_db_session)
):
    """
    Delete an evaluation and all associated test plans and test cases.
    """
    logger.debug("Deleting evaluation id=%s", evaluation_id)
    deleted = await evaluation_service.delete_evaluation(db, evaluation_id)
    if not deleted:
        logger.debug("Delete failed because evaluation %s was not found", evaluation_id)
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return Response(status_code=204)


@router.get("/{evaluation_id}/events")
async def stream_evaluation_events(
    evaluation_id: int,
    poll_interval_seconds: float = 2.0,
    max_seconds: int = 300,
):
    """
    Server-Sent Events stream for evaluation status updates.

    Emits `status` events whenever the evaluation status changes.
    Closes once a terminal status is reached or the timeout elapses.
    """

    async def event_generator():
        last_status = None
        elapsed = 0.0
        terminal_statuses = {"FAILED"}

        while elapsed <= max_seconds:
            try:
                async with AsyncSessionLocal() as db:
                    evaluation = await evaluation_service.get_evaluation(
                        db, evaluation_id
                    )
                    if not evaluation:
                        logger.debug("SSE: evaluation %s not found", evaluation_id)
                        yield "event: error\ndata: Evaluation not found\n\n"
                        return

                    try:
                        await db.refresh(evaluation)
                    except Exception:
                        logger.debug(
                            "Could not refresh evaluation %s during SSE polling",
                            evaluation_id,
                        )

                    status = getattr(evaluation.status, "value", str(evaluation.status))
                    if status != last_status:
                        logger.debug(
                            "SSE: evaluation %s status change %s -> %s",
                            evaluation_id,
                            last_status,
                            status,
                        )
                        yield f"event: status\ndata: {status}\n\n"
                        last_status = status
                        if status in terminal_statuses:
                            return
            except InterfaceError:
                logger.exception(
                    "SSE: database connection error while polling evaluation %s",
                    evaluation_id,
                )
                yield "event: error\ndata: Database connection closed\n\n"
                return
            except Exception:
                logger.exception(
                    "SSE: unexpected error while polling evaluation %s",
                    evaluation_id,
                )
                yield "event: error\ndata: Unexpected server error\n\n"
                return

            await asyncio.sleep(poll_interval_seconds)
            elapsed += poll_interval_seconds

    return StreamingResponse(event_generator(), media_type="text/event-stream")
