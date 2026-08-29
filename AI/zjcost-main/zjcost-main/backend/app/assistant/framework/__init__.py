"""Handler Framework — unified infrastructure for all 辅助 agents.

Provides:
- PluginDef / PluginRegistry: typed tool definitions with metadata
- HandlerContext: runtime context injection (db, project_id, etc.)
- BaseHandler: abstract handler with unified reasoning loop
- TokenBudget: cost control per handler run
- handler_to_tool: wrap any BaseHandler as a PluginDef (Handler-as-Tool pattern)
- Pipeline: sequential multi-handler workflow execution
- LogCollector: automatic observability and cost tracking
- ModelSwitcher: task-based model tier selection
"""

from app.assistant.framework.types import HandlerStep, HandlerResult, StepType
from app.assistant.framework.plugin_def import PluginDef, tool
from app.assistant.framework.plugin_registry import PluginRegistry
from app.assistant.framework.context import HandlerContext
from app.assistant.framework.budget import TokenBudget
from app.assistant.framework.base_handler import BaseHandler
from app.assistant.framework.handler_as_tool import handler_to_tool
from app.assistant.framework.pipeline import Pipeline, Stage, PipelineResult
from app.assistant.framework.log_collector import LogCollector
from app.assistant.framework.model_switcher import route_model, ModelTier

__all__ = [
    "HandlerStep",
    "HandlerResult",
    "StepType",
    "PluginDef",
    "tool",
    "PluginRegistry",
    "HandlerContext",
    "TokenBudget",
    "BaseHandler",
    "handler_to_tool",
    "Pipeline",
    "Stage",
    "PipelineResult",
    "LogCollector",
    "route_model",
    "ModelTier",
]
