import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Dict, Iterable, List, Optional

from app_evaluation_agent.services.agents.llm_client import call_llm
from app_evaluation_agent.services.agents.prompt_loader import (
    load_agent_prompt,
    safe_json_loads,
)

logger = logging.getLogger(__name__)

_SEVERITY_LEVELS = {"P0", "P1", "P2", "P3"}
_DEFAULT_SEVERITY = "P2"
_DEFAULT_STATUS = "NEW"
_STATUS_LEVELS = {
    "NEW",
    "IN_PROGRESS",
    "PENDING_VERIFICATION",
    "CLOSED",
    "REOPENED",
}


@dataclass(frozen=True)
class BugDraft:
    title: str
    description: Optional[str]
    severity_level: str
    priority: Optional[int]
    status: str
    fingerprint: str
    environment: Optional[dict]
    reproduction_steps: Optional[dict]
    expected: Optional[str]
    actual: Optional[str]
    action: Optional[dict]
    result_snapshot: Optional[dict]
    screenshot_uri: Optional[str]
    log_uri: Optional[str]
    raw_model_coords: Optional[dict]
    step_index: Optional[int]
    observed_at: datetime


class BugTriageAgent:
    """LLM-powered triage that extracts 0..N bugs from a test case result."""

    @staticmethod
    def _normalize_severity(value: Optional[str]) -> str:
        if not value:
            return _DEFAULT_SEVERITY
        value = value.strip().upper()
        return value if value in _SEVERITY_LEVELS else _DEFAULT_SEVERITY

    @staticmethod
    def _normalize_status(value: Optional[str]) -> str:
        normalized = (value or _DEFAULT_STATUS).strip().upper()
        return normalized if normalized in _STATUS_LEVELS else _DEFAULT_STATUS

    @staticmethod
    def _safe_json_dump(payload: Any) -> str:
        return json.dumps(payload or {}, ensure_ascii=True, sort_keys=True)

    @staticmethod
    def _hash_fingerprint(seed: Dict[str, Any]) -> str:
        serialized = json.dumps(seed, ensure_ascii=True, sort_keys=True)
        return sha256(serialized.encode("utf-8")).hexdigest()

    @staticmethod
    def _compute_fingerprint(
        app_id: int,
        case_name: str,
        result_payload: Dict[str, Any],
        draft: Dict[str, Any],
    ) -> str:
        action = draft.get("action") or {}
        seed = {
            "app_id": app_id,
            "case_name": case_name or "",
            "title": (draft.get("title") or "").strip().lower(),
            "failure_type": (result_payload.get("failure_type") or "").strip().lower(),
            "expected": (draft.get("expected") or "").strip().lower(),
            "actual": (draft.get("actual") or "").strip().lower(),
            "action_tool": (action.get("tool_name") or "").strip().lower(),
        }
        return BugTriageAgent._hash_fingerprint(seed)

    @staticmethod
    def _normalize_draft(
        app_id: int,
        case_name: str,
        result_payload: Dict[str, Any],
        draft: Dict[str, Any],
        observed_at: datetime,
    ) -> Optional[BugDraft]:
        if not isinstance(draft, dict):
            return None

        title = (draft.get("title") or "").strip()
        description = (draft.get("description") or "").strip() or None

        if not title:
            if description:
                title = description[:80]
            else:
                return None

        fingerprint = (draft.get("fingerprint") or "").strip()
        if not fingerprint:
            fingerprint = BugTriageAgent._compute_fingerprint(
                app_id=app_id,
                case_name=case_name,
                result_payload=result_payload,
                draft=draft,
            )

        return BugDraft(
            title=title,
            description=description,
            severity_level=BugTriageAgent._normalize_severity(
                draft.get("severity_level")
            ),
            priority=draft.get("priority"),
            status=BugTriageAgent._normalize_status(draft.get("status")),
            fingerprint=fingerprint,
            environment=draft.get("environment"),
            reproduction_steps=draft.get("reproduction_steps"),
            expected=draft.get("expected"),
            actual=draft.get("actual"),
            action=draft.get("action"),
            result_snapshot=draft.get("result_snapshot"),
            screenshot_uri=draft.get("screenshot_uri"),
            log_uri=draft.get("log_uri"),
            raw_model_coords=draft.get("raw_model_coords"),
            step_index=draft.get("step_index"),
            observed_at=observed_at,
        )

    @staticmethod
    async def triage_test_case(
        *,
        app_id: int,
        case_name: str,
        case_description: Optional[str],
        case_status: str,
        result_payload: Dict[str, Any],
        evaluation_context: Dict[str, Any],
    ) -> List[BugDraft]:
        system_prompt = load_agent_prompt("bug_triage", "system_prompt.md")
        user_template = load_agent_prompt("bug_triage", "user_prompt.md")

        if not system_prompt or not user_template:
            logger.warning("Bug triage prompts missing; skipping triage.")
            return []

        user_prompt = user_template.format(
            case_name=case_name or "",
            case_description=case_description or "",
            case_status=case_status or "",
            evaluation_context=BugTriageAgent._safe_json_dump(evaluation_context),
            result_payload=BugTriageAgent._safe_json_dump(result_payload),
        )

        llm_content = await call_llm(
            system_prompt=system_prompt, user_prompt=user_prompt
        )
        parsed = safe_json_loads(llm_content)

        if isinstance(parsed, dict) and isinstance(parsed.get("bugs"), list):
            raw_bugs = parsed.get("bugs", [])
        elif isinstance(parsed, list):
            raw_bugs = parsed
        else:
            raw_bugs = []

        observed_at = datetime.now(timezone.utc)
        drafts: List[BugDraft] = []
        for raw in raw_bugs:
            draft = BugTriageAgent._normalize_draft(
                app_id=app_id,
                case_name=case_name,
                result_payload=result_payload,
                draft=raw,
                observed_at=observed_at,
            )
            if draft:
                drafts.append(draft)

        logger.debug(
            "Bug triage produced %s bug(s) for case=%s",
            len(drafts),
            case_name,
        )
        return drafts
