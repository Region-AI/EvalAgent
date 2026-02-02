import asyncio
from datetime import datetime
from typing import Dict, Set

from fastapi import WebSocket

from app_evaluation_agent.storage.models import EvaluationStatus

import logging

logger = logging.getLogger(__name__)

CHANNEL_EVALUATION_STATUS = "evaluation.status"
TERMINAL_STATUSES = {EvaluationStatus.COMPLETED, EvaluationStatus.FAILED}


class EvaluationStatusBroadcaster:
    def __init__(self) -> None:
        self._subscriptions: Dict[int, Set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, websocket: WebSocket, evaluation_id: int) -> None:
        async with self._lock:
            self._subscriptions.setdefault(evaluation_id, set()).add(websocket)

    async def unsubscribe(self, websocket: WebSocket, evaluation_id: int) -> None:
        async with self._lock:
            subscribers = self._subscriptions.get(evaluation_id)
            if not subscribers:
                return
            subscribers.discard(websocket)
            if not subscribers:
                self._subscriptions.pop(evaluation_id, None)

    async def remove(self, websocket: WebSocket) -> None:
        async with self._lock:
            for evaluation_id in list(self._subscriptions.keys()):
                subscribers = self._subscriptions.get(evaluation_id)
                if not subscribers:
                    continue
                subscribers.discard(websocket)
                if not subscribers:
                    self._subscriptions.pop(evaluation_id, None)

    async def publish_status(
        self,
        evaluation_id: int,
        status: EvaluationStatus | str,
        updated_at: datetime | None = None,
    ) -> None:
        status_value = getattr(status, "value", status)
        payload = {
            "type": "status",
            "channel": CHANNEL_EVALUATION_STATUS,
            "evaluation_id": evaluation_id,
            "status": status_value,
        }
        if updated_at is not None:
            payload["updated_at"] = updated_at.isoformat()
        await self._broadcast(evaluation_id, payload)
        if status in TERMINAL_STATUSES or status_value in {
            s.value for s in TERMINAL_STATUSES
        }:
            await self._broadcast(
                evaluation_id,
                {
                    "type": "close",
                    "channel": CHANNEL_EVALUATION_STATUS,
                    "evaluation_id": evaluation_id,
                },
            )

    async def _broadcast(self, evaluation_id: int, payload: dict) -> None:
        async with self._lock:
            subscribers = list(self._subscriptions.get(evaluation_id, set()))

        if not subscribers:
            return

        stale: list[WebSocket] = []
        for websocket in subscribers:
            try:
                await websocket.send_json(payload)
                logger.debug("WebSocket sent: %s", payload)
            except Exception:  # noqa: BLE001
                stale.append(websocket)

        if stale:
            async with self._lock:
                for websocket in stale:
                    for eval_id, subs in list(self._subscriptions.items()):
                        if websocket in subs:
                            subs.discard(websocket)
                        if not subs:
                            self._subscriptions.pop(eval_id, None)


evaluation_status_broadcaster = EvaluationStatusBroadcaster()


async def notify_evaluation_status(evaluation) -> None:
    if not evaluation:
        return
    await evaluation_status_broadcaster.publish_status(
        evaluation_id=evaluation.id,
        status=evaluation.status,
        updated_at=getattr(evaluation, "updated_at", None),
    )
