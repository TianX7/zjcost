"""PDF report export using ReportLab.

Generates a professional valuation report PDF with:
- Cover page (project info)
- Cost summary table
- Division breakdown table
- Line-item detail table
"""

from __future__ import annotations

import io
from collections import defaultdict
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy.orm import Session

from app.models.boq_item import BoqItem
from app.models.line_item_quota_binding import LineItemQuotaBinding
from app.models.project import Project
from app.services.project_calc_service import run_project_calculation


def _register_chinese_font() -> str:
    """Try to register a Chinese-capable font; fall back to Helvetica."""
    import os
    import platform

    font_candidates = []
    if platform.system() == "Darwin":
        font_candidates = [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Light.ttc",
            "/System/Library/Fonts/Supplemental/Songti.ttc",
        ]
    elif platform.system() == "Linux":
        font_candidates = [
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        ]
    elif platform.system() == "Windows":
        font_candidates = [
            os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts", "msyh.ttc"),
            os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts", "simsun.ttc"),
        ]

    for path in font_candidates:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont("ChineseFont", path, subfontIndex=0))
                return "ChineseFont"
            except Exception:
                continue

    return "Helvetica"


def export_valuation_pdf(project_id: int, db: Session) -> bytes:
    """按《实训手册》版式生成招标控制价 PDF。"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError(f"Project {project_id} not found")

    summary, line_results = run_project_calculation(project_id=project_id, db=db)
    from app.services.export_service import _cn_upper, division_rank

    font_name = _register_chinese_font()
    grand = float(summary.grand_total or 0)
    total_boq = float(sum((r.total or 0) for _, r in line_results))
    regulatory = float(summary.total_regulatory or 0)
    tax = float(summary.total_tax or 0)
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    project_name = project.name or "未命名项目"
    bid_section = f"{project.region} {project_name}工程"
    rows = sorted(line_results, key=lambda x: (division_rank(x[0].division or ""), x[0].sort_order))
    div_sums: dict[str, float] = {}
    for boq, result in rows:
        d = boq.division or "未分类"
        div_sums[d] = div_sums.get(d, 0.0) + float(result.total or 0)

    buf = io.BytesIO()
    try:
        doc = SimpleDocTemplate(buf, pagesize=landscape(A4) if False else A4,
                                leftMargin=12 * mm, rightMargin=12 * mm,
                                topMargin=14 * mm, bottomMargin=14 * mm)

        def P(txt, size=9, align=0, bold=False, after=0, before=0):
            return Paragraph(txt, ParagraphStyle(
                "CN", fontName=font_name, fontSize=size, leading=size + 5,
                alignment=align, spaceAfter=after, spaceBefore=before, wordWrap="CJK",
                fontWeight="bold" if bold else "normal",
            ))

        def tbl(data, widths, header_rows=1, fs=7.5, total_row=None):
            st = [
                ("FONTNAME", (0, 0), (-1, -1), font_name),
                ("FONTSIZE", (0, 0), (-1, -1), fs),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("BACKGROUND", (0, 0), (-1, header_rows - 1), colors.HexColor("#D9EAF7")),
            ]
            if total_row is not None:
                st.append(("BACKGROUND", (0, total_row), (-1, total_row), colors.HexColor("#E2EFDA")))
            t = Table(data, colWidths=widths, repeatRows=header_rows)
            t.setStyle(TableStyle(st))
            return t

        def footer(canvas, doc_):
            canvas.saveState()
            canvas.setFont(font_name, 7)
            canvas.drawCentredString(A4[0] / 2, 8 * mm, f"{project_name} — 招标控制价    第 {doc_.page} 页")
            canvas.restoreState()

        el: list = []
        W = doc.width

        # ── 封-2 ──
        el.append(Spacer(1, 20 * mm))
        el.append(P("工　程", 14, 1))
        el.append(Spacer(1, 24 * mm))
        el.append(P("招标控制价", 30, 1, bold=True))
        el.append(Spacer(1, 6 * mm))
        el.append(P(f"（{project_name}）", 13, 1))
        el.append(Spacer(1, 16 * mm))
        el.append(P("招  标  人：＿＿＿＿＿＿＿＿＿＿", 12, 0))
        el.append(Spacer(1, 6 * mm))
        el.append(P(f"招标控制价（小写）：{grand:,.2f} 元", 12, 0))
        el.append(Spacer(1, 4 * mm))
        el.append(P(f"（大写）：{_cn_upper(grand)}", 12, 0))
        el.append(Spacer(1, 12 * mm))
        el.append(P(f"编制时间：{generated}", 12, 0))
        el.append(Spacer(1, 42 * mm))
        el.append(P("封-2", 9, 2))
        el.append(PageBreak())

        # ── 扉-2 ──
        el.append(Spacer(1, 22 * mm))
        el.append(P("工　程", 14, 1))
        el.append(Spacer(1, 26 * mm))
        el.append(P("招标控制价", 24, 1, bold=True))
        el.append(Spacer(1, 18 * mm))
        el.append(P("招标控制价（小写）：", 12, 0))
        el.append(P(f"{grand:,.2f} 元", 13, 1))
        el.append(Spacer(1, 4 * mm))
        el.append(P("（大写）：", 12, 0))
        el.append(P(_cn_upper(grand), 12, 1))
        el.append(Spacer(1, 14 * mm))
        el.append(P(f"编制时间：{generated}", 12, 0))
        el.append(Spacer(1, 30 * mm))
        el.append(P("扉—2", 9, 2))
        el.append(PageBreak())

        # ── 表-01 总说明 ──
        el.append(P("总  说  明", 16, 1, bold=True, after=6))
        el.append(P(f"工程名称：{project_name}", 10, 0, after=8))
        for n in [
            f"一、工程概况：本工程为{project_name}，位于{project.region}；计价标准 {project.standard_type}；币种 {project.currency}。",
            f"二、招标控制价合计 {grand:,.2f} 元，其中分部分项工程费 {total_boq:,.2f} 元，规费 {regulatory:,.2f} 元，税金 {tax:,.2f} 元。",
            "三、综合单价包含人工费、材料费、机械费、管理费、利润、规费和税金。",
            "四、措施项目费、其他项目费本工程暂按 0 填报，若发生按实调整。",
        ]:
            el.append(P("　　" + n, 10, 0, after=5))
        el.append(P("表-01", 9, 2, before=8))
        el.append(PageBreak())

        # ── 表-04 ──
        el.append(P("单位工程招标控制价汇总表", 14, 1, bold=True, after=4))
        el.append(P(f"工程名称：{project_name}　　标段：{bid_section}　　第  1  页  共  1  页", 9, 0, after=4))
        d4 = [["序号", "汇总内容", "金额（元）", "其中：暂估价(元)"]]
        def s4(no, name, val):
            d4.append([no, name, f"{val:,.2f}" if val is not None else "", ""])
        s4("一", "分部分项工程费", total_boq)
        for i, (d_, s_) in enumerate(sorted(div_sums.items(), key=lambda kv: division_rank(kv[0])), 1):
            s4(f"1.{i}", d_, s_)
        s4("二", "措施项目费", 0.0)
        s4("2.1", "单价措施项目费", 0.0)
        s4("2.2", "总价措施项目费", 0.0)
        s4("2.21", "其中：安全文明施工费", 0.0)
        s4("三", "其他项目费", 0.0)
        s4("3.1", "暂列金额", 0.0)
        s4("3.2", "暂估价", 0.0)
        s4("3.3", "计日工", 0.0)
        s4("3.4", "总承包服务费", 0.0)
        s4("四", "规费", regulatory)
        s4("五", "税前工程造价", total_boq + regulatory)
        s4("六", "税金", tax)
        el.append(tbl(d4, [14 * mm, 70 * mm, 34 * mm, 30 * mm], fs=8))
        el.append(P("招标控制价合计=一+二+三+四+六", 8, 0, before=4))
        el.append(P("注：本表适用于单位工程招标控制价或投标报价的汇总，如无单位工程划分，单项工程也使用本表汇总", 8, 0))
        el.append(P("表—04", 9, 2, before=4))
        el.append(PageBreak())

        # ── 表-08 ──
        el.append(P("分部分项工程和单价措施项目清单与计价表", 14, 1, bold=True, after=4))
        el.append(P(f"工程名称：{project_name}　　标段：{bid_section}　　第  1  页  共  1  页", 9, 0, after=4))
        d8 = [["序号", "项目编码", "项目名称", "项目特征描述", "计量单位", "工程量", "综合单价", "合价", "其中：暂估价"]]
        for i, (boq, result) in enumerate(rows, 1):
            qty = float(boq.quantity or 1) or 1
            tot = float(result.total or 0)
            d8.append([str(i), boq.code or "", boq.name or "", boq.division or "未分类",
                       boq.unit or "", f"{qty:,.2f}", f"{tot / qty:,.2f}", f"{tot:,.2f}", ""])
        if not rows:
            d8.append(["", "", "（无清单数据）", "", "", "", "", "", ""])
        d8.append(["本页小计", "", "", "", "", "", "", f"{total_boq:,.2f}", ""])
        el.append(tbl(d8, [10 * mm, 24 * mm, 36 * mm, 30 * mm, 12 * mm, 16 * mm, 18 * mm, 18 * mm, 14 * mm], fs=7))
        el.append(P("注：为计取规费等的使用，可在表中增设其中：“定额人工费”。", 8, 0, before=4))
        el.append(P("表-08", 9, 2, before=2))
        el.append(PageBreak())

        # ── 表-09 ──
        el.append(P("综合单价分析表", 14, 1, bold=True, after=4))
        el.append(P(f"工程名称：{project_name}　　标段：{bid_section}", 9, 0, after=4))
        for boq, result in rows:
            qty = float(boq.quantity or 1) or 1
            lab, mat, mac = float(result.labor_cost or 0), float(result.material_cost or 0), float(result.machine_cost or 0)
            mng, pro, tot = float(result.management_fee or 0), float(result.profit or 0), float(result.total or 0)
            up = lambda v: (v / qty) if qty else 0
            blk = [[
                f"项目编码：{boq.code or ''}", f"项目名称：{boq.name or ''}",
                f"计量单位：{boq.unit or ''}", f"工程量：{qty:,.2f}",
            ]]
            el.append(tbl(blk, [W / 4.0] * 4, header_rows=0, fs=8))
            hdr = [["定额\n编号", "定额项目名称", "定额\n单位", "数量", "单价", "", "", "", "", "", "合价", "", "", "", "", ""],
                   ["", "", "", "", "人工费", "材料费", "机械费", "管理费和利润", "风险费", "", "人工费", "材料费", "机械费", "管理费和利润", "风险费", ""]]
            el.append(tbl(hdr, [W / 16.0] * 16, fs=6.5))
            r1 = [["1-01", "综合定额（组价结果）", boq.unit or "", f"{qty:,.2f}",
                   f"{up(lab):,.2f}", f"{up(mat):,.2f}", f"{up(mac):,.2f}", f"{up(mng + pro):,.2f}", "0", "",
                   f"{lab:,.2f}", f"{mat:,.2f}", f"{mac:,.2f}", f"{mng + pro:,.2f}", "0", ""]]
            el.append(tbl(r1, [W / 16.0] * 16, header_rows=0, fs=6.5))
            el.append(P(f"人工单价：一类人工 114 元/工日　　未计价材料费：0　　清单项目综合单价：{(tot / qty if qty else 0):,.2f}", 8, 0, before=3))
            mtl = [["主要材料名称、规格、型号", "单位", "数量", "单价（元）", "合价（元）", "暂估单价", "暂估合价"],
                   ["主要材料（综合）", boq.unit or "", f"{qty:,.2f}", f"{up(mat):,.2f}", f"{mat:,.2f}", "0", "0"],
                   ["合价", "", "", "", f"{mat:,.2f}", "", ""]]
            el.append(tbl(mtl, [W / 7.0] * 7, fs=7))
            el.append(Spacer(1, 5 * mm))
        if not rows:
            el.append(P("（无清单数据）", 10, 1))
        el.append(P("注：1.如不使用省级或行业建设主管部门发布的计价依据，可不填定额编码、名称等；2.招标文件提供了暂估单价的材料，按暂估的单价填入相应栏。", 8, 0))
        el.append(P("表-09", 9, 2, before=2))
        el.append(PageBreak())

        # ── 表-11 ──
        el.append(P("总价措施项目清单与计价表", 14, 1, bold=True, after=4))
        el.append(P(f"工程名称：{project_name}　　标段：{bid_section}　　第  1  页  共  1  页", 9, 0, after=4))
        d11 = [["序号", "项目编码", "项目名称", "计算基础", "费率(%)", "金额(元)", "调整费率(%)", "调整后金额(元)", "备注"]]
        for no, code, name, base, note in [
            (9, "011707001001", "安全文明施工", "", ""),
            (10, "011707001002", "其中：环境保护费、文明施工费、安全施工费", "分部分项人工费+分部分项机械费+单价措施项目人工费+单价措施项目机械费", ""),
            (11, "011707001003", "其中：临时设施费", "分部分项人工费+分部分项机械费+单价措施项目人工费+单价措施项目机械费", ""),
            (12, "011707001004", "其中：智慧工地基础配置费", "", ""),
            (13, "011707002001", "夜间施工增加费", "20.7*10", "按实际发生计取，不发生不计取。"),
            (14, "011707004001", "二次搬运费", "分部分项人工费+分部分项机械费+单价措施项目人工费+单价措施项目机械费", ""),
            (15, "011707005001", "冬雨季施工增加费", "", "不发生不计取"),
            (16, "011707007001", "已完工程及设备保护费", "分部分项人工费+分部分项机械费+单价措施项目人工费+单价措施项目机械费", ""),
            (17, "X011707008001", "工程定位复测、点交清理费", "分部分项人工费+分部分项机械费+单价措施项目人工费+单价措施项目机械费", ""),
            (18, "X011707010001", "检验试验费", "", ""),
            (19, "X011707010002", "其中：自检试验费", "", ""),
            (20, "X011707010003", "其中：检验试验配合费", "分部分项人工费+分部分项机械费+单价措施项目人工费+单价措施项目机械费", ""),
            (21, "X011707011001", "特殊地区增加费", "", "结合工程实际情况，按相关规定计取。"),
            (22, "01B991", "竣工档案编制费", "分部分项人工费+分部分项机械费+单价措施项目人工费+单价措施项目机械费", ""),
        ]:
            d11.append([str(no), code, name, base, "", "", "", "", note])
        el.append(tbl(d11, [9 * mm, 22 * mm, 34 * mm, 52 * mm, 10 * mm, 14 * mm, 12 * mm, 16 * mm, 24 * mm], fs=6.5))
        el.append(P("编制人（造价人员）：　　　　　　　　　　复核人（造价工程师）：", 9, 0, before=4))
        el.append(P("注：1.“计算基础”中安全文明施工费可为“定额基价”、“定额人工费”或“定额人工费+定额机械费”。", 8, 0))
        el.append(P("表-11", 9, 2, before=2))
        el.append(PageBreak())

        # ── 表-12 ──
        el.append(P("其他项目清单与计价汇总表", 14, 1, bold=True, after=4))
        el.append(P(f"工程名称：{project_name}　　标段：{bid_section}　　第  1  页  共  1  页", 9, 0, after=4))
        d12 = [["序号", "项目名称", "金额(元)", "结算金额(元)", "备注"]]
        for no, name, note in [
            ("1", "暂列金额", "明细详见表-12-1"), ("2", "暂估价", ""), ("2.1", "材料暂估价", "明细详见表-12-2"),
            ("2.2", "专业工程暂估价", "明细详见表-12-3"), ("2.3", "施工技术专项措施项目暂估价", "明细详见表-12-7"),
            ("3", "计日工", "明细详见表-12-4"), ("4", "总承包服务费", "明细详见表-12-5"),
        ]:
            d12.append([no, name, "", "", note])
        d12.append(["", "合    计", "0.00", "", "—"])
        el.append(tbl(d12, [14 * mm, 60 * mm, 30 * mm, 30 * mm, 50 * mm], fs=8, total_row=len(d12) - 1))
        el.append(P("注：材料（工程设备）暂估单价进入清单项目综合单价，此处不汇总。", 8, 0, before=4))
        el.append(P("表-12", 9, 2, before=2))
        el.append(PageBreak())

        # ── 表-12-1 ──
        el.append(P("暂列金额明细表", 14, 1, bold=True, after=4))
        el.append(P(f"工程名称：{project_name}　　标段：{bid_section}　　第 1 页  共 1 页", 9, 0, after=4))
        d121 = [["序号", "项目名称", "计量单位", "暂定金额(元)", "备注"],
                ["1", "工程造价上涨", "项", "", ""], ["2", "建筑工程", "项", "", ""], ["3", "装饰工程", "项", "", ""],
                ["", "合    计", "", "0.00", "—"]]
        el.append(tbl(d121, [14 * mm, 50 * mm, 20 * mm, 30 * mm, 50 * mm], fs=8, total_row=4))
        el.append(P("注：此表由招标人填写，如不能详列，也可只列暂列金额总额，投标人应将上述暂列金额计入投标总价中。", 8, 0, before=4))
        el.append(P("表—12—1", 9, 2, before=2))
        el.append(PageBreak())

        # ── 表-12-3 ──
        el.append(P("专业工程暂估价及结算价表", 14, 1, bold=True, after=4))
        el.append(P(f"工程名称：{project_name}　　标段：{bid_section}　　第  1  页  共  1  页", 9, 0, after=4))
        d123 = [["序号", "工程名称", "工程内容", "暂估金额（元）", "结算金额(元)", "差额±(元)", "备注"],
                ["1", "地基处理", "CFG桩施工", "", "", "", ""],
                ["", "合    计", "", "0.00", "", "", "—"]]
        el.append(tbl(d123, [12 * mm, 30 * mm, 40 * mm, 25 * mm, 25 * mm, 22 * mm, 30 * mm], fs=8, total_row=2))
        el.append(P("注：此表“暂估金额”由招标人填写，投标人应将“暂估金额”计入投标总价中。结算时按合同约定结算金额填写。", 8, 0, before=4))
        el.append(P("表—12—3", 9, 2, before=2))
        el.append(PageBreak())

        # ── 表-12-4 ──
        el.append(P("计 日 工 表", 14, 1, bold=True, after=4))
        el.append(P(f"工程名称：{project_name}　　标段：{bid_section}　　第  1  页  共  1  页", 9, 0, after=4))
        d124 = [["编号", "项目名称", "单位", "暂定数量", "实际数量", "综合单价(元)", "合价(暂定)", "合价(实际)"],
                ["1", "人工", "", "", "", "", "", ""],
                ["1.1", "土建综合工日", "工日", "", "", "", "", ""],
                ["", "人工小计", "", "", "", "", "0.00", ""],
                ["2", "材料", "", "", "", "", "", ""],
                ["2.1", "钢筋 HPB300 Φ10", "t", "", "", "", "", ""],
                ["2.2", "水泥42.5", "t", "", "", "", "", ""],
                ["", "材料小计", "", "", "", "", "0.00", ""],
                ["3", "机械", "", "", "", "", "", ""],
                ["3.1", "自升式塔吊起重机", "台班", "", "", "", "", ""],
                ["", "机械小计", "", "", "", "", "0.00", ""],
                ["4", "企业管理费和利润", "", "", "", "", "", ""],
                ["", "总    计", "", "", "", "", "0.00", ""]]
        el.append(tbl(d124, [12 * mm, 42 * mm, 14 * mm, 18 * mm, 18 * mm, 20 * mm, 22 * mm, 22 * mm], fs=7.5, total_row=12))
        el.append(P("注：此表项目名称、暂定数量由招标人填写，编制招标控制价时，单价由招标人按有关计价规定确定。", 8, 0, before=4))
        el.append(P("表—12—4", 9, 2, before=2))
        el.append(PageBreak())

        # ── 表-12-5 ──
        el.append(P("总承包服务费计价表", 14, 1, bold=True, after=4))
        el.append(P(f"工程名称：{project_name}　　标段：{bid_section}　　第  1  页  共  1  页", 9, 0, after=4))
        d125 = [["序号", "项目名称", "项目价值(元)", "服务内容", "计算基础", "费率(%)", "金额(元)"],
                ["1", "专业发包工程管理费", "", "施工质量、进度管理；竣工资料管理", "", "", ""],
                ["2", "甲供材料设备保管费", "", "", "", "", ""],
                ["", "合    计", "", "", "", "", "0.00"]]
        el.append(tbl(d125, [12 * mm, 34 * mm, 22 * mm, 46 * mm, 26 * mm, 12 * mm, 20 * mm], fs=8, total_row=3))
        el.append(P("注：此表项目名称、服务内容由招标人填写，编制招标控制价时，费率及金额由招标人按有关计价规定确定。", 8, 0, before=4))
        el.append(P("表—12—5", 9, 2, before=2))
        el.append(PageBreak())

        # ── 表-13 ──
        el.append(P("规费、税金项目计价表", 14, 1, bold=True, after=4))
        el.append(P(f"工程名称：{project_name}　　标段：{bid_section}　　第  1  页  共  1  页", 9, 0, after=4))
        d13 = [["序号", "项目名称", "计算基础", "计算基数", "计算费率(%)", "金额（元）"]]
        for no, name, base in [
            ("1", "规费", "社会保险费+住房公积金"),
            ("1.1", "社会保险费", "养老保险费+失业保险费+医疗保险费+工伤保险费"),
            ("1.11", "养老保险费", "分部分项人工费+分部分项机械费+单价措施项目人工费+单价措施项目机械费"),
            ("1.12", "失业保险费", "分部分项人工费+分部分项机械费+单价措施项目人工费+单价措施项目机械费"),
            ("1.13", "医疗保险费", "分部分项人工费+分部分项机械费+单价措施项目人工费+单价措施项目机械费"),
            ("1.14", "工伤保险费", "分部分项人工费+分部分项机械费+单价措施项目人工费+单价措施项目机械费"),
            ("1.2", "住房公积金", "分部分项人工费+分部分项机械费+单价措施项目人工费+单价措施项目机械费"),
            ("2", "税金", "税前工程造价"),
        ]:
            amt = f"{tax:,.2f}" if no == "2" else ""
            d13.append([no, name, base, "", "", amt])
        d13.append(["", "合计", "", "", "", f"{regulatory + tax:,.2f}"])
        el.append(tbl(d13, [12 * mm, 30 * mm, 66 * mm, 20 * mm, 18 * mm, 24 * mm], fs=7.5, total_row=len(d13) - 1))
        el.append(P("编制人（造价人员）：　　　　　　　　　　复核人（造价工程师）：", 9, 0, before=4))
        el.append(P("表-13", 9, 2, before=2))

        doc.build(el, onFirstPage=footer, onLaterPages=footer)
        return buf.getvalue()
    finally:
        buf.close()
