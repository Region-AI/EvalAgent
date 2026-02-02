import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app_evaluation_agent.logging_utils import LOG_FILE_PATH

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/export", response_class=FileResponse)
async def export_logs():
    """
    Download the current backend log file written by uvicorn/FastAPI.
    """
    logger.debug("Export logs endpoint invoked; path=%s", LOG_FILE_PATH)
    if not LOG_FILE_PATH.exists():
        logger.debug("Log file not found at %s", LOG_FILE_PATH)
        raise HTTPException(status_code=404, detail="Log file not found")

    logger.debug("Streaming log file %s", LOG_FILE_PATH)
    return FileResponse(
        path=LOG_FILE_PATH,
        media_type="text/plain",
        filename=LOG_FILE_PATH.name,
    )
