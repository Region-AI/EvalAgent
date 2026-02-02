import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app_evaluation_agent.realtime import (
    CHANNEL_EVALUATION_STATUS,
    evaluation_status_broadcaster,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _parse_evaluation_id(payload: dict[str, Any]) -> int | None:
    evaluation_id = payload.get("evaluation_id")
    if evaluation_id is None:
        return None
    if isinstance(evaluation_id, bool):
        return None
    try:
        return int(evaluation_id)
    except (TypeError, ValueError):
        return None


async def _send_error(
    websocket: WebSocket,
    code: str,
    message: str,
    evaluation_id: int | None = None,
) -> None:
    payload = {"type": "error", "code": code, "message": message}
    if evaluation_id is not None:
        payload["evaluation_id"] = evaluation_id
    await websocket.send_json(payload)
    logger.debug("WebSocket sent: %s", payload)


@router.websocket("/ws")
async def events_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    subscriptions: set[int] = set()

    try:
        while True:
            message = await websocket.receive_json()
            logger.debug("WebSocket received: %s", message)

            if message.get("type") == "ping":
                payload = {"type": "pong"}
                await websocket.send_json(payload)
                logger.debug("WebSocket sent: %s", payload)
                continue

            action = message.get("action")
            if action not in {"subscribe", "unsubscribe"}:
                await _send_error(
                    websocket,
                    code="invalid_request",
                    message="Unsupported action; expected subscribe or unsubscribe.",
                )
                continue

            channel = message.get("channel")
            if channel != CHANNEL_EVALUATION_STATUS:
                await _send_error(
                    websocket,
                    code="invalid_request",
                    message="Unsupported channel.",
                )
                continue

            evaluation_id = _parse_evaluation_id(message)
            if evaluation_id is None:
                await _send_error(
                    websocket,
                    code="invalid_request",
                    message="evaluation_id must be an integer.",
                )
                continue

            if action == "subscribe":
                await evaluation_status_broadcaster.subscribe(websocket, evaluation_id)
                subscriptions.add(evaluation_id)
                payload = {
                    "type": "subscribed",
                    "channel": CHANNEL_EVALUATION_STATUS,
                    "evaluation_id": evaluation_id,
                }
                await websocket.send_json(payload)
                logger.debug("WebSocket sent: %s", payload)
                logger.debug(
                    "WebSocket subscribed to evaluation %s status updates",
                    evaluation_id,
                )
            else:
                await evaluation_status_broadcaster.unsubscribe(
                    websocket, evaluation_id
                )
                subscriptions.discard(evaluation_id)
                payload = {
                    "type": "unsubscribed",
                    "channel": CHANNEL_EVALUATION_STATUS,
                    "evaluation_id": evaluation_id,
                }
                await websocket.send_json(payload)
                logger.debug("WebSocket sent: %s", payload)
                logger.debug(
                    "WebSocket unsubscribed from evaluation %s status updates",
                    evaluation_id,
                )

    except WebSocketDisconnect:
        logger.debug("WebSocket disconnected")
    finally:
        if subscriptions:
            for evaluation_id in list(subscriptions):
                await evaluation_status_broadcaster.unsubscribe(
                    websocket, evaluation_id
                )
        await evaluation_status_broadcaster.remove(websocket)
