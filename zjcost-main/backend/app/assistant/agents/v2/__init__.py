"""V2 Handlers — migrated to the BaseHandler framework.

These agents replace the hand-rolled loops in the original handler files.
The original files are preserved for backward compatibility during migration.
"""

from app.assistant.agents.v2.valuation_handler_v2 import ValuationHandlerV2
from app.assistant.agents.v2.validation_handler_v2 import ValidationHandlerV2
from app.assistant.agents.v2.chat_handler_v2 import ChatHandlerV2
from app.assistant.agents.v2.boq_handler_v2 import BoqHandlerV2
from app.assistant.agents.v2.query_handler_v2 import QueryHandlerV2
from app.assistant.agents.v2.insight_handler_v2 import InsightHandlerV2
from app.assistant.agents.v2.quota_match_handler_v2 import QuotaMatchHandlerV2
from app.assistant.agents.v2.batch_review_handler_v2 import BatchReviewHandlerV2
from app.assistant.agents.v2.rate_suggestion_handler_v2 import RateSuggestionHandlerV2

# Phase G: Specialized cost agents
from app.assistant.agents.v2.cost_explore_handler import CostExploreHandler
from app.assistant.agents.v2.cost_plan_handler import CostPlanHandler
from app.assistant.agents.v2.cost_validation_handler import CostValidationHandler
from app.assistant.agents.v2.cost_execute_handler import CostExecuteHandler

__all__ = [
    "ValuationHandlerV2",
    "ValidationHandlerV2",
    "ChatHandlerV2",
    "BoqHandlerV2",
    "QueryHandlerV2",
    "InsightHandlerV2",
    "QuotaMatchHandlerV2",
    "BatchReviewHandlerV2",
    "RateSuggestionHandlerV2",
    # Phase G
    "CostExploreHandler",
    "CostPlanHandler",
    "CostValidationHandler",
    "CostExecuteHandler",
]
