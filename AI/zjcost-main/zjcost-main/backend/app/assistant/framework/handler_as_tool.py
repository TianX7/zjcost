"""Handler-as-Tool — wrap any BaseHandler as a PluginDef for orchestrator use.

Core pattern: a parent (Supervisor) handler can invoke
child agents as tools, just like any other tool. This enables hierarchical
multi-handler composition.

Usage:
    from app.assistant.agents.v2 import ValuationHandlerV2, ValidationHandlerV2
    valuation_tool = handler_to_tool(ValuationHandlerV2())
    validation_tool = handler_to_tool(ValidationHandlerV2())
    registry.register_many(valuation_tool, validation_tool)
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.assistant.framework.base_handler import BaseHandler
from app.assistant.framework.budget import TokenBudget
from app.assistant.framework.context import HandlerContext
from app.assistant.framework.plugin_def import ParamDef, PluginDef

logger = logging.getLogger(__name__)


def handler_to_tool(
    handler: BaseHandler,
    *,
    max_turns: int | None = None,
    name_override: str | None = None,
    description_override: str | None = None,
) -> PluginDef:
    """Wrap a BaseHandler instance as a PluginDef.

    The resulting tool accepts a ``task`` string parameter (the instruction
    to the subagent) and returns the subagent's answer as a JSON string.

    Args:
        handler: The handler instance to wrap.
        max_turns: Override max turns for the subagent (default: agent's own).
        name_override: Override the tool name (default: "delegate_{handler.name}").
        description_override: Override the description.

    Returns:
        A PluginDef that, when executed, runs the subagent and returns its result.
    """
    tool_name = name_override or f"delegate_{handler.name}"
    tool_desc = description_override or (
        f"委派任务给「{handler.description}」子Handler。"
        f"传入 task 描述要做的事情，子Handler 会自主完成并返回结果。"
    )
    effective_max_turns = max_turns or handler.max_turns

    def _execute(ctx: HandlerContext, *, task: str) -> str:
        """Run the subagent with a child budget and return a structured receipt."""
        child_budget = TokenBudget(max_turns=effective_max_turns)

        logger.info(
            "Delegating to subagent '%s': %s",
            handler.name,
            task[:100],
        )

        result = handler.run(ctx, task, budget=child_budget)

        # B4: Structured return — give the parent handler enough signal to decide
        # next step WITHOUT re-querying. We surface:
        # - answer: the subagent's final text
        # - steps_summary: compact ordered list of tools used (name + count)
        # - final_state: fresh project snapshot (delegates writes, so parent
        #   should trust this over its own cached state)
        # - success / error / budget_used: diagnostics
        # - tool_calls_made: 0 signals the subagent spun without action →
        #   parent's anti-loop logic can short-circuit
        tool_sequence: list[str] = []
        from collections import Counter
        tool_counter: Counter[str] = Counter()
        for step in result.steps:
            name = getattr(step, "tool_name", None) or ""
            if name:
                tool_sequence.append(name)
                tool_counter[name] += 1
        steps_summary = {
            "total_steps": len(result.steps),
            "sequence": tool_sequence[:10],  # first 10 ordered
            "by_tool": dict(tool_counter.most_common()),
        }

        response: dict[str, Any] = {
            "handler": handler.name,
            "answer": result.answer,
            "success": result.success,
            "tool_calls_made": result.tool_call_count,
            "steps_summary": steps_summary,
            "budget_used": child_budget.summary(),
        }

        # Fresh project snapshot post-delegation so parent isn't stale.
        if getattr(ctx, "project_id", None):
            try:
                from app.models.boq_item import BoqItem
                from collections import Counter as DivCounter
                items = ctx.db.query(BoqItem).filter(
                    BoqItem.project_id == ctx.project_id
                ).all()
                div_counts = DivCounter((i.division or "未分类") for i in items)
                response["final_state"] = {
                    "project_id": ctx.project_id,
                    "boq_items_count": len(items),
                    "by_division": dict(div_counts.most_common(8)),
                }
            except Exception as exc:
                logger.debug("final_state collection failed: %s", exc)

        if result.error:
            response["error"] = result.error
        if result.extra:
            response["extra"] = result.extra

        return json.dumps(response, ensure_ascii=False)

    return PluginDef(
        name=tool_name,
        description=tool_desc,
        parameters=[
            ParamDef(
                name="task",
                json_type="string",
                description="要委派给子Handler的任务描述",
                required=True,
            ),
        ],
        func=_execute,
        read_only=False,
        destructive=False,
        concurrency_safe=False,  # subagents are stateful, run serially
    )
