"""HandlerLoader — discovers and loads ConfigurableHandler instances from a directory.

Phase H1: Enables hot-loading agents from .md files without Python code changes.

Usage:
    from app.assistant.framework.handler_loader import load_agents_from_dir

    agents = load_agents_from_dir("app/assistant/agents/configs")
    for handler in agents:
        print(agent.name, handler.description)

The loader:
1. Scans a directory for .md files (non-recursive by default)
2. Parses each file into an HandlerDefinition
3. Validates tool references against the global PluginRegistry
4. Returns a list of ConfigurableHandler instances

Invalid files are skipped with a warning (by default) or raise (if strict=True).
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from app.assistant.framework.handler_definition import (
    HandlerDefinition,
    HandlerDefinitionError,
    parse_handler_file,
)
from app.assistant.framework.configurable_handler import ConfigurableHandler
from app.assistant.framework.plugin_registry import PluginRegistry, registry as global_registry

logger = logging.getLogger(__name__)

# Handler files must have snake_case filenames (e.g. `quick_explorer.md`).
# Non-matching files (README.md, NOTES.md, _draft.md) are skipped silently,
# treating them as documentation rather than malformed handler definitions.
_AGENT_FILENAME_RE = re.compile(r"^[a-z][a-z0-9_]*\.md$")


def _is_handler_file(path: Path) -> bool:
    """Return True if filename matches the handler-file convention."""
    return bool(_AGENT_FILENAME_RE.match(path.name))


# ───────────────────────────────────────────────────────────────────
# Loader
# ───────────────────────────────────────────────────────────────────


def load_definitions_from_dir(
    directory: str | Path,
    *,
    recursive: bool = False,
    strict: bool = False,
) -> list[HandlerDefinition]:
    """Scan a directory for .md handler definition files.

    Args:
        directory: Path to the directory containing .md files.
        recursive: If True, recurse into subdirectories.
        strict: If True, raise on any parse error; otherwise log and skip.

    Returns:
        List of successfully parsed HandlerDefinition objects.
    """
    d = Path(directory)
    if not d.is_dir():
        if strict:
            raise HandlerDefinitionError(f"not a directory: {d}")
        logger.warning("handler_loader: directory does not exist: %s", d)
        return []

    pattern = "**/*.md" if recursive else "*.md"
    # Filter to snake_case handler files; skip README.md, NOTES.md, etc.
    files = sorted(f for f in d.glob(pattern) if _is_handler_file(f))
    definitions: list[HandlerDefinition] = []

    for f in files:
        try:
            definitions.append(parse_handler_file(f))
        except HandlerDefinitionError as e:
            if strict:
                raise
            logger.warning("handler_loader: skipping %s: %s", f.name, e)
        except Exception as e:  # pragma: no cover — defensive
            if strict:
                raise
            logger.exception("handler_loader: unexpected error on %s: %s", f.name, e)

    # Detect duplicate names — these are errors regardless of strict mode
    names_seen: dict[str, HandlerDefinition] = {}
    deduped: list[HandlerDefinition] = []
    for defn in definitions:
        if defn.name in names_seen:
            msg = (
                f"duplicate handler name {defn.name!r}: "
                f"{names_seen[defn.name].source_file} vs {defn.source_file}"
            )
            if strict:
                raise HandlerDefinitionError(msg)
            logger.warning("handler_loader: %s (second definition ignored)", msg)
            continue
        names_seen[defn.name] = defn
        deduped.append(defn)

    return deduped


def validate_tool_references(
    definition: HandlerDefinition,
    *,
    plugin_registry: PluginRegistry | None = None,
) -> list[str]:
    """Return missing tool names that are referenced but not registered."""
    reg = plugin_registry or global_registry
    all_tools = set(reg.all_names)
    return [t for t in definition.tool_names if t not in all_tools]


def load_agents_from_dir(
    directory: str | Path,
    *,
    recursive: bool = False,
    strict: bool = False,
    plugin_registry: PluginRegistry | None = None,
) -> list[ConfigurableHandler]:
    """High-level helper: parse + validate + instantiate ConfigurableHandlers.

    Args:
        directory: Directory containing .md files.
        recursive: Recurse into subdirectories.
        strict: Raise on parse errors or missing tool references.
        plugin_registry: Optional custom registry (defaults to global).

    Returns:
        List of ConfigurableHandler instances whose tool references are all valid.
    """
    definitions = load_definitions_from_dir(
        directory, recursive=recursive, strict=strict
    )
    agents: list[ConfigurableHandler] = []
    for defn in definitions:
        missing = validate_tool_references(defn, plugin_registry=plugin_registry)
        if missing:
            msg = (
                f"{defn.source_file}: handler {defn.name!r} references unknown tools: "
                f"{missing}"
            )
            if strict:
                raise HandlerDefinitionError(msg)
            logger.warning("handler_loader: %s — skipping", msg)
            continue
        agents.append(ConfigurableHandler(defn))
    logger.info("handler_loader: loaded %d handler(s) from %s", len(agents), directory)
    return agents
