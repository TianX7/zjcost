"""SSE streaming endpoint for the valuation handler.

Streams handler steps (thinking, tool_call, tool_result, answer) as
Server-Sent Events so the frontend can display them in real-time.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
from typing import Generator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.assistant.framework.types import HandlerResult, HandlerStep
from app.assistant.agents.v2.valuation_handler_v2 import run_valuation_handler_v2 as run_valuation_handler

logger = logging.getLogger(__name__)

router = APIRouter(tags=["handler"])


class HandlerValuateRequest(BaseModel):
    instruction: str = ""


class HandlerStepOut(BaseModel):
    type: str
    content: str = ""
    tool_name: str = ""
    tool_args: dict = {}
    tool_result: str = ""


class HandlerValuateResponse(BaseModel):
    answer: str
    steps: list[HandlerStepOut]
    bindings_changed: bool = False
    error: str | None = None


# ── SSE streaming endpoint ──────────────────────────────────────

@router.post(
    "/projects/{project_id}/boq-items/{boq_item_id}/zh-valuate/stream",
)
def zh_valuate_stream(
    project_id: int,
    boq_item_id: int,
    payload: HandlerValuateRequest | None = None,
):
    """Run valuation handler and stream steps via SSE."""
    instruction = payload.instruction if payload is not None else ""

    step_queue: queue.Queue[HandlerStep | None] = queue.Queue()
    result_holder: list[HandlerResult] = []

    def on_step(step: HandlerStep):
        step_queue.put(step)

    def run_agent():
        try:
            result = run_valuation_handler(
                project_id=project_id,
                boq_item_id=boq_item_id,
                user_instruction=instruction,
                on_step=on_step,
            )
            result_holder.append(result)
        except Exception as exc:
            logger.error("Handler run failed: %s", exc)
            result_holder.append(HandlerResult(
                answer=f"Handler 执行失败: {exc}",
                error="handler_error",
            ))
        finally:
            step_queue.put(None)  # sentinel

    thread = threading.Thread(target=run_handler, daemon=True)
    thread.start()

    def event_stream() -> Generator[str, None, None]:
        while True:
            step = step_queue.get()
            if step is None:
                # Send final result
                if result_holder:
                    r = result_holder[0]
                    final = {
                        "type": "done",
                        "answer": r.answer,
                        "bindings_changed": (r.extra or {}).get("bindings_changed", False),
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


# ── Non-streaming endpoint (fallback) ──────────────────────────

@router.post(
    "/projects/{project_id}/boq-items/{boq_item_id}/zh-valuate",
    response_model=HandlerValuateResponse,
)
def zh_valuate(
    project_id: int,
    boq_item_id: int,
    payload: HandlerValuateRequest | None = None,
) -> HandlerValuateResponse:
    """Run valuation handler (non-streaming) and return full result."""
    instruction = payload.instruction if payload is not None else ""
    result = run_valuation_handler(
        project_id=project_id,
        boq_item_id=boq_item_id,
        user_instruction=instruction,
    )
    return HandlerValuateResponse(
        answer=result.answer,
        steps=[
            HandlerStepOut(
                type=s.type.value if hasattr(s.type, 'value') else s.type,
                content=s.content,
                tool_name=s.tool_name,
                tool_args=s.tool_args,
                tool_result=s.tool_result,
            )
            for s in result.steps
        ],
        bindings_changed=(result.extra or {}).get("bindings_changed", False),
        error=result.error,
    )
