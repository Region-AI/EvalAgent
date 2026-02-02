import logging
from typing import Any, Optional

from fastapi import File, UploadFile

logger = logging.getLogger(__name__)


def get_optional_file(
    image: Any = File(
        None,
        description="Optional screenshot of the application UI for visual analysis.",
    )
) -> Optional[UploadFile]:
    """
    A dependency that correctly handles optional file uploads from browser clients.

    FastAPI's docs UI sends an empty string ('') for an empty file field.
    This dependency checks if the input is a string and, if so, returns None.
    Otherwise, it returns the valid UploadFile object.

    This makes the endpoint more fault-tolerant.
    """
    if isinstance(image, str) and image == "":
        logger.debug("Optional file was empty string; returning None")
        return None
    logger.debug("Optional file received: %s", getattr(image, "filename", None))
    return image
