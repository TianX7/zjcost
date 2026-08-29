"""Audit Pipeline — end-to-end project quality audit.

Stage 1: BatchReviewHandler — scan all bindings for issues
Stage 2: InsightHandler — analyze cost structure and anomalies
Stage 3: ValidationHandler — deep-dive on critical issues
"""

from __future__ import annotations

import json
import os
import time
from collections import Counter, defaultdict

from sqlalchemy.orm import Session

from app.assistant.agents.v2.batch_review_handler_v2 import BatchReviewHandlerV2
from app.assistant.agents.v2.insight_handler_v2 import InsightHandlerV2
from app.assistant.agents.v2.validation_handler_v2 import ValidationHandlerV2
from app.assistant.framework.context import HandlerContext
from app.assistant.framework.pipeline import Pipeline, Stage
from app.assistant.framework.pipeline import PipelineResult, StageResult
from app.assistant.framework.types import HandlerResult
from app.models.audit_log import AuditLog
from app.models.boq_item import BoqItem
from app.models.calc_result import CalcResult
from app.models.line_item_quota_binding import LineItemQuotaBinding
from app.models.project import Project
from app.services.audit_service import write_audit_log
from app.services.validation_service import Severity, validate_project


def build_audit_pipeline() -> Pipeline:
    """Build the project audit pipeline.

    Prerequisites: ctx.project_id must be set.

    Flow:
        1. BatchReview → scan all bindings, find issues
        2. Insight → analyze cost structure, detect anomalies
        3. Validation → deep-dive on worst issues
    """
    return Pipeline(
        name="project_audit",
        stages=[
            Stage(
                handler=BatchReviewHandlerV2(),
                instruction=(
                    "对项目执行全面的绑定扫描审查：\n"
                    "1. 扫描所有绑定问题\n"
                    "2. 统计绑定覆盖率\n"
                    "3. 列出最严重的问题"
                ),
                max_turns=6,
            ),
            Stage(
                handler=InsightHandlerV2(),
                instruction=(
                    "基于前序审查结果，进一步分析项目造价：\n"
                    "1. 分析费用结构是否合理\n"
                    "2. 检查各分部造价占比\n"
                    "3. 识别成本风险点"
                ),
                max_turns=5,
            ),
            Stage(
                handler=ValidationHandlerV2(),
                instruction=(
                    "基于前序审查和分析结果，对最严重的问题进行深入校验：\n"
                    "1. 对标准编码合规性问题逐一核查\n"
                    "2. 对消耗量异常项做详细分析\n"
                    "3. 给出最终审计结论和风险评级"
                ),
                max_turns=6,
            ),
        ],
        stop_on_error=False,
    )


def run_audit_pipeline(ctx: HandlerContext) -> PipelineResult:
    """Run the 辅助 audit pipeline with a deterministic local fallback.

    The product must remain useful in packaged/offline mode. When the 辅助
    provider is not configured, the handler pipeline returns failed stages instead
    of an exception; we convert that into a local rules-based audit so the UI can
    still complete the workflow and leave an audit trail.
    """
    mode = os.getenv("ZH_AUDIT_PIPELINE_MODE", "local").strip().lower()
    if mode not in {"handler", "zh"}:
        result = build_local_audit_result(ctx)
        _write_pipeline_log(ctx, result, mode="local")
        return result

    result = build_audit_pipeline().run(ctx)
    if result.success:
        _write_pipeline_log(ctx, result, mode="zh")
        return result

    fallback = build_local_audit_result(ctx, upstream=result)
    _write_pipeline_log(ctx, fallback, mode="local_fallback", upstream=result)
    return fallback


def build_local_audit_result(
    ctx: HandlerContext,
    *,
    upstream: PipelineResult | None = None,
) -> PipelineResult:
    start = time.time()
    db = ctx.db
    project_id = ctx.project_id or 0
    project = db.query(Project).filter(Project.id == project_id).first()
    boq_items = (
        db.query(BoqItem)
        .filter(BoqItem.project_id == project_id)
        .order_by(BoqItem.sort_order, BoqItem.id)
        .all()
    )
    boq_ids = [item.id for item in boq_items]
    binding_counts = _binding_counts(db, boq_ids)
    calc_map = _latest_calc_results(db, boq_ids)
    validation_issues = validate_project(project_id=project_id, db=db)

    context = _LocalAuditContext(
        project=project,
        boq_items=boq_items,
        binding_counts=binding_counts,
        calc_map=calc_map,
        validation_issues=validation_issues,
    )

    stage_answers = [
        ("local_binding_audit", _summarize_binding_audit(context)),
        ("local_cost_audit", _summarize_cost_audit(context)),
        ("local_validation_audit", _summarize_validation_audit(context)),
    ]

    stages = [
        StageResult(
            stage_index=index,
            handler_name=handler_name,
            result=HandlerResult(answer=answer, extra={"mode": "local_fallback"}),
            duration_s=0.0,
        )
        for index, (handler_name, answer) in enumerate(stage_answers)
    ]
    final_answer = _summarize_final_audit(context, upstream=upstream)
    return PipelineResult(
        pipeline_name="project_audit",
        stages=stages,
        final_answer=final_answer,
        total_duration_s=time.time() - start,
    )


