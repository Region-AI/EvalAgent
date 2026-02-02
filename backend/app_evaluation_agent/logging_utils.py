import logging
import os
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path

# Centralized log file configuration for the FastAPI app / uvicorn process.
LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
APP_START_TIME = datetime.now()
LOG_FILE_PATH = LOG_DIR / f"app-{APP_START_TIME:%Y%m%d-%H%M%S}.log"
LOG_LEVEL = os.getenv("APP_LOG_LEVEL", "INFO").upper()
# Allow forcing the file handler to be more verbose than the console.
FILE_LOG_LEVEL = os.getenv("APP_FILE_LOG_LEVEL", "DEBUG").upper()
# Libraries that tend to emit verbose debug logs; disable them entirely.
NOISY_LOGGERS = ("python_multipart", "openai")


def configure_logging() -> None:
    """
    Attach a rotating file handler to the root logger so that uvicorn/FastAPI
    logs get persisted and can be exported via the API.
    """
    root_logger = logging.getLogger()

    # Avoid adding duplicate handlers when the module is imported multiple times.
    has_file_handler = False
    has_console_handler = False
    for handler in root_logger.handlers:
        if getattr(handler, "baseFilename", None) == str(LOG_FILE_PATH):
            has_file_handler = True
        if isinstance(handler, logging.StreamHandler):
            has_console_handler = True
    if has_file_handler and has_console_handler:
        return

    level = getattr(logging, LOG_LEVEL, logging.INFO)
    file_level = getattr(logging, FILE_LOG_LEVEL, logging.DEBUG)

    file_handler = RotatingFileHandler(
        LOG_FILE_PATH, maxBytes=5 * 1024 * 1024, backupCount=3
    )
    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    file_handler.setFormatter(formatter)
    file_handler.setLevel(level)

    if not has_console_handler:
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)
        console_handler.setLevel(level)
        root_logger.addHandler(console_handler)

    if not has_file_handler:
        file_handler.setLevel(file_level)
        root_logger.addHandler(file_handler)

    # Root logger should be at least as verbose as the most verbose handler.
    root_logger.setLevel(min(level, file_level))

    # Quiet overly chatty third-party libraries by disabling their loggers.
    for name in NOISY_LOGGERS:
        noisy_logger = logging.getLogger(name)
        noisy_logger.propagate = False
        noisy_logger.disabled = True
