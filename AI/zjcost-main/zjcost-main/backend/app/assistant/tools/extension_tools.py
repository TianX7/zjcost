"""Extension tools — let handlers discover and load domain Extensions at runtime (H4).

These tools query the global extension_registry. Useful when an handler needs
to dynamically pull in expertise mid-conversation rather than statically
declaring all extensions in its YAML config.

Tools exposed:
- list_extensions: enumerate all registered extensions (name, title, description)
- load_extension: fetch the full body of a named extension
- match_extensions: find extensions whose triggers match a query / context
"""

from __future__ import annotations

import json
from typing import Any

from app.assistant.framework.context import HandlerContext
from app.assistant.framework.extension_registry import (
    bootstrap_default_extensions,
    extension_registry,
)
from app.assistant.framework.plugin_def import ParamDef, tool
from app.assistant.framework.plugin_registry import registry

# Auto-populate the extension registry from app/assistant/extensions/ on first import.
bootstrap_default_extensions()


def _ok(data: Any) -> str:
    if isinstance(data, dict):
        return json.dumps({"ok": True, **data}, ensure_ascii=False)
    return json.dumps({"ok": True, "result": data}, ensure_ascii=False)


def _err(msg: str) -> str:
    return json.dumps({"ok": False, "error": msg}, ensure_ascii=False)


@tool(
    name="list_extensions",
    description=(
        "列出所有已注册的领域 Extension（知识模块）。"
        " 返回 name/title/description/tags。"
        " 用于发现可以按需加载的专业知识模块。"
    ),
    read_only=True,
    concurrency_safe=True,
)
def list_extensions(ctx: HandlerContext) -> str:
    """List all registered extensions."""
    extensions = extension_registry.all_extensions()
    return _ok({
        "total": len(extensions),
        "extensions": [
            {
                "name": s.name,
                "title": s.title,
                "description": s.description,
                "tags": list(s.tags),
                "version": s.version,
            }
            for s in extensions
        ],
    })


@tool(
    name="load_extension",
    description=(
        "根据 name 加载一个 Extension 的完整知识内容，以文本形式返回。"
        " 适合：Handler 发现需要某个专业领域的详细规则时调用。"
    ),
    read_only=True,
    concurrency_safe=True,
)
def load_extension(ctx: HandlerContext, *, name: str) -> str:
    """Load the full body of a named extension."""
    s = extension_registry.get(name)
    if s is None:
        return _err(f"extension not found: {name}")
    return _ok({
        "name": s.name,
        "title": s.title,
        "description": s.description,
        "tags": list(s.tags),
        "version": s.version,
        "content": s.render(include_meta=False),
    })


@tool(
    name="match_extensions",
    description=(
        "按查询关键词和/或标签，返回匹配的 Extension 名单。"
        " query 会匹配 Extension 的 triggers；tags 要求 Extension 包含全部指定 tag。"
    ),
    read_only=True,
    concurrency_safe=True,
)
def match_extensions(
    ctx: HandlerContext,
    *,
    query: str = "",
    tags: str = "",
) -> str:
    """Match extensions by trigger query and/or tags."""
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None
    if tag_list:
        tag_list = ["general" if t.lower() == "china" else t for t in tag_list]
    matches = extension_registry.match(
        query=query or None,
        tags=tag_list,
    )
    return _ok({
        "total": len(matches),
        "matches": [
            {
                "name": s.name,
                "title": s.title,
                "description": s.description,
                "triggers": list(s.triggers),
                "tags": list(s.tags),
                "score": 1.0,
            }
            for s in matches
        ],
    })


@tool(
    name="match_extensions_semantic",
    description=(
        "按语义相似度匹配 Extension（embedding 检索）。"
        " 比 match_extensions 更辅助：即使触发词不完全匹配，也能找到相关的领域知识。"
        " 必须传入非空 query，内容应为当前任务、问题或检索语句原文。"
        " 返回 {matches: [{name, title, description, score}]}，按相似度降序。"
        " limit 默认 5；min_similarity 默认 0。"
    ),
    read_only=True,
    concurrency_safe=True,
    params=[
        ParamDef(
            name="query",
            json_type="string",
            description="必填。传入当前任务、问题或检索语句，不要留空。",
            required=True,
            aliases=("q", "task", "instruction"),
        ),
        ParamDef(name="limit", json_type="integer", required=False),
        ParamDef(name="min_similarity", json_type="number", required=False),
    ],
)
def match_extensions_semantic(
    ctx: HandlerContext,
    *,
    query: str,
    limit: int = 5,
    min_similarity: float = 0.0,
) -> str:
    """Semantic extension matching via embeddings."""
    if not query:
        return _err("missing required query")
    scored = extension_registry.match_semantic(
        query=query,
        limit=int(limit),
        min_similarity=float(min_similarity),
    )
    return _ok({
        "total": len(scored),
        "matches": [
            {
                "name": s.name,
                "title": s.title,
                "description": s.description,
                "triggers": list(s.triggers),
                "tags": list(s.tags),
                "score": round(score, 4),
            }
            for score, s in scored
        ],
    })


# ── Register ──

registry.register_many(
    list_extensions,
    load_extension,
    match_extensions,
    match_extensions_semantic,
)