class _LocalAuditContext:
    def __init__(
        self,
        *,
        project: Project | None,
        boq_items: list[BoqItem],
        binding_counts: dict[int, int],
        calc_map: dict[int, CalcResult],
        validation_issues: list,
    ) -> None:
        self.project = project
        self.boq_items = boq_items
        self.binding_counts = binding_counts
        self.calc_map = calc_map
        self.validation_issues = validation_issues

    @property
    def boq_count(self) -> int:
        return len(self.boq_items)

    @property
    def bound_count(self) -> int:
        return sum(1 for item in self.boq_items if self.binding_counts.get(item.id, 0) > 0)

    @property
    def unbound_count(self) -> int:
        return max(self.boq_count - self.bound_count, 0)

    @property
    def dirty_count(self) -> int:
        return sum(1 for item in self.boq_items if item.is_dirty)

    @property
    def calc_total(self) -> float:
        return sum((calc.total_cost or 0.0) for calc in self.calc_map.values())

    @property
    def missing_calc_count(self) -> int:
        return sum(1 for item in self.boq_items if item.id not in self.calc_map)

    @property
    def error_count(self) -> int:
        return sum(1 for issue in self.validation_issues if issue.severity == Severity.ERROR)

    @property
    def warning_count(self) -> int:
        return sum(1 for issue in self.validation_issues if issue.severity == Severity.WARNING)

    @property
    def info_count(self) -> int:
        return sum(1 for issue in self.validation_issues if issue.severity == Severity.INFO)

    @property
    def risk_level(self) -> str:
        if self.error_count > 0 or _budget_deviation_ratio(self) >= 3:
            return "高"
        if self.warning_count > 0 or self.unbound_count > 0 or self.dirty_count > 0:
            return "中"
        return "低"


def _binding_counts(db: Session, boq_ids: list[int]) -> dict[int, int]:
    if not boq_ids:
        return {}
    counts: dict[int, int] = defaultdict(int)
    rows = (
        db.query(LineItemQuotaBinding.boq_item_id)
        .filter(LineItemQuotaBinding.boq_item_id.in_(boq_ids))
        .all()
    )
    for (boq_item_id,) in rows:
        counts[boq_item_id] += 1
    return dict(counts)


def _latest_calc_results(db: Session, boq_ids: list[int]) -> dict[int, CalcResult]:
    if not boq_ids:
        return {}
    rows = (
        db.query(CalcResult)
        .filter(CalcResult.boq_item_id.in_(boq_ids))
        .order_by(CalcResult.boq_item_id, CalcResult.id)
        .all()
    )
    latest: dict[int, CalcResult] = {}
    for row in rows:
        latest[row.boq_item_id] = row
    return latest


def _summarize_binding_audit(ctx: _LocalAuditContext) -> str:
    if ctx.boq_count == 0:
        return "项目暂无清单项，需先完成图纸/IFC/清单接入后再审计定额绑定。"

    code_counts = Counter(item.code for item in ctx.boq_items)
    duplicate_codes = [code for code, count in code_counts.items() if count > 1]
    division_counts = Counter(item.division or "未分类" for item in ctx.boq_items)
    binding_rate = ctx.bound_count / ctx.boq_count * 100 if ctx.boq_count else 0.0
    top_divisions = "、".join(
        f"{name}{count}项" for name, count in division_counts.most_common(5)
    )
    parts = [
        f"清单 {ctx.boq_count} 项，已绑定定额 {ctx.bound_count} 项，绑定率 {binding_rate:.1f}%。",
        f"未绑定 {ctx.unbound_count} 项，待重算 {ctx.dirty_count} 项。",
    ]
    if duplicate_codes:
        parts.append(f"发现重复编码 {len(duplicate_codes)} 个：{', '.join(duplicate_codes[:8])}。")
    if top_divisions:
        parts.append(f"主要分部：{top_divisions}。")
    if ctx.unbound_count:
        parts.append("建议优先处理未绑定项，再执行增量重算，避免造价汇总缺项。")
    return "\n".join(parts)


