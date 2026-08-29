"""SSE streaming endpoint for the validation handler."""

from __future__ import annotations

import json
import logging
import queue
import threading
from typing import Generator, Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.assistant.framework.types import HandlerResult, HandlerStep
from app.assistant.agents.v2.validation_handler_v2 import run_validation_handler_v2 as run_validation_handler

logger = logging.getLogger(__name__)

router = APIRouter(tags=["handler"])


class ValidationHandlerRequest(BaseModel):
    scope: str = "full"  # "full" | "item"
    boq_item_id: Optional[int] = None
    question: str = ""


class ValidationStepOut(BaseModel):
    type: str
    content: str = ""
    tool_name: str = ""
    tool_args: dict = {}
    tool_result: str = ""


class ValidationHandlerResponse(BaseModel):
    answer: str
    steps: list[ValidationStepOut]
    issues_found: int = 0
    error: str | None = None


# ── SSE streaming endpoint ──

@router.post(
    "/projects/{project_id}/zh-validate/stream",
)
def zh_validate_stream(
    project_id: int,
    payload: ValidationHandlerRequest | None = None,
):
    """Run validation handler and stream steps via SSE."""
    scope = payload.scope if payload is not None else "full"
    boq_item_id = payload.boq_item_id if payload is not None else None
    question = payload.question if payload is not None else ""

    step_queue: queue.Queue[HandlerStep | None] = queue.Queue()
    result_holder: list[HandlerResult] = []

    def on_step(step: HandlerStep):
        step_queue.put(step)

    def run_agent():
        try:
            result = run_validation_handler(
                project_id=project_id,
                scope=scope,
                boq_item_id=boq_item_id,
                user_question=question,
                on_step=on_step,
            )
            result_holder.append(result)
        except Exception as exc:
            logger.error("Validation handler failed: %s", exc)
            result_holder.append(HandlerResult(
                answer=f"审核Handler执行失败: {exc}",
                error="handler_error",
            ))
        finally:
            step_queue.put(None)

    thread = threading.Thread(target=run_handler, daemon=True)
    thread.start()

    def event_stream() -> Generator[str, None, None]:
        while True:
            step = step_queue.get()
            if step is None:
                if result_holder:
                    r = result_holder[0]
                    final = {
                        "type": "done",
                        "answer": r.answer,
                        "issues_found": (r.extra or {}).get("issues_found", 0),
                        "error": r.error,
                    }
                    yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"
                break

            data = {
                "type": step.type.value if hasattr(step.type, 'value') else step.type,
                "content": step.content,
                "tool_name": step.tool_name,
                "tool_args": step.tool_args,
                "tool_result": step.tool_result,
            }
            yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── Non-streaming endpoint ──

@router.post(
    "/projects/{project_id}/zh-validate",
    response_model=ValidationHandlerResponse,
)
def zh_validate(
    project_id: int,
    payload: ValidationHandlerRequest | None = None,
) -> ValidationHandlerResponse:
    """Run validation handler (non-streaming)."""
    scope = payload.scope if payload is not None else "full"
    boq_item_id = payload.boq_item_id if payload is not None else None
    question = payload.question if payload is not None else ""

    result = run_validation_handler(
        project_id=project_id,
        scope=scope,
        boq_item_id=boq_item_id,
        user_question=question,
    )
    return ValidationHandlerResponse(
        answer=result.answer,
        steps=[
            ValidationStepOut(
                type=s.type.value if hasattr(s.type, 'value') else s.type,
                content=s.content,
                tool_name=s.tool_name,
                tool_args=s.tool_args,
                tool_result=s.tool_result,
            )
            for s in result.steps
        ],
        issues_found=(result.extra or {}).get("issues_found", 0),
        error=result.error,
    )
