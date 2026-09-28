"""ChatHandlerV2 — migrated to BaseHandler framework.

Replaces the 256-line chat_handler.py with a ~70-line subclass.
All tool implementations now live in app.assistant.tools.chat_tools.
"""

from __future__ import annotations

import json
from typing import Any

from app.assistant.framework.base_handler import BaseHandler
from app.assistant.framework.context import HandlerContext
from app.assistant.framework.types import HandlerResult


class ChatHandlerV2(BaseHandler):
    """Project-aware conversational assistant with tool calling."""

    @property
    def name(self) -> str:
        return "chat_handler"

    @property
    def description(self) -> str:
        return "项目问答 Handler：回答关于清单、定额绑定、计算结果的问题，支持搜索和查询操作"

    @property
    def tool_names(self) -> list[str]:
        return [
            "search_boq",
            "view_bindings",
            "get_project_stats",
        ]

    @property
    def max_turns(self) -> int:
        return 15

    @property
    def system_prompt(self) -> str:
        return (
            "你是工程计价项目的 辅助助手。你可以回答关于项目清单、定额绑定、计算结果的问题，"
            "也可以执行操作如搜索清单、查看绑定、触发计算等。请用中文简洁回答。"
        )

    def build_user_message(self, ctx: HandlerContext, instruction: str) -> str:
        """Inject project summary into user message."""
        project_summary = ctx.metadata.get("project_summary")
        if project_summary:
            summary_text = json.dumps(project_summary, ensure_ascii=False, indent=2)
            return f"当前项目数据摘要：\n{summary_text}\n\n用户问题：{instruction}"
        return instruction


# ── Convenience function matching the old API ──

def chat_with_project_context_v2(
    *,
    message: str,
    history: list[dict[str, str]],
    project_summary: dict[str, Any],
    project_id: int | None = None,
) -> str | None:
    """Drop-in replacement for chat_with_project_context().

    Returns the reply string, or None if 辅助 is unavailable.
    """
    if not project_id:
        return None

    from app.db.session import get_db
    import app.assistant.tools  # noqa: F401

    db = next(get_db())
    try:
        ctx = HandlerContext(
            db=db,
            project_id=project_id,
            metadata={"project_summary": project_summary},
        )
        handler = ChatHandlerV2()
        result = handler.run(ctx, message)
        if result.error:
            return None
        return result.answer
    except Exception:
        return None
    finally:
        db.close()