def _summarize_cost_audit(ctx: _LocalAuditContext) -> str:
    total = ctx.calc_total
    budget = float(ctx.project.budget or 0) if ctx.project else 0.0
    division_costs: dict[str, float] = defaultdict(float)
    for item in ctx.boq_items:
        calc = ctx.calc_map.get(item.id)
        if calc:
            division_costs[item.division or "未分类"] += calc.total_cost or 0.0

    parts = [
        f"当前已计算造价 {_fmt_money(total)}，缺少计算结果 {ctx.missing_calc_count} 项。",
    ]
    if budget > 0 and total > 0:
        diff = total - budget
        diff_pct = diff / budget * 100
        parts.append(f"项目预算 {_fmt_money(budget)}，当前偏差 {_fmt_money(diff)}（{diff_pct:+.1f}%）。")
        ratio = _budget_deviation_ratio(ctx)
        if ratio >= 3:
            parts.append("造价与预算偏差超过 3 倍，需重点核查工程量数量级、单位换算和重复套价。")
        elif ratio >= 1.5:
            parts.append("造价与预算偏差较大，建议复核高金额分部和定额系数。")
    elif budget <= 0:
        parts.append("项目未设置预算，无法自动判断造价偏差，建议补录目标预算。")

    if division_costs:
        top = sorted(division_costs.items(), key=lambda item: -item[1])[:5]
        parts.append("金额占比最高分部：" + "、".join(f"{name} {_fmt_money(value)}" for name, value in top) + "。")
    return "\n".join(parts)


def _summarize_validation_audit(ctx: _LocalAuditContext) -> str:
    parts = [
        f"规则校验共 {len(ctx.validation_issues)} 条：错误 {ctx.error_count}、警告 {ctx.warning_count}、提示 {ctx.info_count}。",
    ]
    for issue in ctx.validation_issues[:8]:
        prefix = "错误" if issue.severity == Severity.ERROR else "警告" if issue.severity == Severity.WARNING else "提示"
        parts.append(f"- [{prefix}] {issue.message} 建议：{issue.suggestion}")
    if ctx.error_count:
        parts.append("存在错误项时不建议直接出正式成果，应先修复后重新计算。")
    elif ctx.warning_count:
        parts.append("没有阻断性错误，但仍建议复核警告项后再归档。")
    else:
        parts.append("未发现阻断性问题，可进入报告导出或版本归档。")
    return "\n".join(parts)


def _summarize_final_audit(
    ctx: _LocalAuditContext,
    *,
    upstream: PipelineResult | None,
) -> str:
    zh_note = ""
    if upstream and not upstream.success:
        failed_agents = ", ".join(s.handler_name for s in upstream.stages if not s.success) or "unknown"
        zh_note = f"辅助 审计未完成，已启用本地审计兜底（失败阶段：{failed_agents}）。\n"

    actions: list[str] = []
    if ctx.unbound_count:
        actions.append(f"处理 {ctx.unbound_count} 个未绑定定额项")
    if ctx.dirty_count:
        actions.append(f"重算 {ctx.dirty_count} 个待更新清单项")
    if ctx.error_count:
        actions.append(f"修复 {ctx.error_count} 个规则错误")
    if _budget_deviation_ratio(ctx) >= 3:
        actions.append("核查造价/预算数量级偏差")
    if not actions:
        actions.append("生成审计归档记录并导出成果")

    return (
        f"{zh_note}"
        f"本地审计完成，风险等级：{ctx.risk_level}。\n"
        f"清单 {ctx.boq_count} 项，绑定率 {(ctx.bound_count / ctx.boq_count * 100 if ctx.boq_count else 0):.1f}%，"
        f"造价 {_fmt_money(ctx.calc_total)}，校验错误 {ctx.error_count}、警告 {ctx.warning_count}。\n"
        f"建议下一步：" + "；".join(actions) + "。"
    )


def _budget_deviation_ratio(ctx: _LocalAuditContext) -> float:
    budget = float(ctx.project.budget or 0) if ctx.project else 0.0
    total = ctx.calc_total
    if budget <= 0 or total <= 0:
        return 0.0
    return max(total / budget, budget / total)


def _fmt_money(value: float) -> str:
    amount = float(value or 0)
    sign = "-" if amount < 0 else ""
    amount = abs(amount)
    if amount >= 100000000:
        return f"{sign}¥{amount / 100000000:.2f}亿"
    if amount >= 10000:
        return f"{sign}¥{amount / 10000:.1f}万"
    return f"{sign}¥{amount:,.0f}"


def _write_pipeline_log(
    ctx: HandlerContext,
    result: PipelineResult,
    *,
    mode: str,
    upstream: PipelineResult | None = None,
) -> None:
    if not ctx.project_id:
        return
    payload = {
        "mode": mode,
        "success": result.success,
        "pipeline": result.pipeline_name,
        "final_answer": result.final_answer,
        "stages": [
            {
                "index": stage.stage_index,
                "handler": stage.handler_name,
                "success": stage.success,
                "answer": stage.answer[:500],
            }
            for stage in result.stages
        ],
    }
    if upstream is not None:
        payload["upstream"] = {
            "success": upstream.success,
            "failed_agents": [stage.handler_name for stage in upstream.stages if not stage.success],
            "error": upstream.error,
        }
    try:
        write_audit_log(
            ctx.db,
            project_id=ctx.project_id,
            actor="audit_pipeline",
            action="audit.pipeline.completed" if mode == "zh" else "audit.pipeline.local_completed",
            resource_type="project",
            resource_id=ctx.project_id,
            after_json=json.dumps(payload, ensure_ascii=False, default=str),
        )
    except Exception:
        ctx.db.rollback()
