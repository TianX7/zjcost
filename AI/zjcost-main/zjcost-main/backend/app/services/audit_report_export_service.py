"""审计报告导出服务：生成复核审计结果 PDF / Excel。

增强版内容结构：
- 封面：项目名称、计价标准、审计时间
- 一、项目概况：基本信息表、规则包费率
- 二、工程量清单汇总：总数、分部统计、总造价
- 三、造价结构分析：人材机费用占比、费率合规性
- 四、定额绑定覆盖率：已绑定/未绑定/待重算统计
- 五、规则校验结果：错误/警告/提示明细表
- 六、计价审查明细：综合单价异常、消耗量异常
- 七、审计结论与建议：风险评级、行动建议
"""

from __future__ import annotations

import io
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.boq_item import BoqItem
from app.models.project import Project
from app.services.validation_service import Severity, validate_project


# ── helpers ────────────────────────────────────────────────────────────────


def _severity_label(value: str) -> str:
    return {"error": "错误", "warning": "警告", "info": "提示"}.get(value, value)


def _is_pricing_issue(code: str) -> bool:
    return "RATE" in code.upper() or "PRICE" in code.upper() or "COST" in code.upper()


def _collect_audit_data(project_id: int, db: Session) -> dict:
    """汇总所有审计所需数据。"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError(f"Project {project_id} not found")

    boq_items = db.query(BoqItem).filter(BoqItem.project_id == project_id).all()

    # ── 验证问题 ──
    issues = validate_project(project_id=project_id, db=db)
    rule_rows: list[dict] = []
    pricing_rows: list[dict] = []
    for i in issues:
        row = {
            "severity": i.severity.value,
            "severity_label": _severity_label(i.severity.value),
            "code": i.code,
            "boq_item_id": i.boq_item_id,
            "message": i.message,
            "suggestion": i.suggestion,
        }
        if _is_pricing_issue(i.code):
            pricing_rows.append(row)
        else:
            rule_rows.append(row)

    errors = sum(1 for r in rule_rows if r["severity"] == "error") + \
             sum(1 for r in pricing_rows if r["severity"] == "error")
    warnings = sum(1 for r in rule_rows if r["severity"] == "warning") + \
               sum(1 for r in pricing_rows if r["severity"] == "warning")
    infos = sum(1 for r in rule_rows if r["severity"] == "info") + \
            sum(1 for r in pricing_rows if r["severity"] == "info")

    # ── BOQ 统计 ──
    total_items = len(boq_items)
    total_qty = sum(b.quantity for b in boq_items)
    division_map: dict[str, list[BoqItem]] = defaultdict(list)
    for b in boq_items:
        division_map[b.division or "未分部"].append(b)

    division_stats = []
    for div_name, items in sorted(division_map.items()):
        div_total = sum(i.quantity for i in items)
        division_stats.append({
            "name": div_name,
            "count": len(items),
            "total_qty": round(div_total, 4),
        })

    # ── 计算结果统计（从 CalcResult 表读取） ──
    from app.models.calc_result import CalcResult
    calc_results = db.query(CalcResult).filter(
        CalcResult.boq_item_id.in_([b.id for b in boq_items]) if boq_items else False
    ).all() if boq_items else []
    calc_map = {c.boq_item_id: c for c in calc_results}

    total_labor = sum(c.labor_cost for c in calc_results)
    total_material = sum(c.material_cost for c in calc_results)
    total_machine = sum(c.machine_cost for c in calc_results)
    total_direct = sum(c.direct_cost for c in calc_results)
    total_mgmt = sum(c.management_fee for c in calc_results)
    total_profit = sum(c.profit for c in calc_results)
    total_regulatory = sum(c.regulatory_fee for c in calc_results)
    total_tax = sum(c.tax for c in calc_results)
    grand_total = sum(c.total_cost for c in calc_results)
    has_calc = len(calc_results)
    no_calc = total_items - has_calc

    # ── 绑定覆盖率 ──
    from app.models.line_item_quota_binding import LineItemQuotaBinding
    binding_counts: dict[int, int] = {}
    if boq_items:
        raw_bindings = db.query(LineItemQuotaBinding).filter(
            LineItemQuotaBinding.boq_item_id.in_([b.id for b in boq_items])
        ).all()
        for rb in raw_bindings:
            binding_counts[rb.boq_item_id] = binding_counts.get(rb.boq_item_id, 0) + 1

    bound_count = sum(1 for b in boq_items if b.id in binding_counts and binding_counts[b.id] > 0)
    unbound_count = total_items - bound_count

    # ── 项目特征覆盖率 ──
    with_chars = sum(1 for b in boq_items if b.characteristics and b.characteristics.strip())

    # ── 规则包费率 ──
    fee_config = None
    if project.rule_package_id:
        from app.models.rule_package import RulePackage
        rp = db.query(RulePackage).filter(RulePackage.id == project.rule_package_id).first()
        if rp:
            fee_config = {
                "name": rp.name,
                "management_rate": rp.management_rate,
                "profit_rate": rp.profit_rate,
                "regulatory_rate": rp.regulatory_rate,
                "tax_rate": rp.tax_rate,
            }

    # ── 风险评级 ──
    risk_level = "低"
    risk_factors = []
    if errors > 0:
        risk_level = "高"
        risk_factors.append(f"存在 {errors} 个错误级问题")
    if warnings > 0:
        if risk_level != "高":
            risk_level = "中"
        risk_factors.append(f"存在 {warnings} 个警告级问题")
    if unbound_count > 0:
        if risk_level != "高":
            risk_level = "中"
        risk_factors.append(f"{unbound_count} 个清单项未绑定定额")
    if no_calc > 0:
        risk_factors.append(f"{no_calc} 个清单项缺少计算结果")
    if not boq_items:
        risk_level = "高"
        risk_factors.append("项目无工程量清单数据")

    return {
        "project": project,
        "boq_items": boq_items,
        "rule_rows": rule_rows,
        "pricing_rows": pricing_rows,
        "errors": errors,
        "warnings": warnings,
        "infos": infos,
        "total_items": total_items,
        "total_qty": total_qty,
        "division_stats": division_stats,
        "calc_results": calc_results,
        "calc_map": calc_map,
        "total_labor": total_labor,
        "total_material": total_material,
        "total_machine": total_machine,
        "total_direct": total_direct,
        "total_mgmt": total_mgmt,
        "total_profit": total_profit,
        "total_regulatory": total_regulatory,
        "total_tax": total_tax,
        "grand_total": grand_total,
        "has_calc": has_calc,
        "no_calc": no_calc,
        "binding_counts": binding_counts,
        "bound_count": bound_count,
        "unbound_count": unbound_count,
        "with_chars": with_chars,
        "fee_config": fee_config,
        "risk_level": risk_level,
        "risk_factors": risk_factors,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"),
    }


# ── PDF 导出 ──────────────────────────────────────────────────────────────


def export_audit_report_pdf(project_id: int, db: Session) -> bytes:
    """按审计报告版式生成增强版 PDF。"""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    import os
    import platform

    def _register_font() -> str:
        candidates = []
        if platform.system() == "Windows":
            candidates = [
                os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts", "msyh.ttc"),
                os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts", "simsun.ttc"),
            ]
        elif platform.system() == "Darwin":
            candidates = [
                "/System/Library/Fonts/PingFang.ttc",
                "/System/Library/Fonts/STHeiti Light.ttc",
            ]
        elif platform.system() == "Linux":
            candidates = [
                "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
                "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            ]
        for path in candidates:
            if os.path.exists(path):
                try:
                    pdfmetrics.registerFont(TTFont("AuditFont", path, subfontIndex=0))
                    return "AuditFont"
                except Exception:
                    continue
        return "Helvetica"

    data = _collect_audit_data(project_id, db)
    project = data["project"]
    font = _register_font()
    project_name = project.name or "未命名项目"

    # 样式工厂
    _style_cache: dict[str, ParagraphStyle] = {}

    def P(txt, size=10, align=0, bold=False, after=0, before=0, color=None):
        key = f"{size}_{align}_{bold}_{after}_{before}_{color}"
        if key not in _style_cache:
            _style_cache[key] = ParagraphStyle(
                "CN", fontName=font, fontSize=size, leading=size + 5,
                alignment=align, spaceAfter=after, spaceBefore=before, wordWrap="CJK",
            )
        style = _style_cache[key].clone("CN_" + key)
        if bold:
            style.fontName = font  # may need bold variant
        if color:
            style.textColor = colors.HexColor(color)
        return Paragraph(txt, style)

    def tbl(data, widths, header_rows=1, fs=8):
        st = [
            ("FONTNAME", (0, 0), (-1, -1), font),
            ("FONTSIZE", (0, 0), (-1, -1), fs),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("BACKGROUND", (0, 0), (-1, header_rows - 1), colors.HexColor("#D9EAF7")),
        ]
        t = Table(data, colWidths=widths, repeatRows=header_rows)
        t.setStyle(TableStyle(st))
        return t

    def severity_color(value: str) -> str:
        return {"error": "#fdecea", "warning": "#fff8e1", "info": "#f1f8e9"}.get(value, "#f5f5f5")

    def cn_upper(num: float) -> str:
        digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"]
        units = ["", "拾", "佰", "仟", "万", "拾", "佰", "仟", "亿"]
        if num <= 0:
            return "零元整"
        s = f"{num:.2f}"
        int_part, dec_part = s.split(".")
        jiao = int(dec_part[0])
        fen = int(dec_part[1])
        result = ""
        n = len(int_part)
        for i, ch in enumerate(int_part):
            d = int(ch)
            u = n - i - 1
            if d != 0:
                result += digits[d] + units[u]
            else:
                if result and not result.endswith("零"):
                    result += "零"
        result = result.rstrip("零") + "元"
        if jiao == 0 and fen == 0:
            result += "整"
        else:
            if jiao > 0:
                result += digits[jiao] + "角"
            if fen > 0:
                result += digits[fen] + "分"
        return result

    def fmt_money(val: float) -> str:
        if abs(val) < 0.01:
            return "-"
        return f"{val:,.2f}"

    def fmt_pct(val: float, base: float) -> str:
        if base <= 0:
            return "-"
        return f"{val / base * 100:.1f}%"

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=14 * mm, bottomMargin=14 * mm)

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont(font, 7)
        canvas.drawCentredString(A4[0] / 2, 8 * mm,
                                 f"{project_name} — 复核审计报告    第 {doc_.page} 页")
        canvas.restoreState()

    el: list = []
    W = doc.width

    # ════════════════════════════════════════════════════════════════════════
    # 封面
    # ════════════════════════════════════════════════════════════════════════
    el.append(Spacer(1, 40 * mm))
    el.append(P("复 核 审 计 报 告", 24, 1, bold=True))
    el.append(Spacer(1, 20 * mm))
    el.append(P(f"项目名称：{project_name}", 13, 1))
    el.append(Spacer(1, 5 * mm))
    el.append(P(f"计价标准：{project.standard_type}", 12, 1))
    el.append(Spacer(1, 5 * mm))
    el.append(P(f"项目地区：{project.region or '-'}", 12, 1))
    el.append(Spacer(1, 5 * mm))
    el.append(P(f"工程类型：{project.project_type or '-'}", 12, 1))
    el.append(Spacer(1, 5 * mm))
    el.append(P(f"审计时间：{data['generated_at']}", 12, 1))
    el.append(Spacer(1, 5 * mm))
    el.append(P(f"编制单位：{project.owner or '-'}", 12, 1))
    el.append(Spacer(1, 30 * mm))
    el.append(P("本报告由「筑衡」造价管控平台自动生成，供复核审计留痕使用。", 10, 1, color="#666666"))
    el.append(P("依据标准：GB/T 50500-2024《建设工程工程量清单计价标准》", 10, 1, color="#666666"))
    el.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # 一、项目概况
    # ════════════════════════════════════════════════════════════════════════
    el.append(P("一、项目概况", 15, 0, bold=True, after=6))

    overview_data = [
        ["项目名称", project_name, "项目状态", {"draft": "草稿", "ongoing": "进行中", "completed": "已完成", "archived": "已归档"}.get(project.status or "draft", project.status or "-")],
        ["项目地区", project.region or "-", "工程类型", project.project_type or "-"],
        ["计价标准", project.standard_type, "项目预算", fmt_money(project.budget) if project.budget else "-"],
        ["建设单位", project.owner or "-", "币种", project.currency or "CNY"],
        ["开始日期", str(project.start_date or "-"), "结束日期", str(project.end_date or "-")],
    ]
    col_w = [22 * mm, (W - 44 * mm) / 2, 22 * mm, (W - 44 * mm) / 2]
    t_overview = tbl(overview_data, col_w, fs=9)
    el.append(t_overview)
    el.append(Spacer(1, 4 * mm))

    if data["fee_config"]:
        fc = data["fee_config"]
        el.append(P("规则包费率配置", 12, 0, bold=True, after=4))
        fee_data = [
            ["规则包", "管理费率", "利润率", "规费率", "增值税率"],
            [fc["name"], f"{fc['management_rate']*100:.1f}%", f"{fc['profit_rate']*100:.1f}%",
             f"{fc['regulatory_rate']*100:.1f}%", f"{fc['tax_rate']*100:.1f}%"],
        ]
        el.append(tbl(fee_data, [W / 5] * 5, fs=9))
    el.append(Spacer(1, 6 * mm))

    # ════════════════════════════════════════════════════════════════════════
    # 二、工程量清单汇总
    # ════════════════════════════════════════════════════════════════════════
    el.append(P("二、工程量清单汇总", 15, 0, bold=True, after=6))

    # 基本统计
    summary_data = [
        ["清单项总数", "有特征描述", "覆盖项目特征", "已绑定定额", "未绑定定额", "待重算"],
        [str(data["total_items"]),
         str(data["with_chars"]),
         fmt_pct(data["with_chars"], data["total_items"]) if data["total_items"] else "-",
         str(data["bound_count"]),
         str(data["unbound_count"]),
         str(data["no_calc"])],
    ]
    el.append(tbl(summary_data, [W / 6] * 6, fs=9))
    el.append(Spacer(1, 4 * mm))

    # 分部分布
    if data["division_stats"]:
        el.append(P("分部分布明细", 12, 0, bold=True, after=4))
        div_header = ["分部名称", "清单项数", "合计工程量", "占比（项数）"]
        div_rows = [div_header]
        for ds in data["division_stats"]:
            div_rows.append([
                ds["name"],
                str(ds["count"]),
                f"{ds['total_qty']:.4f}",
                fmt_pct(ds["count"], data["total_items"]) if data["total_items"] else "-",
            ])
        el.append(tbl(div_rows, [30 * mm, 20 * mm, 30 * mm, 25 * mm], fs=8.5))
    el.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # 三、造价结构分析
    # ════════════════════════════════════════════════════════════════════════
    el.append(P("三、造价结构分析", 15, 0, bold=True, after=6))

    if data["grand_total"] > 0:
        gt = data["grand_total"]
        cost_data = [
            ["费用项目", "金额（元）", "占比", "说明"],
            ["人工费", fmt_money(data["total_labor"]), fmt_pct(data["total_labor"], gt), "直接工程费中的人工费用"],
            ["材料费", fmt_money(data["total_material"]), fmt_pct(data["total_material"], gt), "直接工程费中的材料费用"],
            ["机械费", fmt_money(data["total_machine"]), fmt_pct(data["total_machine"], gt), "直接工程费中的机械费用"],
            ["直接费合计", fmt_money(data["total_direct"]), fmt_pct(data["total_direct"], gt), "人+材+机"],
            ["管理费", fmt_money(data["total_mgmt"]), fmt_pct(data["total_mgmt"], gt), "企业管理费"],
            ["利润", fmt_money(data["total_profit"]), fmt_pct(data["total_profit"], gt), "利润"],
            ["规费", fmt_money(data["total_regulatory"]), fmt_pct(data["total_regulatory"], gt), "社会保险费+住房公积金等"],
            ["税金", fmt_money(data["total_tax"]), fmt_pct(data["total_tax"], gt), "增值税"],
            ["造价合计", fmt_money(gt), "100%", "含税工程造价"],
        ]
        t_cost = tbl(cost_data, [28 * mm, 30 * mm, 18 * mm, W - 76 * mm], fs=8.5)
        # 合计行加绿底
        t_cost.setStyle(TableStyle([
            ("BACKGROUND", (0, len(cost_data) - 1), (-1, len(cost_data) - 1), colors.HexColor("#E2EFDA")),
        ]))
        el.append(t_cost)
    else:
        el.append(P("项目暂无计算结果数据。", 11, 1, color="#999999"))
    el.append(Spacer(1, 4 * mm))

    # 费率合规性
    if data["fee_config"] and data["grand_total"] > 0:
        fc = data["fee_config"]
        actual_mgmt = data["total_mgmt"] / data["total_direct"] if data["total_direct"] else 0
        actual_profit = data["total_profit"] / data["total_direct"] if data["total_direct"] else 0
        actual_reg = data["total_regulatory"] / data["total_direct"] if data["total_direct"] else 0
        actual_tax = data["total_tax"] / data["pre_tax_total"] if data.get("pre_tax_total") else 0
        pre_tax = data["total_direct"] + data["total_mgmt"] + data["total_profit"] + data["total_regulatory"]

        rate_data = [
            ["费率项目", "配置费率", "实际费率", "偏差", "状态"],
            ["管理费率", f"{fc['management_rate']*100:.1f}%", f"{actual_mgmt*100:.2f}%",
             f"{(actual_mgmt - fc['management_rate'])*100:+.2f}%", "合规" if abs(actual_mgmt - fc['management_rate']) < 0.01 else "偏差"],
            ["利润率", f"{fc['profit_rate']*100:.1f}%", f"{actual_profit*100:.2f}%",
             f"{(actual_profit - fc['profit_rate'])*100:+.2f}%", "合规" if abs(actual_profit - fc['profit_rate']) < 0.01 else "偏差"],
            ["规费率", f"{fc['regulatory_rate']*100:.1f}%", f"{actual_reg*100:.2f}%",
             f"{(actual_reg - fc['regulatory_rate'])*100:+.2f}%", "合规" if abs(actual_reg - fc['regulatory_rate']) < 0.01 else "偏差"],
        ]
        el.append(P("费率合规性检查", 12, 0, bold=True, after=4))
        t_rate = tbl(rate_data, [22 * mm, 22 * mm, 22 * mm, 22 * mm, 18 * mm], fs=9)
        # 着色
        for ri, r in enumerate(rate_data[1:], start=1):
            color = "#E2EFDA" if r[4] == "合规" else "#fdecea"
            t_rate.setStyle(TableStyle([("BACKGROUND", (4, ri), (4, ri), colors.HexColor(color))]))
        el.append(t_rate)
    el.append(Spacer(1, 4 * mm))

    # 造价金额大写
    if data["grand_total"] > 0:
        el.append(P(f"含税工程造价大写：{cn_upper(data['grand_total'])}", 11, 1, bold=True))
    el.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # 四、定额绑定覆盖率
    # ════════════════════════════════════════════════════════════════════════
    el.append(P("四、定额绑定覆盖率", 15, 0, bold=True, after=6))

    bind_data = [
        ["统计项", "数值", "说明"],
        ["清单项总数", str(data["total_items"]), "项目包含的全部清单条目"],
        ["已绑定定额", str(data["bound_count"]), "已关联定额子目，可进行计价计算"],
        ["未绑定定额", str(data["unbound_count"]), "缺失定额关联，无法自动计价"],
        ["绑定覆盖率", fmt_pct(data["bound_count"], data["total_items"]) if data["total_items"] else "-", "已绑定 / 总数"],
        ["有计算结果", str(data["has_calc"]), "已完成综合单价计算的清单项"],
        ["缺少计算结果", str(data["no_calc"]), "待执行计算的清单项"],
    ]
    el.append(tbl(bind_data, [25 * mm, 25 * mm, W - 50 * mm], fs=9))
    el.append(Spacer(1, 4 * mm))

    # 未绑定清单项明细
    unbound_items = [b for b in data["boq_items"] if b.id not in data["binding_counts"] or data["binding_counts"].get(b.id, 0) == 0]
    if unbound_items:
        el.append(P(f"未绑定定额清单项明细（共 {len(unbound_items)} 项）", 12, 0, bold=True, after=4))
        ub_header = ["编码", "名称", "单位", "工程量", "分部"]
        ub_rows = [ub_header]
        for b in unbound_items[:30]:
            ub_rows.append([b.code, b.name[:20], b.unit, f"{b.quantity:.4f}", b.division or "-"])
        if len(unbound_items) > 30:
            ub_rows.append(["...", f"（还有 {len(unbound_items) - 30} 项）", "", "", ""])
        t_ub = tbl(ub_rows, [28 * mm, 32 * mm, 14 * mm, 20 * mm, W - 94 * mm], fs=8)
        for ri in range(1, len(ub_rows)):
            t_ub.setStyle(TableStyle([("BACKGROUND", (0, ri), (-1, ri), colors.HexColor("#fff8e1"))]))
        el.append(t_ub)
    el.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # 五、规则校验结果
    # ════════════════════════════════════════════════════════════════════════
    el.append(P("五、规则校验结果", 15, 0, bold=True, after=4))

    # 校验统计
    total_issues = data["errors"] + data["warnings"] + data["infos"]
    val_stats = [
        ["校验项", "数量"],
        ["规则问题总数", str(total_issues)],
        ["错误（Error）", str(data["errors"])],
        ["警告（Warning）", str(data["warnings"])],
        ["提示（Info）", str(data["infos"])],
    ]
    t_val = tbl(val_stats, [35 * mm, 25 * mm], fs=9)
    for ri, sev in enumerate(["", "error", "warning", "info"], start=1):
        if sev:
            t_val.setStyle(TableStyle([("BACKGROUND", (1, ri), (1, ri), colors.HexColor(severity_color(sev)))]))
    el.append(t_val)
    el.append(Spacer(1, 4 * mm))

    # 规则问题明细
    el.append(P(f"规则问题明细（{len(data['rule_rows'])} 项）", 12, 0, bold=True, after=4))
    d_rule = [["级别", "编码", "问题描述", "修正建议"]]
    for row in data["rule_rows"]:
        d_rule.append([row["severity_label"], row["code"], row["message"], row["suggestion"]])
    if not data["rule_rows"]:
        d_rule.append(["—", "—", "未发现规则问题", "—"])
    t_rule = tbl(d_rule, [12 * mm, 30 * mm, (W - 42 * mm) * 0.55, (W - 42 * mm) * 0.45], fs=7.5)
    for i, row in enumerate(data["rule_rows"], start=1):
        t_rule.setStyle(TableStyle([("BACKGROUND", (0, i), (0, i), colors.HexColor(severity_color(row["severity"])))]))
    el.append(t_rule)
    el.append(Spacer(1, 6 * mm))

    # ════════════════════════════════════════════════════════════════════════
    # 六、计价审查明细
    # ════════════════════════════════════════════════════════════════════════
    el.append(P(f"六、计价审查明细（{len(data['pricing_rows'])} 项）", 15, 0, bold=True, after=4))
    d_price = [["级别", "类型", "问题描述", "修正建议"]]
    for row in data["pricing_rows"]:
        d_price.append([row["severity_label"], row["code"], row["message"], row["suggestion"]])
    if not data["pricing_rows"]:
        d_price.append(["—", "—", "未发现计价审查问题", "—"])
    t_price = tbl(d_price, [12 * mm, 30 * mm, (W - 42 * mm) * 0.55, (W - 42 * mm) * 0.45], fs=7.5)
    for i, row in enumerate(data["pricing_rows"], start=1):
        t_price.setStyle(TableStyle([("BACKGROUND", (0, i), (0, i), colors.HexColor(severity_color(row["severity"])))]))
    el.append(t_price)
    el.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # 七、审计结论与建议
    # ════════════════════════════════════════════════════════════════════════
    risk_colors = {"高": "#fdecea", "中": "#fff8e1", "低": "#E2EFDA"}
    el.append(P("七、审计结论与建议", 15, 0, bold=True, after=6))

    # 风险评级
    risk_data = [
        ["风险评级", data["risk_level"]],
        ["错误数", str(data["errors"])],
        ["警告数", str(data["warnings"])],
        ["提示数", str(data["infos"])],
        ["绑定覆盖率", fmt_pct(data["bound_count"], data["total_items"]) if data["total_items"] else "-"],
        ["计算完成率", fmt_pct(data["has_calc"], data["total_items"]) if data["total_items"] else "-"],
    ]
    t_risk = tbl(risk_data, [30 * mm, 40 * mm], fs=10)
    t_risk.setStyle(TableStyle([
        ("BACKGROUND", (0, 1), (1, 1), colors.HexColor(risk_colors.get(data["risk_level"], "#f5f5f5"))),
        ("FONTSIZE", (1, 1), (1, 1), 14),
    ]))
    el.append(t_risk)
    el.append(Spacer(1, 4 * mm))

    # 风险因素
    if data["risk_factors"]:
        el.append(P("风险因素", 12, 0, bold=True, after=4))
        for i, f in enumerate(data["risk_factors"], 1):
            el.append(P(f"{i}. {f}", 10, 0))
        el.append(Spacer(1, 4 * mm))

    # 行动建议
    el.append(P("建议后续行动", 12, 0, bold=True, after=4))
    suggestions = []
    if data["errors"] > 0:
        suggestions.append(f"1. 【紧急】修正 {data['errors']} 个错误级问题，这些问题可能导致计价结果失真。")
    if data["unbound_count"] > 0:
        suggestions.append(f"2. 【重要】为 {data['unbound_count']} 个未绑定清单项关联定额子目，完成计价计算。")
    if data["no_calc"] > 0:
        suggestions.append(f"3. 【重要】执行 {data['no_calc']} 个清单项的综合单价计算，生成完整造价。")
    if data["warnings"] > 0:
        suggestions.append(f"4. 【建议】排查 {data['warnings']} 个警告级问题，确认是否为合理偏差。")
    if not suggestions:
        suggestions.append("项目审计通过，未发现需要立即处理的问题。")
    for s in suggestions:
        el.append(P(s, 10, 0, after=2))
    el.append(Spacer(1, 10 * mm))

    # 签章区
    el.append(P("审计人员：________________          审核人员：________________          日期：________________", 10, 1))

    doc.build(el, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


# ── Excel 导出 ────────────────────────────────────────────────────────────


def export_audit_report_excel(project_id: int, db: Session) -> bytes:
    """按审计报告版式生成 Excel（多个工作表）。"""
    import openpyxl
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    data = _collect_audit_data(project_id, db)
    project = data["project"]
    wb = openpyxl.Workbook()

    thin = Side(style="thin", color="B0B0B0")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    header_fill = PatternFill("solid", fgColor="D9EAF7")
    error_fill = PatternFill("solid", fgColor="FDE9E7")
    warning_fill = PatternFill("solid", fgColor="FFF8E1")
    info_fill = PatternFill("solid", fgColor="F1F8E9")
    green_fill = PatternFill("solid", fgColor="E2EFDA")
    wrap = Alignment(wrap_text=True, vertical="top")
    center = Alignment(horizontal="center", vertical="center")

    def add_meta(ws, title: str, row=1):
        ws.cell(row=row, column=1, value=f"{project.name or '未命名项目'} — {title}").font = Font(bold=True, size=14)
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=6)
        ws.cell(row=row + 1, column=1, value=(
            f"计价标准：{project.standard_type}    地区：{project.region or '-'}    "
            f"审计时间：{data['generated_at']}"
        )).font = Font(size=10, color="666666")
        ws.merge_cells(start_row=row + 1, start_column=1, end_row=row + 1, end_column=6)

    def write_table(ws, start_row, headers, rows, col_widths=None, severity_col=None):
        for col, h in enumerate(headers, 1):
            c = ws.cell(row=start_row, column=col, value=h)
            c.font = Font(bold=True)
            c.fill = header_fill
            c.border = border
            c.alignment = center
        for ri, row in enumerate(rows, start_row + 1):
            for col, v in enumerate(row, 1):
                c = ws.cell(row=ri, column=col, value=v)
                c.border = border
                c.alignment = wrap
            if severity_col is not None:
                sev_val = row[severity_col]
                fill = error_fill if sev_val == "错误" else warning_fill if sev_val == "警告" else info_fill
                ws.cell(row=ri, column=severity_col + 1).fill = fill
        if col_widths:
            for col, w in enumerate(col_widths, 1):
                ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = w

    # ── Sheet 1: 项目概况 ──
    ws1 = wb.active
    ws1.title = "项目概况"
    add_meta(ws1, "项目概况")
    overview = [
        ["项目名称", project.name or "-"],
        ["项目状态", project.status or "-"],
        ["项目地区", project.region or "-"],
        ["工程类型", project.project_type or "-"],
        ["项目预算", str(project.budget) if project.budget else "-"],
        ["计价标准", project.standard_type],
        ["币种", project.currency or "CNY"],
        ["建设单位", project.owner or "-"],
        ["开始日期", str(project.start_date or "-")],
        ["结束日期", str(project.end_date or "-")],
    ]
    write_table(ws1, 4, ["项目属性", "值"], overview, [20, 40])

    if data["fee_config"]:
        fc = data["fee_config"]
        ws1.cell(row=16, column=1, value="规则包费率配置").font = Font(bold=True, size=11)
        write_table(ws1, 17, ["费率项", "配置值"],
                    [["管理费率", f"{fc['management_rate']*100:.1f}%"],
                     ["利润率", f"{fc['profit_rate']*100:.1f}%"],
                     ["规费率", f"{fc['regulatory_rate']*100:.1f}%"],
                     ["增值税率", f"{fc['tax_rate']*100:.1f}%"]],
                    [20, 20])

    # ── Sheet 2: 工程量清单汇总 ──
    ws2 = wb.create_sheet("工程量清单汇总")
    add_meta(ws2, "工程量清单汇总")
    summary_rows = [
        ["清单项总数", str(data["total_items"])],
        ["有特征描述", str(data["with_chars"])],
        ["已绑定定额", str(data["bound_count"])],
        ["未绑定定额", str(data["unbound_count"])],
        ["有计算结果", str(data["has_calc"])],
        ["缺少计算结果", str(data["no_calc"])],
    ]
    write_table(ws2, 4, ["统计项", "数值"], summary_rows, [20, 15])

    if data["division_stats"]:
        ws2.cell(row=12, column=1, value="分部分布").font = Font(bold=True, size=11)
        div_rows = [[ds["name"], str(ds["count"]), f"{ds['total_qty']:.4f}"] for ds in data["division_stats"]]
        write_table(ws2, 13, ["分部", "项数", "合计工程量"], div_rows, [30, 12, 18])

    # ── Sheet 3: 造价结构分析 ──
    ws3 = wb.create_sheet("造价结构分析")
    add_meta(ws3, "造价结构分析")
    if data["grand_total"] > 0:
        gt = data["grand_total"]
        cost_rows = [
            ["人工费", f"{data['total_labor']:.2f}", f"{data['total_labor']/gt*100:.1f}%"],
            ["材料费", f"{data['total_material']:.2f}", f"{data['total_material']/gt*100:.1f}%"],
            ["机械费", f"{data['total_machine']:.2f}", f"{data['total_machine']/gt*100:.1f}%"],
            ["直接费合计", f"{data['total_direct']:.2f}", f"{data['total_direct']/gt*100:.1f}%"],
            ["管理费", f"{data['total_mgmt']:.2f}", f"{data['total_mgmt']/gt*100:.1f}%"],
            ["利润", f"{data['total_profit']:.2f}", f"{data['total_profit']/gt*100:.1f}%"],
            ["规费", f"{data['total_regulatory']:.2f}", f"{data['total_regulatory']/gt*100:.1f}%"],
            ["税金", f"{data['total_tax']:.2f}", f"{data['total_tax']/gt*100:.1f}%"],
            ["造价合计", f"{gt:.2f}", "100%"],
        ]
        t3 = write_table(ws3, 4, ["费用项目", "金额（元）", "占比"], cost_rows, [20, 20, 12])
        # 合计行绿色
        ws3.cell(row=12, column=1).fill = green_fill
        ws3.cell(row=12, column=2).fill = green_fill
        ws3.cell(row=12, column=3).fill = green_fill

    # ── Sheet 4: 规则问题 ──
    ws4 = wb.create_sheet("规则问题")
    add_meta(ws4, "规则校验问题明细")
    rule_rows = [[r["severity_label"], r["code"], r["message"], r["suggestion"]] for r in data["rule_rows"]]
    write_table(ws4, 4, ["级别", "编码", "问题描述", "修正建议"], rule_rows,
                [10, 24, 50, 40], severity_col=0)

    # ── Sheet 5: 计价审查 ──
    ws5 = wb.create_sheet("计价审查")
    add_meta(ws5, "计价审查明细")
    pricing_rows = [[r["severity_label"], r["code"], r["message"], r["suggestion"]] for r in data["pricing_rows"]]
    write_table(ws5, 4, ["级别", "类型", "问题描述", "修正建议"], pricing_rows,
                [10, 24, 50, 40], severity_col=0)

    # ── Sheet 6: 审计结论 ──
    ws6 = wb.create_sheet("审计结论")
    add_meta(ws6, "审计结论与建议")
    conclusion = [
        ["风险评级", data["risk_level"]],
        ["错误数", str(data["errors"])],
        ["警告数", str(data["warnings"])],
        ["提示数", str(data["infos"])],
        ["绑定覆盖率", f"{data['bound_count']}/{data['total_items']}"],
        ["计算完成率", f"{data['has_calc']}/{data['total_items']}"],
    ]
    write_table(ws6, 4, ["审计指标", "结果"], conclusion, [20, 20])
    if data["risk_factors"]:
        ws6.cell(row=12, column=1, value="风险因素").font = Font(bold=True, size=11)
        for i, f in enumerate(data["risk_factors"]):
            ws6.cell(row=13 + i, column=1, value=f"{i+1}. {f}")
    suggestions = []
    if data["errors"] > 0:
        suggestions.append(f"1.【紧急】修正 {data['errors']} 个错误级问题")
    if data["unbound_count"] > 0:
        suggestions.append(f"2.【重要】为 {data['unbound_count']} 个未绑定清单项关联定额")
    if data["no_calc"] > 0:
        suggestions.append(f"3.【重要】执行 {data['no_calc']} 个清单项的计算")
    if data["warnings"] > 0:
        suggestions.append(f"4.【建议】排查 {data['warnings']} 个警告级问题")
    if suggestions:
        row_start = 13 + len(data["risk_factors"]) + 1
        ws6.cell(row=row_start, column=1, value="建议行动").font = Font(bold=True, size=11)
        for i, s in enumerate(suggestions):
            ws6.cell(row=row_start + 1 + i, column=1, value=s)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
