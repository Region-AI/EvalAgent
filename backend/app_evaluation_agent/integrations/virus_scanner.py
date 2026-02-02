from fastapi import UploadFile, HTTPException
import logging

logger = logging.getLogger(__name__)


async def scan_file_stream(stream: UploadFile) -> bool:
    """
    Scans a file stream for viruses.

    THIS IS A MOCK IMPLEMENTATION. In a real-world scenario, this function
    would stream the file to a service like ClamAV.

    Returns:
        bool: True if the file is clean, raises HTTPException if infected.
    """
    logger.debug("Scanning file stream for viruses: filename=%s", stream.filename)
    logger.warning(
        "--- MOCK VIRUS SCAN ---: Assuming file '%s' is clean.", stream.filename
    )
    # In a real implementation:
    # if clamav.scan(stream):
    #     raise HTTPException(status_code=400, detail="Malware detected in uploaded file.")
    return True
