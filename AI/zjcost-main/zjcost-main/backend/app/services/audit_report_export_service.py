"""审计报告导出服务：生成复核审计结果 PDF / Excel / HTML。

版式对齐正式工程造价结算审计报告（参考 cost-audit-report.html 模板）：
- 封面：工程名称、机构、报告编号、报送/审定指标
- 审计声明
- 目录
- 一、工程概况
- 二、审计依据
- 三、审计范围与方法
- 四、审计程序
- 五、审计结果（送审/审定/核减 + 造价结构）
- 六、审计发现的主要问题及明细
- 七、审计结论
- 八、审计建议
- 九、附件目录
- 报告签署页
"""

from __future__ import annotations

import io
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.boq_item import BoqItem
from app.models.project import Project
from app.services.validation_service import Severity, validate_project


# ── helpers ────────────────────────────────────────────────────────────────


def _severity_label(value: str) -> str:
    return {"error": "错误", "warning": "警告", "info": "提示"}.get(value, value)


def _is_pricing_issue(code: str) -> bool:
    return "RATE" in code.upper() or "PRICE" in code.upper() or "COST" in code.upper()


def _cn_upper(num: float) -> str:
    """人民币金额转大写，保留角分。"""
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


def _fmt_money(val: float) -> str:
    if abs(val) < 0.01:
        return "-"
    return f"{val:,.2f}"


