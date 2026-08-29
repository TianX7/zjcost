"""Model Router — select the optimal model based on task complexity.

Routes handler tasks to appropriate model tiers:
- Tier 1 (fast/cheap): simple queries, normalization, classification
- Tier 2 (balanced): standard analysis, matching, generation
- Tier 3 (powerful): complex reasoning, orchestration, multi-step planning

The router considers:
1. Handler name → default tier mapping
2. Instruction complexity (length, keywords)
3. Cost budget remaining
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ModelTier:
    """Defines a model tier with its characteristics."""
    name: str           # e.g. "fast", "balanced", "powerful"
    level: int          # 1=fast, 2=balanced, 3=powerful
    model_hint: str     # hint for the provider (e.g. "mini", "standard", "premium")
    max_tokens: int     # max output tokens to request
    description: str


# Pre-defined tiers
TIER_FAST = ModelTier(
    name="fast", level=1, model_hint="mini",
    max_tokens=2048,
    description="Fast/cheap model for simple tasks",
)
TIER_BALANCED = ModelTier(
    name="balanced", level=2, model_hint="standard",
    max_tokens=4096,
    description="Balanced model for standard tasks",
)
TIER_POWERFUL = ModelTier(
    name="powerful", level=3, model_hint="premium",
    max_tokens=8192,
    description="Powerful model for complex reasoning",
)

# Handler → default tier mapping
_AGENT_TIER_MAP: dict[str, ModelTier] = {
    # Tier 1 — fast
    "query_handler": TIER_FAST,
    "chat_handler": TIER_FAST,
    "boq_handler": TIER_FAST,
    "cost_explore": TIER_FAST,       # Phase G: read-only search, fastest tier

    # Tier 2 — balanced
    "valuation_handler": TIER_BALANCED,
    "validation_handler": TIER_BALANCED,
    "insight_handler": TIER_BALANCED,
    "quota_match_handler": TIER_BALANCED,
    "batch_review_handler": TIER_BALANCED,
    "rate_suggestion_handler": TIER_BALANCED,
    "cost_plan": TIER_BALANCED,      # Phase G: plan design needs reasoning
    "cost_validation": TIER_BALANCED, # Phase G: adversarial review
    "cost_execute": TIER_BALANCED,    # Phase G: execution with validation

    # Tier 3 — powerful
    "orchestrator": TIER_POWERFUL,
}

# Complexity keywords that bump tier up
_COMPLEXITY_KEYWORDS = {
    "分析", "优化", "对比", "全面", "详细", "深入",
    "策略", "方案", "报告", "审计", "evaluate",
    "analyze", "compare", "comprehensive", "detailed",
}


def route_model(
    handler_name: str,
    instruction: str = "",
    *,
    cost_remaining_cents: float | None = None,
    force_tier: int | None = None,
) -> ModelTier:
    """Select the best model tier for a given handler + instruction.

    Args:
        handler_name: The handler requesting a model.
        instruction: The user instruction (used for complexity heuristic).
        cost_remaining_cents: If set, may downgrade tier to stay in budget.
        force_tier: Override tier (1/2/3) — for testing or user override.

    Returns:
        The selected ModelTier.
    """
    if force_tier is not None:
        tier = {1: TIER_FAST, 2: TIER_BALANCED, 3: TIER_POWERFUL}.get(force_tier, TIER_BALANCED)
        logger.debug("Model route: forced tier %d → %s", force_tier, tier.name)
        return tier

    # Start with handler default
    tier = _AGENT_TIER_MAP.get(handler_name, TIER_BALANCED)

    # Bump up based on instruction complexity
    if instruction:
        complexity_score = _estimate_complexity(instruction)
        if complexity_score >= 3 and tier.level < 3:
            tier = TIER_POWERFUL
        elif complexity_score >= 2 and tier.level < 2:
            tier = TIER_BALANCED

    # Downgrade if cost budget is low
    if cost_remaining_cents is not None and cost_remaining_cents < 1.0:
        if tier.level > 1:
            logger.info("Model route: downgrading %s → fast (budget low: %.2f¢)", tier.name, cost_remaining_cents)
            tier = TIER_FAST

    logger.debug("Model route: handler=%s → tier=%s", handler_name, tier.name)
    return tier


def _estimate_complexity(instruction: str) -> int:
    """Heuristic complexity score (0-4) based on instruction text."""
    score = 0

    # Length-based
    if len(instruction) > 500:
        score += 1
    if len(instruction) > 1000:
        score += 1

    # Keyword-based
    instruction_lower = instruction.lower()
    keyword_hits = sum(1 for kw in _COMPLEXITY_KEYWORDS if kw in instruction_lower)
    if keyword_hits >= 3:
        score += 2
    elif keyword_hits >= 1:
        score += 1

    return min(score, 4)


def get_tier_for_cost(target_cost_cents: float) -> ModelTier:
    """Select the best tier that fits within a target cost budget.

    Rough heuristic: if budget allows, use balanced; if tight, use fast.
    """
    if target_cost_cents >= 5.0:
        return TIER_POWERFUL
    elif target_cost_cents >= 1.0:
        return TIER_BALANCED
    else:
        return TIER_FAST


class ModelSwitcher:
    """模型路由器 — 根据任务复杂度选择最优模型。

    封装 ``route_model`` 函数，提供面向对象的接口。
    返回模型标识符字符串（如 "mini"/"standard"/"premium"），
    可直接传给 provider 的 ``model`` 参数。
    """

    # tier 字符串到 level 的映射
    _TIER_LEVEL: dict[str, int] = {"fast": 1, "balanced": 2, "powerful": 3}

    def route_model(
        self,
        handler_name: str,
        instruction: str = "",
        *,
        tier: str = "balanced",
        cost_remaining_cents: float | None = None,
    ) -> str:
        """选择模型并返回模型标识符。

        Args:
            handler_name: Handler 名称
            instruction: 用户指令（用于复杂度启发式）
            tier: 模型层级 "fast"/"balanced"/"powerful"
            cost_remaining_cents: 剩余预算

        Returns:
            模型标识符字符串（如 "mini"/"standard"/"premium"），
            可直接传给 provider 的 ``model`` 参数。
        """
        force_tier = self._TIER_LEVEL.get(tier, 2)
        model_tier = route_model(
            handler_name,
            instruction,
            cost_remaining_cents=cost_remaining_cents,
            force_tier=force_tier,
        )
        return model_tier.model_hint


# 单例实例，供 BaseHandler 直接导入使用
model_switcher = ModelSwitcher()
