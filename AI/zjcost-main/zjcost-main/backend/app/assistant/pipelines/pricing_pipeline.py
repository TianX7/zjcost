"""Full Pricing Pipeline — end-to-end workflow for a BOQ item.

Stage 1: QuotaMatchHandler — search and recommend best quotas
Stage 2: ValuationHandler — bind quotas and calculate unit price
Stage 3: ValidationHandler — validate the binding result
"""

from __future__ import annotations

from app.assistant.agents.v2.quota_match_handler_v2 import QuotaMatchHandlerV2
from app.assistant.agents.v2.validation_handler_v2 import ValidationHandlerV2
from app.assistant.agents.v2.valuation_handler_v2 import ValuationHandlerV2
from app.assistant.framework.pipeline import Pipeline, Stage


def build_pricing_pipeline() -> Pipeline:
    """Build the full pricing pipeline for a single BOQ item.

    Prerequisites: ctx.boq_item_id must be set.

    Flow:
        1. QuotaMatch → find best candidate quotas
        2. Valuation → bind recommended quotas, calculate cost
        3. Validation → check binding quality
    """
    return Pipeline(
        name="full_pricing",
        stages=[
            Stage(
                handler=QuotaMatchHandlerV2(),
                instruction=(
                    "为当前清单项搜索最佳匹配的定额。"
                    "请给出 Top 3 候选定额，包含匹配理由和置信度。"
                ),
                max_turns=5,
            ),
            Stage(
                handler=ValuationHandlerV2(),
                instruction=(
                    "根据前序阶段推荐的定额，为当前清单项完成组价：\n"
                    "1. 绑定推荐的最佳定额（可绑定多条组合定额）\n"
                    "2. 计算综合单价\n"
                    "3. 确认计算结果合理"
                ),
                max_turns=8,
            ),
            Stage(
                handler=ValidationHandlerV2(),
                instruction=(
                    "校验前序阶段的组价结果：\n"
                    "1. 检查绑定的定额是否合理\n"
                    "2. 检查单位一致性\n"
                    "3. 对比同类项目数据\n"
                    "4. 给出最终评价"
                ),
                max_turns=5,
            ),
        ],
        stop_on_error=False,  # Continue even if a stage has issues
    )
