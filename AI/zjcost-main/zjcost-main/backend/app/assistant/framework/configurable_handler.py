"""ConfigurableHandler — BaseHandler driven by HandlerDefinition (Phase H1).

This class allows creating a handler entirely from declarative configuration
(a .md file with YAML frontmatter), without subclassing BaseHandler in Python.

Usage:
    from app.assistant.framework.handler_definition import parse_handler_file
    from app.assistant.framework.configurable_handler import ConfigurableHandler

    definition = parse_handler_file("agents/configs/cost_explorer_lite.md")
    handler = ConfigurableHandler(definition)
    result = handler.run(ctx, "search for concrete quotas")
"""

from __future__ import annotations

from app.assistant.framework.handler_definition import HandlerDefinition
from app.assistant.framework.base_handler import BaseHandler
from app.assistant.framework.context import HandlerContext


class ConfigurableHandler(BaseHandler):
    """BaseHandler implementation that reads all its properties from an HandlerDefinition."""

    def __init__(self, definition: HandlerDefinition) -> None:
        super().__init__()
        self._def = definition

    # ── Required BaseHandler properties ──

    @property
    def name(self) -> str:
        return self._def.name

    @property
    def description(self) -> str:
        return self._def.description

    @property
    def system_prompt(self) -> str:
        """Assemble system prompt: [skills bodies] + definition body. (H4)"""
        base = self._def.system_prompt
        if not self._def.skills:
            return base

        from app.assistant.framework.extension_registry import extension_registry

        skills = extension_registry.get_many(self._def.skills, strict=False)
        if not skills:
            return base

        rendered = "\n\n".join(s.render() for s in skills)
        return f"{rendered}\n\n{base}"

    @property
    def tool_names(self) -> list[str]:
        return list(self._def.tool_names)

    @property
    def extension_names(self) -> list[str]:
        """List of declared skill names (from YAML `skills:` field). (H4)"""
        return list(self._def.skills)

    # ── Optional overrides ──

    @property
    def max_turns(self) -> int:
        return self._def.max_turns

    @property
    def read_only(self) -> bool:
        return self._def.read_only

    @property
    def max_tool_concurrency(self) -> int:
        return self._def.max_tool_concurrency

    @property
    def compact_threshold_tokens(self) -> int:
        return self._def.compact_threshold_tokens

    @property
    def use_memory_context(self) -> bool:
        return self._def.use_memory_context

    @property
    def memory_context_limit(self) -> int:
        return self._def.memory_context_limit

    # ── Convenience accessors ──

    @property
    def definition(self) -> HandlerDefinition:
        """Access the underlying HandlerDefinition (read-only)."""
        return self._def

    @property
    def model_tier(self) -> str:
        """Return declared model tier (fast | balanced | powerful)."""
        return self._def.model

    def build_user_message(self, ctx: HandlerContext, instruction: str) -> str:
        """Inject memory context (H3) + project context (F4) + instruction."""
        parts: list[str] = []
        if self.use_memory_context:
            memory_block = self.build_memory_context(ctx)
            if memory_block:
                parts.append(memory_block)
        project_ctx = ctx.build_project_context() if ctx.project_id else ""
        if project_ctx:
            parts.append(project_ctx)
        if instruction:
            parts.append(instruction)
        return "\n\n".join(parts) if parts else instruction

    def __repr__(self) -> str:
        return (
            f"ConfigurableHandler(name={self._def.name!r}, "
            f"tier={self._def.model!r}, "
            f"read_only={self._def.read_only}, "
            f"tools={len(self._def.tool_names)})"
        )
