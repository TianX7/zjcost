"""QueryHandlerV2 — NL query routing with tool-calling capability.

Upgrades the original single-call query_handler to a tool-calling handler
that can search BOQ items, check bindings, and answer data queries.
"""

from __future__ import annotations

from app.assistant.framework.base_handler import BaseHandler
from app.assistant.framework.context import HandlerContext
from app.assistant.framework.types import HandlerResult


class QueryHandlerV2(BaseHandler):
    """Natural language query handler — routes and answers data queries."""

    @property
    def name(self) -> str:
        return "query_handler"

    @property
    def description(self) -> str:
        return "查询路由 Handler：理解自然语言查询意图，搜索清单/绑定/统计数据并返回结果"

    @property
    def tool_names(self) -> list[str]:
        return [
            "query_boq_items",
            "list_unbound_items",
            "view_bindings",
            "get_project_stats",
            "get_divisions_summary",
            "search_boq",
        ]

    @property
    def max_turns(self) -> int:
        return 15

    @property
    def system_prompt(self) -> str:
        return """\
你是工程计价数据查询助手。用户会用自然语言提问关于项目数据的问题。

## 你的能力
- 搜索和筛选清单项（按编码、名称、分部、绑定状态等）
- 查看清单项的定额绑定详情
- 获取项目统计和分部汇总
- 列出未绑定的清单项

## 工作方式
1. 理解用户的查询意图
2. 调用合适的工具获取数据
3. 用简洁易懂的中文总结查询结果

## 输出要求
- 直接回答用户问题，不需要解释查询过程
- 数据较多时用表格或列表格式展示
- 给出关键统计数字
"""

    def build_user_message(self, ctx: HandlerContext, instruction: str) -> str:
        return f"项目ID: {ctx.project_id}\n\n查询: {instruction}"