def _collect_audit_data(project_id: int, db: Session) -> dict:
    """汇总所有审计所需数据。"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError(f"Project {project_id} not found")

    # ── 机构信息（用于封面/声明/签字页，取自系统配置或默认） ──
    from app.models.system_setting import SystemSetting
    org_name = "筑衡工程造价咨询有限公司"
    org_cert = "工程造价咨询甲级资质 · 证书编号:甲 31002026"
    org_address = "中国 XX 市造价服务中心 18 层"
    org_phone = "0XXX-8888 6688"
    try:
        org_setting = db.query(SystemSetting).first()
        if org_setting is not None:
            org_name = getattr(org_setting, "org_name", None) or org_name
            org_cert = getattr(org_setting, "org_cert", None) or org_cert
            org_address = getattr(org_setting, "org_address", None) or org_address
            org_phone = getattr(org_setting, "org_phone", None) or org_phone
    except Exception:
        pass

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

    # ── 金额映射：报审(送审)/审定 ──
    # 系统无独立“送审”概念，此处以项目预算作为报送对照造价；
    # 若无预算则以审定造价列示（此时核减为 0，报告中作说明）。
    submitted = float(project.budget) if (project.budget or 0) and project.budget > 0 else float(grand_total)
    audited = float(grand_total)
    reduced = submitted - audited
    reduce_rate = (reduced / submitted * 100) if submitted > 0 else 0.0
    has_submitted_anchor = bool(project.budget and project.budget > 0)

    # ── 工程概况补充 ──
    now = datetime.now(timezone.utc)
    generated_at = now.strftime("%Y-%m-%d %H:%M")
    # 建筑面积：从清单名称中猜测“建筑面积”项，否则留空
    area = None
    for b in boq_items:
        if "建筑面积" in (b.name or "") or "总建筑面积" in (b.name or ""):
            area = b.quantity
            break
    status_label = {"draft": "草稿", "ongoing": "进行中", "completed": "已完成", "archived": "已归档"}.get(
        project.status or "draft", project.status or "-"
    )
    standard_label = {
        "GB50500": "《建设工程工程量清单计价规范》(GB 50500-2013/2024)",
        "HKSMM4": "香港标准量度方法第4版 (HKSMM4)",
    }.get(project.standard_type, project.standard_type or "-")

    grand_upper = _cn_upper(grand_total)

    # ── 审计程序日程（按委托/开始日推算，简洁生成） ──
    p_start = project.updated_at
    p_start_date = (p_start.date() if getattr(p_start, "date", None) else now.date())
    p_start_date = (project.start_date or p_start_date)
    schedule = [
        ("接受委托，签订业务约定书", p_start_date),
        ("资料接收、登记与初步审阅", p_start_date + timedelta(days=2)),
        ("现场踏勘与工程量核对", p_start_date + timedelta(days=6)),
        ("工程量复核与综合单价核定", p_start_date + timedelta(days=12)),
        ("各方对量对价、核对确认差异", p_start_date + timedelta(days=30)),
        ("成果文件三级复核，汇总审计差异", p_start_date + timedelta(days=36)),
        ("出具正式审计报告", now.date()),
    ]

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
        "grand_upper": grand_upper,
        "has_calc": has_calc,
        "no_calc": no_calc,
        "binding_counts": binding_counts,
        "bound_count": bound_count,
        "unbound_count": unbound_count,
        "with_chars": with_chars,
        "fee_config": fee_config,
        "risk_level": risk_level,
        "risk_factors": risk_factors,
        "generated_at": generated_at,
        "submitted": submitted,
        "audited": audited,
        "reduced": reduced,
        "reduce_rate": reduce_rate,
        "has_submitted_anchor": has_submitted_anchor,
        "area": area,
        "status_label": status_label,
        "standard_label": standard_label,
        "schedule": schedule,
        "org_name": org_name,
        "org_cert": org_cert,
        "org_address": org_address,
        "org_phone": org_phone,
        "report_no": f"筑衡复核审字〔{now.year}〕第 {project_id:03d} 号",
    }


# ── 内部通用工具（PDF/HTML 共用） ─────────────────────────────────────────


def _cost_rows(data: dict) -> list[list]:
    """造价结构明细行（人材机 + 各项费用 + 合计）。"""
    gt = data["grand_total"]
    return [
        ["人工费", data["total_labor"], (data["total_labor"] / gt * 100) if gt else 0, "直接工程费中的人工费用"],
        ["材料费", data["total_material"], (data["total_material"] / gt * 100) if gt else 0, "直接工程费中的材料费用"],
        ["机械费", data["total_machine"], (data["total_machine"] / gt * 100) if gt else 0, "直接工程费中的机械费用"],
        ["直接费合计", data["total_direct"], (data["total_direct"] / gt * 100) if gt else 0, "人+材+机"],
        ["管理费", data["total_mgmt"], (data["total_mgmt"] / gt * 100) if gt else 0, "企业管理费"],
        ["利润", data["total_profit"], (data["total_profit"] / gt * 100) if gt else 0, "利润"],
        ["规费", data["total_regulatory"], (data["total_regulatory"] / gt * 100) if gt else 0, "社会保险费+住房公积金等"],
        ["税金", data["total_tax"], (data["total_tax"] / gt * 100) if gt else 0, "增值税"],
        ["造价合计", gt, 100.0, "含税工程造价"],
    ]


def _suggestions(data: dict) -> list[str]:
    """从风险因素生成行动建议。"""
    suggestions = []
    if data["errors"] > 0:
        suggestions.append(f"【紧急】修正 {data['errors']} 个错误级问题，这些问题可能导致计价结果失真。")
    if data["unbound_count"] > 0:
        suggestions.append(f"【重要】为 {data['unbound_count']} 个未绑定清单项关联定额子目，完成计价计算。")
    if data["no_calc"] > 0:
        suggestions.append(f"【重要】执行 {data['no_calc']} 个清单项的综合单价计算，生成完整造价。")
    if data["warnings"] > 0:
        suggestions.append(f"【建议】排查 {data['warnings']} 个警告级问题，确认是否为合理偏差。")
    if not suggestions:
        suggestions.append("项目复核审计通过，未发现需要立即处理的问题。")
    return suggestions


def _audit_basis(project: Project) -> list[str]:
    """按项目计价标准生成审计依据列表。"""
    std = project.standard_type or "GB50500"
    if std == "HKSMM4":
        return [
            "《香港标准量度方法》(HKSMM4)",
            "招标文件、投标文件及合同协议书",
            "施工图纸、竣工图纸及设计变更",
            "工程签证单、技术核定单及施工记录",
            "本项目工程量清单及综合单价成果文件",
        ]
    return [
        "《建设工程工程量清单计价规范》(GB 50500-2013/2024)",
        "《房屋建筑与装饰工程工程量计算规范》(GB 50854-2013)",
        "本项目对应的工程造价定额及配套费用定额",
        "施工合同及补充协议、招标/投标文件",
        "施工图纸、竣工图纸及设计变更通知单",
        "工程签证单、技术核定单及隐蔽工程验收记录",
        "用人单位提供的工程量清单、综合单价与分析表",
        "《建设工程价款结算暂行办法》(财建〔2004〕369号)",
        "《工程造价咨询企业管理办法》(住建部令第50号)",
    ]


# ── PDF 导出（结算审计报告版式） ───────────────────────────────────────


def export_audit_report_pdf(project_id: int, db: Session) -> bytes:
    """按正式结算审计报告版式生成 PDF。"""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import (
        NextPageTemplate, PageBreak, Paragraph, SimpleDocTemplate,
        Spacer, Table, TableStyle,
    )

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
                    pdfmetrics.registerFont(TTFont("AuditFontBold", path, subfontIndex=0))
                    return "AuditFont"
                except Exception:
                    continue
        return "Helvetica"

    data = _collect_audit_data(project_id, db)
    project = data["project"]
    font = _register_font()
    project_name = project.name or "未命名项目"

    STYLE = {
        "h2": ParagraphStyle("h2", fontName=font, fontSize=16, leading=20, spaceBefore=10, spaceAfter=8),
        "sec": ParagraphStyle("sec", fontName=font, fontSize=14, leading=18, spaceBefore=14, spaceAfter=6, textColor=colors.HexColor("#1e4e8c")),
        "sub": ParagraphStyle("sub", fontName=font, fontSize=12, leading=15, spaceBefore=8, spaceAfter=4),
        "body": ParagraphStyle("body", fontName=font, fontSize=10.5, leading=16, wordWrap="CJK"),
        "bodyL": ParagraphStyle("bodyL", fontName=font, fontSize=10.5, leading=16, alignment=1, wordWrap="CJK"),
        "muted": ParagraphStyle("muted", fontName=font, fontSize=9, leading=13, alignment=1, textColor=colors.HexColor("#666666")),
        "cap": ParagraphStyle("cap", fontName=font, fontSize=11, leading=15, spaceAfter=4),
        "num": ParagraphStyle("num", fontName=font, fontSize=20, leading=26, alignment=1, textColor=colors.HexColor("#1e4e8c")),
    }

    def P(text, style="body"):
        return Paragraph(str(text), STYLE[style])

    def tbl(data_rows, widths, header_rows=1, fs=9):
        st = [
            ("FONTNAME", (0, 0), (-1, -1), font),
            ("FONTSIZE", (0, 0), (-1, -1), fs),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d8dee7")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("BACKGROUND", (0, 0), (-1, header_rows - 1), colors.HexColor("#1e4e8c")),
            ("TEXTCOLOR", (0, 0), (-1, header_rows - 1), colors.white),
        ]
        t = Table(data_rows, colWidths=widths, repeatRows=header_rows)
        t.setStyle(TableStyle(st))
        return t

    def severity_color(value: str) -> str:
        return {"error": "#fdecea", "warning": "#fff8e1", "info": "#f1f8e9"}.get(value, "#f5f5f5")

    def issue_rows(rows):
        out = [["级别", "编码", "问题描述", "修正建议"]]
        for r in rows:
            out.append([r["severity_label"], r["code"], r["message"], r["suggestion"]])
        if len(out) == 1:
            out.append(["—", "—", "未发现问题", "—"])
        return out

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm)

    def footer_page(canvas, doc_):
        canvas.saveState()
        canvas.setFont(font, 7.5)
        canvas.setStrokeColor(colors.HexColor("#1e4e8c"))
        canvas.setLineWidth(0.8)
        canvas.line(16 * mm, 11 * mm, A4[0] - 16 * mm, 11 * mm)
        canvas.drawCentredString(A4[0] / 2, 7.5 * mm,
                                 f"{data['org_name']} · {project_name} — 复核审计报告  第 {doc_.page} 页")
        canvas.restoreState()

    def footer_cover(canvas, doc_):
        canvas.saveState()
        canvas.restoreState()

    el: list = []
    W = doc.width
    bw = [22 * mm, (W - 44 * mm) / 2, 22 * mm, (W - 44 * mm) / 2]

    # ═══════════ 封面 ═══════════
    el.append(Spacer(1, 30 * mm))
    el.append(P(data["report_no"], "muted"))
    el.append(Spacer(1, 22 * mm))
    el.append(P(data["org_name"], "sub"))
    el.append(P(data["org_cert"], "muted"))
    el.append(Spacer(1, 16 * mm))
    el.append(P(project_name, "h2"))
    el.append(P("工程造价复核审计报告", "sec"))
    el.append(Spacer(1, 20 * mm))
    cover_meta = [
        ["委托单位", project.owner or "-", "审计单位", data["org_name"]],
        ["审计时间", data["generated_at"], "计价标准", project.standard_type or "-"],
        ["报送造价", _fmt_money(data["submitted"]), "审定造价", _fmt_money(data["audited"])],
    ]
    el.append(tbl(cover_meta, bw, fs=9.5))
    el.append(Spacer(1, 26 * mm))
    el.append(P("本报告由「筑衡」造价管控平台自动生成，供复核审计留痕使用。", "muted"))
    el.append(PageBreak())

    # ═══════════ 审计声明 ═══════════
    el.append(P("审  计  声  明", "sec"))
    el.append(Spacer(1, 4 * mm))
    decls = [
        f"本公司接受委托，对“{project_name}”工程造价实施复核审计。审计过程中，我们遵循《工程造价咨询企业管理办法》《建设工程造价咨询成果文件质量标准》(CECA/GC 7) 等有关规定，恪守独立、客观、公正的执业原则。",
        "本报告以委托人提供的施工合同、清单、定额绑定、计价结果与校验记录等资料为审计基础，上述资料的真实性、完整性由资料提供方负责；若基础资料存在重大遗漏或失实，审计结果应作相应调整。",
        "本报告的审计范围与审计意见仅针对本项目工程造价复核，不构成对工程质量、施工合同履行及其他事项的鉴证意见。",
        "本报告仅供委托人用于本项目造价复核审计之目的。未经本公司书面同意，不得提供给委托人以外的单位或个人，不得作为其他用途使用。",
        "本公司及签字的注册造价工程师对本报告结论依法承担相应法律责任。",
    ]
    for i, d in enumerate(decls, 1):
        el.append(P(f"{i}. {d}", "body"))
        el.append(Spacer(1, 3 * mm))
    el.append(Spacer(1, 6 * mm))
    el.append(P("项目负责人：　　　　　　　　　(签字)", "body"))
    el.append(P("注册造价工程师：　　　　　　　(执业印章)", "body"))
    el.append(PageBreak())

    # ═══════════ 目录 ═══════════
    el.append(P("目　　录", "sec"))
    el.append(Spacer(1, 4 * mm))
    toc_items = [
        "一、工程概况",
        "二、审计依据",
        "三、审计范围与方法",
        "四、审计程序",
        "五、审计结果",
        "六、审计发现的主要问题及核减明细",
        "七、审计结论",
        "八、审计建议",
        "九、附件目录",
    ]
    for t in toc_items:
        el.append(P(t, "body"))
        el.append(Spacer(1, 2 * mm))
    el.append(PageBreak())

    # ═══════════ 一、工程概况 ═══════════
    el.append(P("一、工程概况", "sec"))
    el.append(P(
        f"本工程为{project.region or ''}的{project.project_type or ''}项目，采用{data['standard_label']}计价。"
        f"项目当前状态：{data['status_label']}；共含清单项 {data['total_items']} 项。"
        "本项目由建设单位委托，经图纸/清单套定额、计价计算与规则校验后，本公司实施复核审计。", "body"))
    overview_data = [
        ["工程名称", project_name, "建设地点", project.region or "-"],
        ["建设单位", project.owner or "-", "工程类型", project.project_type or "-"],
        ["计价标准", project.standard_type, "项目状态", data["status_label"]],
        ["工程量清单", f"{data['total_items']} 项", "总工程量", f"{data['total_qty']:,.4f}"],
        ["开工日期", str(project.start_date or "-"), "竣工日期", str(project.end_date or "-")],
        ["建筑面积", f"{data['area']:,.2f} ㎡" if data["area"] else "-", "项目预算", _fmt_money(project.budget) if project.budget else "-"],
    ]
    el.append(tbl(overview_data, bw))
    el.append(Spacer(1, 4 * mm))
    if data["fee_config"]:
        fc = data["fee_config"]
        el.append(P("规则包费率配置", "sub"))
        fee_data = [
            ["规则包", "管理费率", "利润率", "规费率", "增值税率"],
            [fc["name"], f"{fc['management_rate']*100:.1f}%", f"{fc['profit_rate']*100:.1f}%",
             f"{fc['regulatory_rate']*100:.1f}%", f"{fc['tax_rate']*100:.1f}%"],
        ]
        el.append(tbl(fee_data, [W / 5] * 5))
    el.append(PageBreak())

    # ═══════════ 二、审计依据 ═══════════
    el.append(P("二、审计依据", "sec"))
    el.append(P("本次审计依据下列法律法规、合同文件及计价依据实施：", "body"))
    basis = [["序号", "依据文件名称"]]
    for i, b in enumerate(_audit_basis(project), 1):
        basis.append([str(i), b])
    el.append(tbl(basis, [12 * mm, W - 12 * mm], fs=9.5))
    el.append(Spacer(1, 4 * mm))
    if data["fee_config"]:
        el.append(P(f"本项目适用规则包：“{data['fee_config']['name']}”。", "body"))
    el.append(PageBreak())

    # ═══════════ 三、审计范围与方法 ═══════════
    el.append(P("三、审计范围与方法", "sec"))
    el.append(P("3.1 审计范围", "sub"))
    el.append(P(
        f"本次审计范围为“{project_name}”项目《工程量清单》约定范围内的分部分项工程、措施项目与其他项目等全部造价内容。", "body"))
    el.append(P("3.2 审计方法", "sub"))
    el.append(P("本次审计以全面审核法为主，辅以重点抽查法、对比分析法和现场核实法：", "body"))
    methods = [
        ["审计方法", "具体应用"],
        ["全面审核法", "对清单项的分部分项工程量、综合单价、措施项目费、规费及税金逐项复核"],
        ["对比分析法", "将清单综合单价与规则包费率、本项目同类分部指标对比，筛查异常偏差"],
        ["重点抽查法", "对金额占比大、偏差率高的子目（未绑定、未计价、异常项等）重点复核"],
        ["规则校验法", "依据计价标准自动校验编码、单位、特征、定额绑定及人材机消耗合规性"],
    ]
    el.append(tbl(methods, [22 * mm, W - 22 * mm]))
    el.append(PageBreak())

    # ═══════════ 四、审计程序 ═══════════
    el.append(P("四、审计程序", "sec"))
    el.append(P("本公司按下列程序实施审计，全过程执行三级复核制度（编制人自审、审核人复审、审定人终审）：", "body"))
    prog = [["序号", "工作内容", "时间"]]
    for i, (name, d) in enumerate(data["schedule"], 1):
        prog.append([str(i), name, str(d)])
    el.append(tbl(prog, [12 * mm, (W - 12 * mm) * 0.66, (W - 12 * mm) * 0.34]))
    el.append(PageBreak())

    # ═══════════ 五、审计结果 ═══════════
    el.append(P("五、审计结果", "sec"))
    if data["has_submitted_anchor"]:
        el.append(P(
            f"经复核审计，本项目送审(报送)造价为 <b>{_fmt_money(data['submitted'])}</b> 元，"
            f"审定造价为 <b>{_fmt_money(data['audited'])}</b> 元，核减金额 <b>{_fmt_money(data['reduced'])}</b> 元，"
            f"核减率 <b>{data['reduce_rate']:.2f}%</b>。审计汇总指标如下：", "body"))
    else:
        el.append(P(
            f"经复核审计，本项目审定造价为 <b>{_fmt_money(data['audited'])}</b> 元（未设报送预算，核减 0 元）。审计汇总指标如下：", "body"))

    # 指标卡（简化为两栏表格）
    stat_table = [
        ["报送造价(元)", _fmt_money(data["submitted"]),
         "审定造价(元)", _fmt_money(data["audited"])],
        ["核减金额(元)", _fmt_money(data["reduced"]),
         "核减率", f"{data['reduce_rate']:.2f}%"],
        ["清单项总数", str(data["total_items"]),
         "清单总工程量", f"{data['total_qty']:,.4f}"],
    ]
    el.append(tbl(stat_table, [70 * mm, (W - 70 * mm) / 2, 40 * mm, (W - 70 * mm) / 2], fs=9))
    el.append(Spacer(1, 4 * mm))

    if data["grand_total"] > 0:
        el.append(P("5.1 造价构成分析", "sub"))
        cost_header = [["费用项目", "金额(元)", "占比", "说明"]]
        for name, val, pct, desc in _cost_rows(data):
            cost_header.append([name, _fmt_money(val), f"{pct:.1f}%", desc])
        t_cost = tbl(cost_header, [24 * mm, 30 * mm, 18 * mm, W - 72 * mm], fs=8.5)
        t_cost.setStyle(TableStyle([
            ("BACKGROUND", (0, len(cost_header) - 1), (-1, len(cost_header) - 1), colors.HexColor("#E2EFDA")),
            ("FONTNAME", (0, 0), (-1, 0), font),
        ]))
        el.append(t_cost)
        el.append(Spacer(1, 2 * mm))
        el.append(P(f"含税工程造价大写：{data['grand_upper']}", "body"))
    else:
        el.append(P("项目暂无计算结果数据，无法生成造价构成分析。", "body"))
    el.append(PageBreak())

    # ═══════════ 六、审计发现的主要问题及核减明细 ═══════════
    el.append(P("六、审计发现的主要问题及核减明细", "sec"))
    total_issues = data["errors"] + data["warnings"] + data["infos"]
    el.append(P(f"本次校验共发现 {total_issues} 项问题，其中错误 {data['errors']} 项、警告 {data['warnings']} 项、提示 {data['infos']} 项。各类问题明细如下。", "body"))

    el.append(P(f"6.1 规则校验问题明细（{len(data['rule_rows'])} 项）", "sub"))
    t_rule = tbl(issue_rows(data["rule_rows"]), [12 * mm, 30 * mm, (W - 42 * mm) * 0.55, (W - 42 * mm) * 0.45], fs=7.5)
    for i, r in enumerate(data["rule_rows"], start=1):
        t_rule.setStyle(TableStyle([("BACKGROUND", (0, i), (0, i), colors.HexColor(severity_color(r["severity"])))]))
    el.append(t_rule)
    el.append(Spacer(1, 5 * mm))

    el.append(P(f"6.2 计价审查问题明细（{len(data['pricing_rows'])} 项）", "sub"))
    t_price = tbl(issue_rows(data["pricing_rows"]), [12 * mm, 30 * mm, (W - 42 * mm) * 0.55, (W - 42 * mm) * 0.45], fs=7.5)
    for i, r in enumerate(data["pricing_rows"], start=1):
        t_price.setStyle(TableStyle([("BACKGROUND", (0, i), (0, i), colors.HexColor(severity_color(r["severity"])))]))
    el.append(t_price)

    if data["unbound_count"] > 0:
        el.append(Spacer(1, 5 * mm))
        el.append(P(f"6.3 未绑定定额清单项（{data['unbound_count']} 项，节选前 20 项）", "sub"))
        ub = [["编码", "名称", "单位", "工程量", "分部"]]
        for b in [x for x in data["boq_items"] if x.id not in data["binding_counts"]][:20]:
            ub.append([b.code, (b.name or "")[:18], b.unit, f"{b.quantity:.4f}", b.division or "-"])
        el.append(tbl(ub, [26 * mm, 32 * mm, 14 * mm, 20 * mm, W - 92 * mm], fs=8))
    el.append(PageBreak())

    # ═══════════ 七、审计结论 ═══════════
    el.append(P("七、审计结论", "sec"))
    el.append(P(f"经审计，本项目审定造价为：", "body"))
    el.append(P(f"{_fmt_money(data['audited'])} 元", "num"))
    el.append(P(f"(大写：{data['grand_upper']})", "bodyL"))
    el.append(Spacer(1, 4 * mm))
    con_rows = [
        ["风险评级", data["risk_level"]],
        ["错误数", str(data["errors"])],
        ["警告数", str(data["warnings"])],
        ["提示数", str(data["infos"])],
        ["绑定覆盖率", f"{data['bound_count']}/{data['total_items']}"],
        ["计算完成率", f"{data['has_calc']}/{data['total_items']}"],
    ]
    t_risk = tbl(con_rows, [34 * mm, 40 * mm], fs=10)
    risk_colors = {"高": "#fdecea", "中": "#fff8e1", "低": "#E2EFDA"}
    t_risk.setStyle(TableStyle([
        ("BACKGROUND", (1, 1), (1, 1), colors.HexColor(risk_colors.get(data["risk_level"], "#f5f5f5"))),
    ]))
    el.append(t_risk)
    el.append(Spacer(1, 4 * mm))
    el.append(P("结论说明：", "sub"))
    for i, f in enumerate(data["risk_factors"], 1):
        el.append(P(f"{i}. {f}", "body"))
    el.append(PageBreak())

    # ═══════════ 八、审计建议 ═══════════
    el.append(P("八、审计建议", "sec"))
    for i, s in enumerate(_suggestions(data), 1):
        el.append(P(f"<b>{i}.</b> {s}", "body"))
        el.append(Spacer(1, 2 * mm))
    el.append(Spacer(1, 4 * mm))
    extra = [
        "1. 强化变更签证过程管控：对设计变更与现场签证实行分级审批与限额控制，杜绝事后补签。",
        "2. 加强结算资料前置管理：按清单资料清单实行过程收集与阶段性归档，竣工前完成过程对账。",
        "3. 严格合同价差条款执行：结算审核中应严格执行合同约定的调差基准、风险幅度及信息价期次。",
        "4. 推行全过程跟踪审计：对投资额大、工期长的项目，建议开展全过程跟踪审计，将造价控制重心转向事前预防和事中控制。",
        "5. 建立争议协商机制：完善计量计价争议的合同协商条款，引入造价专家评审机制，及时化解分歧。",
    ]
    for e in extra:
        el.append(P(e, "body"))
        el.append(Spacer(1, 2 * mm))
    el.append(PageBreak())

    # ═══════════ 九、附件目录 ═══════════
    el.append(P("九、附件目录", "sec"))
    atts = [
        ["附件1", "工程造价复核审计汇总表", "1"],
        ["附件2", "分部分项工程量清单计价审定表", f"{min(data['total_items'], 99)}"],
        ["附件3", "规则校验问题明细表", f"{len(data['rule_rows'])}"],
        ["附件4", "计价审查问题明细表", f"{len(data['pricing_rows'])}"],
        ["附件5", "未绑定定额清单项明细表", f"{data['unbound_count']}"],
        ["附件6", "造价构成分析表", "1"],
    ]
    att_tbl = [["序号", "附件名称", "张数"]]
    for a in atts:
        att_tbl.append(list(a))
    el.append(tbl(att_tbl, [18 * mm, (W - 18 * mm) * 0.8, (W - 18 * mm) * 0.2]))
    el.append(Spacer(1, 4 * mm))
    el.append(P("注：附件为本报告组成部分，与报告正文具有同等效力，详见纸质版报告装订件。", "muted"))
    el.append(PageBreak())

    # ═══════════ 签字页 ═══════════
    el.append(P("报告签署", "sec"))
    sign_data = [
        ["编制人(注册造价工程师)", "审核人(注册造价工程师)", "审定人(技术负责人)", "企业法定代表人"],
        ["建〔造〕02100568 号", "建〔造〕02100912 号", "建〔造〕02100655 号", "—"],
    ]
    t_sign = Table(sign_data, colWidths=[W / 4] * 4)
    t_sign.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), font),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d8dee7")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 20),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, 1), [colors.HexColor("#f2f6fb"), colors.HexColor("#f2f6fb")]),
    ]))
    el.append(t_sign)
    el.append(Spacer(1, 18 * mm))
    el.append(P(f"{data['org_name']}(公章)", "body"))
    el.append(Spacer(1, 8 * mm))
    el.append(P(f"报告日期：{datetime.now(timezone.utc).strftime('%Y年%m月%d日')}", "body"))

    doc.build(el, onFirstPage=footer_cover, onLaterPages=footer_page)
    return buf.getvalue()


# ── HTML 导出（结算审计报告版式，单文件自包含） ─────────────────────────


def _html_escape(value) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def export_audit_report_html(project_id: int, db: Session) -> bytes:
    """按结算审计报告版式生成自包含 HTML 单文件（内联样式，无外部依赖）。"""
    data = _collect_audit_data(project_id, db)
    project = data["project"]
    project_name = project.name or "未命名项目"

    issue_table = ""
    if data["rule_rows"]:
        rows = "".join(
            f"<tr><td>{r['severity_label']}</td><td>{_html_escape(r['code'])}</td>"
            f"<td>{_html_escape(r['message'])}</td><td>{_html_escape(r['suggestion'])}</td></tr>"
            for r in data["rule_rows"]
        )
        issue_table = (
            "<thead><tr><th>级别</th><th>编码</th><th>问题描述</th><th>修正建议</th></tr></thead>"
            f"<tbody>{rows}</tbody>"
        )
    else:
        issue_table = "<tbody><tr><td>—</td><td>—</td><td>未发现问题</td><td>—</td></tr></tbody>"

    pricing_table = ""
    if data["pricing_rows"]:
        rows = "".join(
            f"<tr><td>{r['severity_label']}</td><td>{_html_escape(r['code'])}</td>"
            f"<td>{_html_escape(r['message'])}</td><td>{_html_escape(r['suggestion'])}</td></tr>"
            for r in data["pricing_rows"]
        )
        pricing_table = (
            "<thead><tr><th>级别</th><th>类型</th><th>问题描述</th><th>修正建议</th></tr></thead>"
            f"<tbody>{rows}</tbody>"
        )
    else:
        pricing_table = "<tbody><tr><td>—</td><td>—</td><td>未发现问题</td><td>—</td></tr></tbody>"

    sched_rows = "".join(
        f"<tr><td>{i}</td><td>{_html_escape(name)}</td><td>{d}</td></tr>"
        for i, (name, d) in enumerate(data["schedule"], 1)
    )
    basis_rows = "".join(
        f"<tr><td>{i}</td><td>{_html_escape(b)}</td></tr>"
        for i, b in enumerate(_audit_basis(project), 1)
    )
    division_rows = "".join(
        f"<tr><td>{_html_escape(ds['name'])}</td><td>{ds['count']}</td>"
        f"<td>{ds['total_qty']:,.2f}</td></tr>"
        for ds in data["division_stats"]
    )
    cost_rows = "".join(
        f"<tr><td>{name}</td><td>{_fmt_money(val)}</td><td>{pct:.1f}%</td><td>{_html_escape(desc)}</td></tr>"
        for name, val, pct, desc in _cost_rows(data)
    )
    unbound_rows = ""
    unbound_items = [b for b in data["boq_items"] if b.id not in data["binding_counts"]][:20]
    if unbound_items:
        unbound_rows = "".join(
            f"<tr><td>{_html_escape(b.code)}</td><td>{_html_escape((b.name or '')[:18])}</td>"
            f"<td>{_html_escape(b.unit)}</td><td>{b.quantity:,.2f}</td>"
            f"<td>{_html_escape(b.division or '-')}</td></tr>"
            for b in unbound_items
        )

    submitted_money = _html_escape(_fmt_money(data["submitted"]))
    audited_money = _html_escape(_fmt_money(data["audited"]))
    reduced_money = _html_escape(_fmt_money(data["reduced"]))
    price_rate = f"{data['reduce_rate']:.2f}"
    if data["has_submitted_anchor"]:
        submit_note = (
            f"<p>经复核审计，本项目送审(报送)造价为 <b>{submitted_money}</b> 元，"
            f"审定造价为 <b>{audited_money}</b> 元，核减金额 <b>{reduced_money}</b> 元，"
            f"<b>核减率 {price_rate}%</b>。审计汇总指标如下：</p>"
        )
    else:
        submit_note = (
            f"<p>经复核审计，本项目审定造价为 <b>{audited_money}</b> 元"
            f"（未设报送预算，核减 0 元）。审计汇总指标如下：</p>"
        )

    declare_li = "".join(
        f"<li>{_html_escape(d)}</li>" for d in [
            f"本公司接受委托，对“{project_name}”工程造价实施复核审计。审计过程中，我们遵循《工程造价咨询企业管理办法》《建设工程造价咨询成果文件质量标准》(CECA/GC 7) 等有关规定，恪守独立、客观、公正的执业原则。",
            "本报告以委托人提供的施工合同、清单、定额绑定、计价结果与校验记录等资料为审计基础，上述资料的真实性、完整性由资料提供方负责；若基础资料存在重大遗漏或失实，审计结果应作相应调整。",
            "本报告的审计范围与审计意见仅针对本项目工程造价复核，不构成对工程质量、施工合同履行及其他事项的鉴证意见。",
            "本报告仅供委托人用于本项目造价复核审计之目的。未经本公司书面同意，不得提供给委托人以外的单位或个人，不得作为其他用途使用。",
            "本公司及签字的注册造价工程师对本报告结论依法承担相应法律责任。",
        ]
    )

    methods_rows = "".join(
        f"<tr><td><b>{_html_escape(m[0])}</b></td><td>{_html_escape(m[1])}</td></tr>"
        for m in [
            ["全面审核法", "对清单项的分部分项工程量、综合单价、措施项目费、规费及税金逐项复核"],
            ["对比分析法", "将清单综合单价与规则包费率、本项目同类分部指标对比，筛查异常偏差"],
            ["重点抽查法", "对金额占比大、偏差率高的子目（未绑定、未计价、异常项等）重点复核"],
            ["规则校验法", "依据计价标准自动校验编码、单位、特征、定额绑定及人材机消耗合规性"],
        ]
    )

    suggestions_li = "".join(f"<li>{_html_escape(s)}</li>" for s in _suggestions(data))
    risk_li = "".join(f"<li>{_html_escape(f)}</li>" for f in data["risk_factors"])

    toc = "".join(
        f"<li><a href=\"#s{i}\">{t}</a></li>" for i, t in enumerate([
            "一、工程概况", "二、审计依据", "三、审计范围与方法", "四、审计程序",
            "五、审计结果", "六、审计发现的主要问题及核减明细", "七、审计结论",
            "八、审计建议", "九、附件目录",
        ], 1)
    )

    overview_rows = "".join(
        f"<tr><td><b>{_html_escape(a)}</b></td><td>{_html_escape(b)}</td>"
        f"<td><b>{_html_escape(c)}</b></td><td>{_html_escape(d)}</td></tr>"
        for a, b, c, d in [
            ["工程名称", project_name, "建设地点", project.region or "-"],
            ["建设单位", project.owner or "-", "工程类型", project.project_type or "-"],
            ["计价标准", project.standard_type, "项目状态", data["status_label"]],
            ["工程量清单", f"{data['total_items']} 项", "总工程量", f"{data['total_qty']:,.4f}"],
            ["开工日期", str(project.start_date or "-"), "竣工日期", str(project.end_date or "-")],
            ["建筑面积", f"{data['area']:,.2f} ㎡" if data["area"] else "-", "项目预算", _fmt_money(project.budget) if project.budget else "-"],
        ]
    )

    html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
:root {{
  --bg:#eef1f5;--bg2:#ffffff;--ink:#1d2b3a;--muted:#5c6b7c;--rule:#d8dee7;
  --accent:#1e4e8c;--accent2:#b03a2e;
}}
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0;}}
body{{font-family:'Microsoft YaHei','PingFang SC','SimHei',sans-serif;color:var(--ink);background:var(--bg);line-height:1.8;padding:2rem 1rem;}}
article.page{{max-width:960px;margin:0 auto;}}
.cover{{background:var(--bg2);border:1px solid var(--rule);border-top:8px solid var(--accent);padding:3.5rem 3rem;text-align:center;}}
.report-no{{font-size:0.9rem;color:var(--muted);text-align:right;}}
.org-name{{font-weight:700;font-size:1.05rem;color:var(--accent);letter-spacing:0.35em;margin-top:2.4rem;}}
.org-cert{{font-size:0.78rem;color:var(--muted);letter-spacing:0.1em;margin-top:0.4rem;}}
.cover h1{{font-size:1.9rem;font-weight:700;letter-spacing:0.1em;margin:3rem 0 1rem;}}
.subtitle{{font-size:1.25rem;color:var(--accent);letter-spacing:0.5em;font-weight:700;}}
.cover-rule{{width:4.5rem;height:3px;background:var(--accent);margin:2.4rem auto;}}
.cover-meta{{width:26rem;max-width:100%;margin:2rem auto 0;text-align:left;font-size:0.98rem;}}
.cover-meta .row{{display:flex;align-items:baseline;margin-bottom:1rem;}}
.cover-meta .label{{white-space:nowrap;letter-spacing:0.2em;color:var(--muted);}}
.cover-meta .value{{flex:1;border-bottom:1px solid var(--rule);margin-left:0.8rem;padding-left:0.5rem;text-align:center;font-weight:600;}}
.cover-date{{margin-top:3rem;color:var(--muted);letter-spacing:0.25em;font-size:0.95rem;}}
.statement,.toc,section.doc,.sign-page{{background:var(--bg2);border:1px solid var(--rule);padding:2.6rem 3rem;margin-top:1.5rem;}}
.statement h2,.toc h2{{text-align:center;letter-spacing:0.4em;text-indent:0.4em;margin-bottom:1.6rem;}}
.statement ol{{padding-left:1.4rem;}}
.statement li{{margin-bottom:0.9rem;text-align:justify;}}
.toc ol{{list-style:none;}}
.toc li{{margin-bottom:0.75rem;}}
.toc a{{color:var(--ink);text-decoration:none;}}
h2.sec{{font-size:1.3rem;font-weight:700;border-left:6px solid var(--accent);padding-left:0.85rem;padding-bottom:0.3rem;border-bottom:1px solid var(--rule);margin-bottom:1.6rem;letter-spacing:0.05em;}}
h3.sub{{font-size:1.05rem;font-weight:700;color:var(--accent);margin:2rem 0 0.9rem;}}
p{{margin-bottom:0.9rem;text-align:justify;}}
b.key{{color:var(--accent);}}
.stat-grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin:1.4rem 0 1.8rem;}}
.stat-card{{background:var(--bg2);border:1px solid var(--rule);border-top:3px solid var(--accent);padding:1rem;text-align:center;}}
.stat-card.alert{{border-top-color:var(--accent2);}}
.stat-card .label{{font-size:0.85rem;color:var(--muted);}}
.stat-card .value{{font-weight:700;font-size:1.5rem;color:var(--accent);margin-top:0.3rem;}}
.stat-card.alert .value{{color:var(--accent2);}}
.stat-card .unit{{font-size:0.85rem;color:var(--muted);}}
.table-wrap{{overflow-x:auto;margin:1rem 0 1.4rem;border:1px solid var(--rule);}}
table{{width:100%;border-collapse:collapse;font-size:0.92rem;min-width:620px;}}
thead th{{background:var(--accent);color:#fff;font-weight:600;padding:0.55rem 0.65rem;border:1px solid var(--accent);white-space:nowrap;}}
tbody td{{border:1px solid var(--rule);padding:0.45rem 0.6rem;}}
tbody tr:nth-child(even){{background:#f3f7fb;}}
td.num{{text-align:right;white-space:nowrap;}}
td.ctr{{text-align:center;}}
tr.total td{{font-weight:700;background:#eaf1f8;border-top:2px solid var(--accent);}}
.table-title{{font-weight:700;font-size:0.95rem;text-align:center;margin:1.6rem 0 0.2rem;}}
.callout{{border-left:4px solid var(--accent);background:#f0f5fb;padding:1rem 1.3rem;margin:1.3rem 0;}}
.callout .words{{font-weight:700;color:var(--accent);font-size:1.05rem;}}
.sign-table{{width:100%;border-collapse:collapse;margin-top:1rem;}}
.sign-table td{{border:1px solid var(--rule);padding:1.3rem 1rem;width:25%;}}
.seal-area{{margin-top:2.4rem;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:1.5rem;}}
.seal-mark{{width:9rem;height:9rem;border:2px solid #b08780;border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;color:#b08780;font-size:0.85rem;letter-spacing:0.2em;line-height:1.7;}}
footer.colophon{{margin-top:1.5rem;text-align:center;font-size:0.82rem;color:var(--muted);line-height:1.9;}}
footer.colophon .rule-line{{width:3rem;height:2px;background:var(--accent);margin:0.8rem auto;}}
@media print{{
  body{{background:#fff;padding:0;}}
  .cover,.statement,.toc,section.doc,.sign-page{{border:none;padding:1.2rem 0.5rem;}}
  .cover{{page-break-after:always;}}
  .statement,.toc{{page-break-after:always;}}
  .sign-page{{page-break-before:always;}}
  .table-wrap{{overflow:visible;}}
}}
</style>
</head>
<body>
<article class="page">

  <section class="cover">
    <div class="report-no">报告编号:{report_no}</div>
    <div class="org-name">{org_name}</div>
    <div class="org-cert">{org_cert}</div>
    <h1>{project_name}</h1>
    <div class="subtitle">工程造价复核审计报告</div>
    <div class="cover-rule"></div>
    <div class="cover-meta">
      <div class="row"><span class="label">委托单位</span><span class="value">{owner}</span></div>
      <div class="row"><span class="label">审计单位</span><span class="value">{org_name}</span></div>
      <div class="row"><span class="label">报告日期</span><span class="value">{generated_at}</span></div>
    </div>
    <div class="cover-date">{generated_at}</div>
  </section>

  <section class="statement">
    <h2>审 计 声 明</h2>
    <ol>{declare_li}</ol>
  </section>

  <nav class="toc">
    <h2>目　　录</h2>
    <ol>{toc}</ol>
  </nav>

  <section class="doc" id="s1">
    <h2 class="sec">一、工程概况</h2>
    <p>{overview_para}</p>
    <div class="table-wrap">
      <table>
        <tbody>{overview_rows}</tbody>
      </table>
    </div>
    {fee_config_html}
  </section>

  <section class="doc" id="s2">
    <h2 class="sec">二、审计依据</h2>
    <p>本次审计依据下列法律法规、合同文件及计价依据实施：</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th style="width:8%">序号</th><th>依据文件名称</th></tr></thead>
        <tbody>{basis_rows}</tbody>
      </table>
    </div>
  </section>

  <section class="doc" id="s3">
    <h2 class="sec">三、审计范围与方法</h2>
    <h3 class="sub">3.1 审计范围</h3>
    <p>本次审计范围为“{project_name}”项目《工程量清单》约定范围内的分部分项工程、措施项目与其他项目等全部造价内容。</p>
    <h3 class="sub">3.2 审计方法</h3>
    <p>本次审计以全面审核法为主，辅以重点抽查法、对比分析法和现场核实法。</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th style="width:20%">审计方法</th><th>具体应用</th></tr></thead>
        <tbody>{methods_rows}</tbody>
      </table>
    </div>
  </section>

  <section class="doc" id="s4">
    <h2 class="sec">四、审计程序</h2>
    <p>本公司按下列程序实施审计，全过程执行三级复核制度（编制人自审、审核人复审、审定人终审）：</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th style="width:8%">序号</th><th>工作内容</th><th>时间</th></tr></thead>
        <tbody>{sched_rows}</tbody>
      </table>
    </div>
  </section>

  <section class="doc" id="s5">
    <h2 class="sec">五、审计结果</h2>
    {submit_note}
    <div class="stat-grid">
      <div class="stat-card"><div class="label">报送造价</div><div class="value">{submitted}<span class="unit">元</span></div></div>
      <div class="stat-card"><div class="label">审定造价</div><div class="value">{audited}<span class="unit">元</span></div></div>
      <div class="stat-card alert"><div class="label">核减金额</div><div class="value">{reduced}<span class="unit">元</span></div></div>
      <div class="stat-card alert"><div class="label">核减率</div><div class="value">{rate}<span class="unit">%</span></div></div>
    </div>
    <div class="table-title">表5-1　造价构成分析表</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>费用项目</th><th>金额(元)</th><th>占比</th><th>说明</th></tr></thead>
        <tbody>{cost_rows}</tbody>
      </table>
    </div>
    <div class="callout"><p class="words">含税工程造价大写：{grand_upper}</p></div>
  </section>

  <section class="doc" id="s6">
    <h2 class="sec">六、审计发现的主要问题及核减明细</h2>
    <p>本次校验共发现 <b>{total_issues}</b> 项问题，其中错误 <b>{errors}</b> 项、警告 <b>{warnings}</b> 项、提示 <b>{infos}</b> 项。各类问题明细如下。</p>
    <h3 class="sub">6.1 规则校验问题明细</h3>
    <div class="table-wrap"><table>{issue_table}</table></div>
    <h3 class="sub">6.2 计价审查问题明细</h3>
    <div class="table-wrap"><table>{pricing_table}</table></div>
    {unbound_html}
  </section>

  <section class="doc" id="s7">
    <h2 class="sec">七、审计结论</h2>
    <div class="callout">
      <p>经审计，本项目审定造价为：</p>
      <p class="words">{audited} 元</p>
      <p class="words">(大写：{grand_upper})</p>
    </div>
    <p>风险评级：<b>{risk_level}</b>（错误 {errors} 项、警告 {warnings} 项、提示 {infos} 项；绑定覆盖率 {bound}/{total_items}；计算完成率 {has_calc}/{total_items}）。</p>
    <ul style="padding-left:1.4rem;">{risk_li}</ul>
  </section>

  <section class="doc" id="s8">
    <h2 class="sec">八、审计建议</h2>
    <ol style="padding-left:1.4rem;">{suggestions_li}</ol>
  </section>

  <section class="doc" id="s9">
    <h2 class="sec">九、附件目录</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th style="width:10%">序号</th><th>附件名称</th><th style="width:16%">张数</th></tr></thead>
        <tbody>
          <tr><td>附件1</td><td>工程造价复核审计汇总表</td><td>1</td></tr>
          <tr><td>附件2</td><td>分部分项工程量清单计价审定表</td><td>{total_items}</td></tr>
          <tr><td>附件3</td><td>规则校验问题明细表</td><td>{len_rule}</td></tr>
          <tr><td>附件4</td><td>计价审查问题明细表</td><td>{len_pricing}</td></tr>
          <tr><td>附件5</td><td>未绑定定额清单项明细表</td><td>{unbound}</td></tr>
          <tr><td>附件6</td><td>造价构成分析表</td><td>1</td></tr>
        </tbody>
      </table>
    </div>
    <p>注：附件为本报告组成部分，与报告正文具有同等效力，详见纸质版报告装订件。</p>
  </section>

  <section class="sign-page">
    <h2 class="sec">报告签署</h2>
    <table class="sign-table">
      <tbody>
        <tr>
          <td>编制人(注册造价工程师)<br><br></td>
          <td>审核人(注册造价工程师)<br><br></td>
          <td>审定人(技术负责人)<br><br></td>
          <td>企业法定代表人<br><br></td>
        </tr>
        <tr><td colspan="4">执业印章编号：建〔造〕02100568 号 · 建〔造〕02100912 号</td></tr>
      </tbody>
    </table>
    <div class="seal-area">
      <div><p>{org_name}(公章)</p></div>
      <div class="seal-mark">工程造价咨询<br>执业专用章<br>————————<br>筑衡工程造价<br>咨询有限公司</div>
      <div><p>报告日期:{generated_at}</p></div>
    </div>
  </section>

  <footer class="colophon">
    <div class="rule-line"></div>
    <p>{org_name} · {org_cert}</p>
    <p>{org_address} · 电话:{org_phone} · 本报告仅供委托人复核审计使用</p>
  </footer>
</article>
</body>
</html>
"""

    fee_config_html = ""
    if data["fee_config"]:
        fc = data["fee_config"]
        fee_config_html = (
            '<h3 class="sub">规则包费率配置</h3>'
            "<div class=\"table-wrap\"><table>"
            "<thead><tr><th>规则包</th><th>管理费率</th><th>利润率</th><th>规费率</th><th>增值税率</th></tr></thead>"
            "<tbody><tr>"
            f"<td>{_html_escape(fc['name'])}</td>"
            f"<td>{fc['management_rate']*100:.1f}%</td>"
            f"<td>{fc['profit_rate']*100:.1f}%</td>"
            f"<td>{fc['regulatory_rate']*100:.1f}%</td>"
            f"<td>{fc['tax_rate']*100:.1f}%</td>"
            "</tr></tbody></table></div>"
        )

    unbound_html = ""
    if unbound_items:
        unbound_html = (
            '<h3 class="sub">6.3 未绑定定额清单项（节选前20项）</h3>'
            '<div class="table-wrap"><table>'
            "<thead><tr><th>编码</th><th>名称</th><th>单位</th><th>工程量</th><th>分部</th></tr></thead>"
            f"<tbody>{unbound_rows}</tbody></table></div>"
        )

    rendered = html.format(
        report_no=_html_escape(data["report_no"]),
        org_name=_html_escape(data["org_name"]),
        org_cert=_html_escape(data["org_cert"]),
        org_address=_html_escape(data["org_address"]),
        org_phone=_html_escape(data["org_phone"]),
        project_name=_html_escape(project_name),
        title=_html_escape(f"{project_name}工程造价复核审计报告"),
        owner=_html_escape(project.owner or "-"),
        generated_at=_html_escape(data["generated_at"]),
        declare_li=declare_li,
        toc=toc,
        overview_para=_html_escape(
            f"本工程为{project.region or ''}的{project.project_type or ''}项目，采用{data['standard_label']}计价。"
            f"项目当前状态:{data['status_label']}；共含清单项 {data['total_items']} 项。"
            "本项目由建设单位委托，经图纸/清单套定额、计价计算与规则校验后，本公司实施复核审计。"
        ),
        overview_rows=overview_rows,
        fee_config_html=fee_config_html,
        basis_rows=basis_rows,
        methods_rows=methods_rows,
        sched_rows=sched_rows,
        submit_note=submit_note,
        submitted=_fmt_money(data["submitted"]),
        audited=_fmt_money(data["audited"]),
        reduced=_fmt_money(data["reduced"]),
        rate=f"{data['reduce_rate']:.2f}",
        cost_rows=cost_rows,
        grand_upper=_html_escape(data["grand_upper"]),
        total_issues=data["errors"] + data["warnings"] + data["infos"],
        errors=data["errors"],
        warnings=data["warnings"],
        infos=data["infos"],
        issue_table=issue_table,
        pricing_table=pricing_table,
        unbound_html=unbound_html,
        risk_level=_html_escape(data["risk_level"]),
        bound=data["bound_count"],
        total_items=data["total_items"],
        has_calc=data["has_calc"],
        risk_li=risk_li,
        suggestions_li=suggestions_li,
        len_rule=len(data["rule_rows"]),
        len_pricing=len(data["pricing_rows"]),
        unbound=data["unbound_count"],
    )

    return rendered.encode("utf-8")


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
        ["报告编号", data["report_no"]],
        ["项目状态", data["status_label"]],
        ["项目地区", project.region or "-"],
        ["工程类型", project.project_type or "-"],
        ["项目预算", str(project.budget) if project.budget else "-"],
        ["计价标准", project.standard_type],
        ["币种", project.currency or "CNY"],
        ["建设单位", project.owner or "-"],
        ["开始日期", str(project.start_date or "-")],
        ["结束日期", str(project.end_date or "-")],
        ["报送造价(元)", f"{data['submitted']:.2f}"],
        ["审定造价(元)", f"{data['audited']:.2f}"],
        ["核减金额(元)", f"{data['reduced']:.2f}"],
        ["核减率", f"{data['reduce_rate']:.2f}%"],
    ]
    write_table(ws1, 4, ["项目属性", "值"], overview, [20, 40])

    if data["fee_config"]:
        fc = data["fee_config"]
        ws1.cell(row=21, column=1, value="规则包费率配置").font = Font(bold=True, size=11)
        write_table(ws1, 22, ["费率项", "配置值"],
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
        write_table(ws3, 4, ["费用项目", "金额（元）", "占比"], cost_rows, [20, 20, 12])
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
        ["审定造价(元)", f"{data['audited']:.2f}"],
        ["核减金额(元)", f"{data['reduced']:.2f}"],
    ]
    write_table(ws6, 4, ["审计指标", "结果"], conclusion, [20, 20])
    if data["risk_factors"]:
        ws6.cell(row=14, column=1, value="风险因素").font = Font(bold=True, size=11)
        for i, f in enumerate(data["risk_factors"]):
            ws6.cell(row=15 + i, column=1, value=f"{i+1}. {f}")
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
        row_start = 15 + len(data["risk_factors"]) + 1
        ws6.cell(row=row_start, column=1, value="建议行动").font = Font(bold=True, size=11)
        for i, s in enumerate(suggestions):
            ws6.cell(row=row_start + 1 + i, column=1, value=s)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()