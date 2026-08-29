"""辅助 Tools — extracted tool implementations for all agents.

All tools register themselves into the global ToolRegistry on import.
Import this package once at app startup to populate the registry.
"""

from app.assistant.framework.plugin_registry import registry

from app.assistant.tools import quota_tools      # noqa: F401
from app.assistant.tools import validation_tools  # noqa: F401
from app.assistant.tools import chat_tools        # noqa: F401
from app.assistant.tools import boq_tools         # noqa: F401
from app.assistant.tools import memory_tools      # noqa: F401
from app.assistant.tools import extension_tools       # noqa: F401
from app.assistant.tools import project_tools     # noqa: F401
from app.assistant.tools import report_tools      # noqa: F401


def register_all_tools() -> None:
    """Ensure all tool modules are imported and registered.

    Called once at app startup. Idempotent — re-importing is a no-op.
    """
    # The imports above already trigger registration via module-level code.
    pass


__all__ = ["registry", "register_all_tools"]
