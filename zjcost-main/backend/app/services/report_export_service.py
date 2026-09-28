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


# ── HTML 导出（成果报表版式，单文件自包含） ────────────────────────────────
# 版式对齐应用根目录下的 cost-project-report.html（造价执行报表模板）：
# 封面 / 编制说明 / 目录 / 项目概况 / 投资完成总览 / 造价构成分析 /
# 分部执行 / 清单明细 / 绑定情况 / 材料价格 / 风险提示 / 签署页。

_VALUATION_CSS = """<style>
    :root {
      --bg: #eef3f4; --bg2: #ffffff; --ink: #14323c; --muted: #587079;
      --rule: #d7e2e5; --accent: #0e7490; --accent2: #c2600a;
      --font: 'Microsoft YaHei', 'PingFang SC', 'SimHei', sans-serif;
      --font-body: 'Songti SC', 'SimSun', 'NSimSun', serif;
      --font-mono: 'Consolas', monospace;
      --max: 980px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 16px; scroll-behavior: smooth; }
    body {
      font-family: var(--font-body);
      color: var(--ink); background: var(--bg); line-height: 1.9; padding: 2rem 1rem;
    }
    article.page { max-width: var(--max); margin: 0 auto; }

    /* 封面 */
    .cover {
      background: var(--bg2); border: 1px solid var(--rule);
      border-top: 8px solid var(--accent); padding: 4rem 3.5rem 3.5rem; text-align: center;
    }
    .cover .report-no { font-family: var(--font); font-size: 0.9rem; color: var(--muted); text-align: right; letter-spacing: 0.05em; }
    .cover .org-name { font-family: var(--font); font-weight: 700; font-size: 1.05rem; color: var(--accent); letter-spacing: 0.35em; margin-top: 2.5rem; }
    .cover .org-cert { font-size: 0.78rem; color: var(--muted); letter-spacing: 0.12em; margin-top: 0.4rem; }
    .cover h1 { font-family: var(--font); font-size: 1.8rem; font-weight: 700; letter-spacing: 0.08em; line-height: 1.6; margin: 3rem 0 1.2rem; }
    .cover .subtitle { font-family: var(--font); font-size: 1.28rem; color: var(--accent); letter-spacing: 0.5em; text-indent: 0.5em; font-weight: 700; }
    .cover .subtitle-thin { display: block; font-size: 0.96rem; letter-spacing: 0.18em; color: var(--muted); margin-top: 0.7rem; font-weight: 400; }
    .cover .cover-rule { width: 4.5rem; height: 3px; background: var(--accent); margin: 2.6rem auto; }
    .cover .cover-meta { width: 23rem; max-width: 100%; margin: 2.2rem auto 0; text-align: left; font-family: var(--font); font-size: 0.98rem; }
    .cover .cover-meta .row { display: flex; align-items: baseline; margin-bottom: 1.1rem; }
    .cover .cover-meta .label { white-space: nowrap; letter-spacing: 0.28em; color: var(--muted); }
    .cover .cover-meta .value { flex: 1; border-bottom: 1px solid var(--rule); margin-left: 0.9rem; padding-left: 0.5rem; text-align: center; font-weight: 600; }
    .cover .cover-date { font-family: var(--font); margin-top: 3rem; color: var(--muted); letter-spacing: 0.25em; font-size: 0.95rem; }

    /* 编制说明 / 目录 */
    .notes, .toc { background: var(--bg2); border: 1px solid var(--rule); padding: 3rem 3.2rem; margin-top: 1.6rem; }
    .notes h2, .toc h2 { text-align: center; font-family: var(--font); letter-spacing: 0.5em; text-indent: 0.5em; margin-bottom: 1.8rem; }
    .notes ol { padding-left: 1.6rem; }
    .notes li { margin-bottom: 0.9rem; text-align: justify; }
    .toc ol { list-style: none; }
    .toc li { display: flex; align-items: baseline; font-family: var(--font); margin-bottom: 0.75rem; font-size: 0.97rem; }
    .toc a { color: var(--ink); text-decoration: none; white-space: nowrap; }
    .toc .dots { flex: 1; border-bottom: 1px dotted var(--rule); margin: 0 0.6rem; transform: translateY(-4px); }

    /* 正文 */
    section.doc {
      background: var(--bg2); border: 1px solid var(--rule);
      border-top: 4px solid var(--accent); padding: 2.6rem 3.2rem; margin-top: 1.6rem;
    }
    h2.sec { font-family: var(--font); font-size: 1.32rem; font-weight: 700; border-left: 6px solid var(--accent); padding-left: 0.85rem; padding-bottom: 0.35rem; border-bottom: 1px solid var(--rule); margin-bottom: 1.8rem; letter-spacing: 0.06em; }
    h3.sub { font-family: var(--font); font-size: 1.05rem; font-weight: 700; color: var(--accent); margin: 2rem 0 0.9rem; }
    h3.sub .tag { display: inline-block; font-size: 0.78rem; font-weight: 400; color: var(--accent2); border: 1px solid var(--accent2); border-radius: 3px; padding: 0 0.45rem; margin-left: 0.6rem; vertical-align: 2px; letter-spacing: 0.05em; }
    p { margin-bottom: 1rem; text-align: justify; }
    p.note { font-size: 0.88rem; color: var(--muted); margin: -0.4rem 0 1.2rem; }
    strong.key { color: var(--accent); }
    strong.bad { color: var(--accent2); }
    .num { font-family: var(--font-mono); }

    /* 指标卡 */
    .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin: 1.6rem 0 2rem; }
    .stat-card { background: var(--bg2); border: 1px solid var(--rule); border-top: 3px solid var(--accent); padding: 1.1rem 1rem; text-align: center; }
    .stat-card.warn { border-top-color: var(--accent2); }
    .stat-card .label { font-family: var(--font); font-size: 0.85rem; color: var(--muted); letter-spacing: 0.1em; }
    .stat-card .value { font-family: var(--font); font-weight: 700; font-size: 1.4rem; color: var(--accent); margin-top: 0.35rem; font-variant-numeric: tabular-nums; }
    .stat-card.warn .value { color: var(--accent2); }
    .stat-card .unit { font-size: 0.82rem; font-weight: 400; color: var(--muted); margin-left: 0.15rem; }
    .stat-card .sub { font-size: 0.78rem; color: var(--muted); margin-top: 0.3rem; font-family: var(--font); }

    /* 表格 */
    .table-wrap { overflow-x: auto; overflow-y: auto; max-height: 600px; margin: 1.2rem 0 1.6rem; border: 1px solid var(--rule); }
    table { width: 100%; border-collapse: collapse; font-size: 0.92rem; min-width: 620px; }
    thead th { background: var(--accent); color: var(--bg2); font-family: var(--font); font-weight: 600; padding: 0.6rem 0.7rem; border: 1px solid var(--accent); letter-spacing: 0.04em; white-space: nowrap; }
    tbody td { border: 1px solid var(--rule); padding: 0.5rem 0.7rem; vertical-align: middle; }
    tbody tr:nth-child(even) { background: color-mix(in srgb, var(--accent) 3%, var(--bg2)); }
    td.num, th.num { text-align: right; font-family: var(--font-mono); white-space: nowrap; }
    td.ctr, th.ctr { text-align: center; }
    tbody tr.total td { font-family: var(--font); font-weight: 700; background: color-mix(in srgb, var(--accent) 8%, var(--bg2)); border-top: 2px solid var(--accent); }
    tbody tr.total td.num { font-family: var(--font-mono); }
    td.up { color: var(--accent2); font-weight: 600; }
    td.down { color: var(--accent); font-weight: 600; }
    .table-title { font-family: var(--font); font-weight: 700; font-size: 0.95rem; text-align: center; margin: 1.8rem 0 0.2rem; }

    /* 条形图（自包含，无需外部图表库） */
    .hbar { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.55rem; font-size: 0.88rem; }
    .hbar .hbar-label { width: 7.5rem; flex: none; font-family: var(--font); font-weight: 600; }
    .hbar .hbar-track { flex: 1; background: color-mix(in srgb, var(--accent) 8%, var(--bg2)); border-radius: 3px; overflow: hidden; }
    .hbar .hbar-fill { height: 16px; background: var(--accent); border-radius: 3px; }
    .hbar.warny .hbar-fill { background: var(--accent2); }
    .hbar .hbar-val { width: 5.5rem; flex: none; text-align: right; font-family: var(--font-mono); }
    .hbar.dual .hbar-track { display: flex; }
    .hbar.dual .hbar-fill-seg { height: 16px; }
    .hbar.dual .seg-a { background: var(--accent); }
    .hbar.dual .seg-b { background: var(--accent2); }

    .chart-legend { display: flex; gap: 1.4rem; justify-content: center; font-size: 0.82rem; color: var(--muted); margin: 0.2rem 0 1rem; }
    .chart-legend .sw { display: inline-block; width: 0.8rem; height: 0.8rem; border-radius: 2px; margin-right: 0.3rem; vertical-align: -1px; }
    .chart-legend .sw.a { background: var(--accent); }
    .chart-legend .sw.b { background: var(--accent2); }

    /* 结论框 */
    .callout { border-left: 4px solid var(--accent); background: color-mix(in srgb, var(--accent) 5%, var(--bg2)); padding: 1.1rem 1.4rem; margin: 1.4rem 0; }
    .callout.warn { border-left-color: var(--accent2); background: color-mix(in srgb, var(--accent2) 5%, var(--bg2)); }
    .callout .words { font-family: var(--font); font-weight: 700; color: var(--accent); font-size: 1.05rem; letter-spacing: 0.05em; }
    .callout.warn .words { color: var(--accent2); }

    /* 签署 */
    .sign-page { background: var(--bg2); border: 1px solid var(--rule); border-top: 4px solid var(--accent); padding: 3rem 3.2rem; margin-top: 1.6rem; }
    .sign-table { width: 100%; border-collapse: collapse; font-family: var(--font); font-size: 0.97rem; margin-top: 1rem; }
    .sign-table td { border: 1px solid var(--rule); padding: 1.35rem 1rem; width: 25%; }
    .sign-table .role { color: var(--muted); font-size: 0.85rem; display: block; margin-bottom: 0.3rem; }

    footer.colophon { margin-top: 1.6rem; text-align: center; font-family: var(--font); font-size: 0.82rem; color: var(--muted); line-height: 1.9; padding-bottom: 1rem; }
    footer.colophon .rule-line { width: 3rem; height: 2px; background: var(--accent); margin: 0.8rem auto; }

    @media (max-width: 768px) {
      body { padding: 1rem 0.6rem; }
      .cover, .notes, .toc, section.doc, .sign-page { padding: 2rem 1.3rem; }
      .cover h1 { font-size: 1.45rem; }
      .stat-grid { grid-template-columns: repeat(2, 1fr); }
      .stat-card .value { font-size: 1.2rem; }
      table { min-width: 640px; }
    }
    @page { size: A4; margin: 14mm 12mm; }
    @media print {
      body { background: var(--bg2); padding: 0; }
      .cover, .notes, .toc, .sign-page, section.doc { border: none; padding: 1.2rem 0.5rem; margin-top: 0; }
      .cover { page-break-after: always; padding-top: 6rem; }
      .notes, .toc { page-break-after: always; }
      .sign-page { page-break-before: always; }
      .table-wrap { max-height: none; overflow: visible; }
      tr, .chart-figure, .stat-card { page-break-inside: avoid; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>"""

_VALUATION_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
{css}
</head>
<body>
  <article class="page">

    <!-- ================= 封面 ================= -->
    <section class="cover" id="cover">
      <div class="report-no">{report_no}</div>
      <div class="org-name">{org_name}</div>
      <div class="org-cert">{org_cert}</div>
      <h1>{project_name}</h1>
      <div class="subtitle">成果造价报表<span class="subtitle-thin">（{standard_label} · {generated} 编报）</span></div>
      <div class="cover-rule"></div>
      <div class="cover-meta">
        <div class="row"><span class="label">建设单位</span><span class="value">{owner}</span></div>
        <div class="row"><span class="label">编报单位</span><span class="value">{org_name}</span></div>
        <div class="row"><span class="label">计价标准</span><span class="value">{standard_type}</span></div>
        <div class="row"><span class="label">编报日期</span><span class="value">{generated}</span></div>
      </div>
      <div class="cover-date">{created_zh}</div>
    </section>

    <!-- ================= 编制说明 ================= -->
    <section class="notes" id="notes">
      <h2>编 制 说 明</h2>
      <ol>
        <li>本报表系为“{project_name}”项目编制并经系统计价计算后生成的<strong class="key">成果造价报表</strong>，反映项目工程量清单、定额绑定与综合单价计算结果。</li>
        <li>本报表依据项目工程量清单、定额子目、材料价格及规则包费率编制，计量计价原则与项目计价标准保持一致。</li>
        <li>报表数据随项目清单、绑定与价格信息的变更<strong class="key">实时同步更新</strong>，导出即反映导出时刻项目最新计价状态。</li>
        <li>本报表仅供项目造价管理使用，不作为工程结算与支付的直接依据；正式结算以竣工结算审计报告为准。</li>
      </ol>
    </section>

    <!-- ================= 目录 ================= -->
    <nav class="toc" id="toc">
      <h2>目　　录</h2>
      <ol>
        <li><a href="#s1">一、项目概况</a><span class="dots"></span></li>
        <li><a href="#s2">二、投资完成总览</a><span class="dots"></span></li>
        <li><a href="#s3">三、造价构成分析</a><span class="dots"></span></li>
        <li><a href="#s4">四、分部工程造价执行情况</a><span class="dots"></span></li>
        <li><a href="#s5">五、清单计价明细</a><span class="dots"></span></li>
        <li><a href="#s6">六、计价与定额绑定情况</a><span class="dots"></span></li>
        <li><a href="#s7">七、主要材料价格信息</a><span class="dots"></span></li>
        <li><a href="#s8">八、风险提示与下期工作安排</a><span class="dots"></span></li>
      </ol>
    </nav>

    <!-- ================= 一、项目概况 ================= -->
    <section class="doc" id="s1">
      <h2 class="sec">一、项目概况</h2>
      <p>{overview_para}</p>
      <div class="table-title">表1-1　项目概况表</div>
      <div class="table-wrap">
        <table>
          <tbody>
{overview_rows}
          </tbody>
        </table>
      </div>
    </section>

    <!-- ================= 二、投资完成总览 ================= -->
    <section class="doc" id="s2">
      <h2 class="sec">二、投资完成总览</h2>
      <p>{invest_para}</p>
      <div class="stat-grid">
{stat_cards}
      </div>
      <div class="table-title">表2-1　项目投资执行总表</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="ctr" style="width:8%">序号</th>
              <th>指标名称</th>
              <th class="num">金额(万元)</th>
              <th class="ctr">占概算</th>
              <th class="ctr">说明</th>
            </tr>
          </thead>
          <tbody>
{invest_rows}
          </tbody>
        </table>
      </div>
      <p class="note">{invest_note}</p>
      <div class="chart-legend"><span><span class="sw a"></span>概算/预算</span><span><span class="sw b"></span>造价合计</span></div>
      <div class="hbar dual"><span class="hbar-label">批复概算</span><div class="hbar-track"><div class="hbar-fill-seg seg-a" style="width:{card_a_pct}%"></div></div><span class="hbar-val">{budget_wan}</span></div>
      <div class="hbar dual"><span class="hbar-label">造价合计</span><div class="hbar-track"><div class="hbar-fill-seg seg-b" style="width:{grand_pct}%"></div></div><span class="hbar-val">{grand_wan}</span></div>
      <p class="note">图2-1　概算/预算与造价合计对比（单位：万元，条形长度按二者较大值归一）</p>
    </section>

    <!-- ================= 三、造价构成分析 ================= -->
    <section class="doc" id="s3">
      <h2 class="sec">三、造价构成分析</h2>
      <p>{comp_para}</p>
      <div class="table-title">表3-1　造价费用性质构成表</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="ctr" style="width:8%">序号</th>
              <th>费用性质</th>
              <th class="num">金额(万元)</th>
              <th class="ctr">占比</th>
              <th class="ctr">说明</th>
            </tr>
          </thead>
          <tbody>
{comp_rows}
          </tbody>
        </table>
      </div>
      <p class="note">注：占比为各费用性质金额占造价合计的比例；直接费=人工费+材料费+机械费。</p>
      <div class="table-title">图3-1　造价费用性质构成比例</div>
{hbars}
    </section>

    <!-- ================= 四、分部工程造价执行 ================= -->
    <section class="doc" id="s4">
      <h2 class="sec">四、分部工程造价执行情况</h2>
      <p>{division_para}</p>
      <div class="table-title">表4-1　分部工程造价执行表</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="ctr" style="width:8%">序号</th>
              <th>分部工程</th>
              <th class="num">清单项数</th>
              <th class="num">已绑定</th>
              <th class="num">金额(万元)</th>
              <th class="ctr">占比</th>
            </tr>
          </thead>
          <tbody>
{division_rows}
          </tbody>
        </table>
      </div>
      <p class="note">{division_note}</p>
      <div class="table-title">图4-1　各分部工程造价占比</div>
{division_hbars}
    </section>

    <!-- ================= 五、清单计价明细 ================= -->
    <section class="doc" id="s5">
      <h2 class="sec">五、清单计价明细</h2>
      <p>{items_para}</p>
      <div class="table-title">表5-1　分部分项工程量清单计价表</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="ctr" style="width:6%">序号</th>
              <th style="width:14%">项目编码</th>
              <th>项目名称</th>
              <th style="width:11%">分部</th>
              <th class="ctr" style="width:7%">单位</th>
              <th class="num">工程量</th>
              <th class="num">综合单价(元)</th>
              <th class="num">合价(元)</th>
              <th class="ctr" style="width:9%">绑定</th>
            </tr>
          </thead>
          <tbody>
{item_rows}
          </tbody>
        </table>
      </div>
      <p class="note">{items_note}</p>
    </section>

    <!-- ================= 六、计价与定额绑定 ================= -->
    <section class="doc" id="s6">
      <h2 class="sec">六、计价与定额绑定情况</h2>
      <p>{binding_para}</p>
      <div class="stat-grid">
{binding_cards}
      </div>
      <div class="table-title">表6-1　未绑定定额清单项（{unbound_shown} 项）</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="ctr" style="width:6%">序号</th>
              <th style="width:14%">项目编码</th>
              <th>项目名称</th>
              <th style="width:11%">分部</th>
              <th class="ctr" style="width:8%">单位</th>
              <th class="num">工程量</th>
            </tr>
          </thead>
          <tbody>
{unbound_rows}
          </tbody>
        </table>
      </div>
      <p class="note">{unbound_note}</p>
    </section>

    <!-- ================= 七、主要材料价格信息 ================= -->
    <section class="doc" id="s7">
      <h2 class="sec">七、主要材料价格信息</h2>
      <p>{material_para}</p>
      <div class="table-title">表7-1　主要材料价格信息表</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="ctr" style="width:8%">序号</th>
              <th>材料名称</th>
              <th>规格型号</th>
              <th class="ctr" style="width:9%">单位</th>
              <th class="num">单价(元)</th>
              <th>区域</th>
              <th class="ctr" style="width:14%">生效日期</th>
            </tr>
          </thead>
          <tbody>
{material_rows}
          </tbody>
        </table>
      </div>
      <p class="note">{material_note}</p>
    </section>

    <!-- ================= 八、风险提示与下期安排 ================= -->
    <section class="doc" id="s8">
      <h2 class="sec">八、风险提示与下期工作安排</h2>
      <h3 class="sub">8.1 造价风险提示<span class="tag">{risk_count} 项</span></h3>
{risk_items}
      <h3 class="sub">8.2 下期造价工作安排</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th class="ctr" style="width:8%">序号</th><th style="width:30%">工作事项</th><th>工作说明</th></tr>
          </thead>
          <tbody>
{plan_rows}
          </tbody>
        </table>
      </div>
      <div class="callout{callout_cls}">
        <p style="margin-bottom:0"><strong class="words">{conclusion_head}</strong>{conclusion_body}</p>
      </div>
    </section>

    <!-- ================= 签署页 ================= -->
    <section class="sign-page">
      <h2 class="sec">报表签署</h2>
      <table class="sign-table">
        <tbody>
          <tr>
            <td><span class="role">编制人(造价工程师)</span>　　　　　　　</td>
            <td><span class="role">复核人(造价工程师)</span>　　　　　　　</td>
            <td><span class="role">项目部经理</span>　　　　　　　</td>
            <td><span class="role">建设单位确认</span>　　　　　　　</td>
          </tr>
        </tbody>
      </table>
      <div style="margin-top:2.6rem;font-family:var(--font);display:flex;justify-content:space-between;flex-wrap:wrap;gap:1.5rem;">
        <p style="margin:0;">{org_name} · {project_name}项目部(章)</p>
        <p style="margin:0;">编报日期：{generated}</p>
      </div>
    </section>

    <footer class="colophon">
      <div class="rule-line"></div>
      <p>{org_name} · {project_name}项目成果造价报表</p>
      <p>本报表数据与项目实时同步 · 仅供项目造价管理使用，不作为结算支付直接依据</p>
    </footer>
  </article>
</body>
</html>
"""


def _html_escape(value) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _fmt_wan(value: float) -> str:
    """金额以万元展示；near-zero 显示为 -。"""
    if value is None or abs(value or 0) < 0.005:
        return "-"
    return f"{value / 10000:,.2f}"


def _fmt_yuan(value: float) -> str:
    if value is None:
        return "-"
    return f"{value:,.2f}"


def _get_org_setting(db: Session, key: str, default: str) -> str:
    """按 key 读取系统设置表中的机构信息，读不到时返回默认值。"""
    from app.models.system_setting import SystemSetting

    try:
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if row and row.value:
            return row.value
    except Exception:
        pass
    return default


def _collect_valuation_data(project_id: int, db: Session) -> dict:
    """汇总成果造价报表所需数据（全部来自项目数据库，实时同步）。"""
    from sqlalchemy import or_

    from app.models.calc_result import CalcResult
    from app.models.line_item_quota_binding import LineItemQuotaBinding
    from app.models.material_price import MaterialPrice
    from app.models.measure_item import MeasureItem
    from app.services.export_service import division_rank

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError(f"Project {project_id} not found")

    org_name = _get_org_setting(db, "org_name", "筑衡工程造价咨询有限公司")
    org_cert = _get_org_setting(db, "org_cert", "工程造价咨询甲级资质 · 证书编号:甲 31002026")

    boq_items = (
        db.query(BoqItem)
        .filter(BoqItem.project_id == project_id)
        .order_by(BoqItem.sort_order)
        .all()
    )
    total_items = len(boq_items)

    calc_map: dict[int, CalcResult] = {}
    if boq_items:
        for c in (
            db.query(CalcResult)
            .filter(CalcResult.boq_item_id.in_([b.id for b in boq_items]))
            .all()
        ):
            calc_map[c.boq_item_id] = c

    total_labor = sum(c.labor_cost for c in calc_map.values())
    total_material = sum(c.material_cost for c in calc_map.values())
    total_machine = sum(c.machine_cost for c in calc_map.values())
    total_direct = sum(c.direct_cost for c in calc_map.values())
    total_mgmt = sum(c.management_fee for c in calc_map.values())
    total_profit = sum(c.profit for c in calc_map.values())
    total_regulatory = sum(c.regulatory_fee for c in calc_map.values())
    total_pre_tax = sum(c.pre_tax_total for c in calc_map.values())
    total_tax = sum(c.tax for c in calc_map.values())
    line_grand = sum(c.total_cost for c in calc_map.values())

    measures = (
        db.query(MeasureItem).filter(MeasureItem.project_id == project_id).all()
    )
    total_measures = 0.0
    for m in measures:
        if m.is_fixed:
            total_measures += m.amount or 0
        else:
            base = total_direct if m.calc_base == "direct" else total_pre_tax
            total_measures += (base or 0) * (m.rate or 0)
    grand_total = line_grand + total_measures

    binding_counts: dict[int, int] = {}
    if boq_items:
        for rb in (
            db.query(LineItemQuotaBinding)
            .filter(LineItemQuotaBinding.boq_item_id.in_([b.id for b in boq_items]))
            .all()
        ):
            binding_counts[rb.boq_item_id] = binding_counts.get(rb.boq_item_id, 0) + 1
    bound_count = sum(1 for b in boq_items if binding_counts.get(b.id, 0) > 0)
    unbound_count = total_items - bound_count
    calculated_count = len(calc_map)

    div_map: dict[str, dict] = {}
    for b in boq_items:
        d = b.division or "未分类"
        entry = div_map.setdefault(d, {"count": 0, "bound": 0, "total": 0.0})
        entry["count"] += 1
        if binding_counts.get(b.id, 0) > 0:
            entry["bound"] += 1
        entry["total"] += calc_map[b.id].total_cost if b.id in calc_map else 0.0
    divisions = [
        {
            "name": d,
            "count": v["count"],
            "bound": v["bound"],
            "total": v["total"],
            "pct": (v["total"] / grand_total * 100) if grand_total else 0.0,
        }
        for d, v in div_map.items()
    ]
    divisions.sort(key=lambda x: (division_rank(x["name"]), -x["total"]))

    material_rows: list[MaterialPrice] = []
    try:
        region = project.region or ""
        raw = (
            db.query(MaterialPrice)
            .filter(
                or_(
                    MaterialPrice.region == region,
                    MaterialPrice.region == "",
                )
            )
            .order_by(MaterialPrice.name.asc(), MaterialPrice.effective_date.desc())
            .all()
        )
        seen: dict[str, MaterialPrice] = {}
        for r in raw:
            key = f"{r.name}|{r.spec}|{r.unit}"
            if key not in seen:
                seen[key] = r
        material_rows = sorted(seen.values(), key=lambda r: (r.name or "", r.spec or ""))
    except Exception:
        material_rows = []

    budget = float(project.budget) if (project.budget or 0) else 0.0
    surplus = (budget - grand_total) if budget else None

    area = None
    for b in boq_items:
        if "建筑面积" in (b.name or "") or "总建筑面积" in (b.name or ""):
            area = b.quantity
            break

    now = datetime.now(timezone.utc)
    generated = now.strftime("%Y-%m-%d")
    created_zh = now.strftime("%Y年%m月%d日")
    status_label = {
        "draft": "草稿",
        "ongoing": "进行中",
        "completed": "已完成",
        "archived": "已归档",
    }.get(project.status or "draft", project.status or "-")
    standard_label = {
        "GB50500": "《建设工程工程量清单计价规范》(GB 50500-2013/2024)",
        "HKSMM4": "香港标准量度方法第4版 (HKSMM4)",
    }.get(project.standard_type, project.standard_type or "-")

    return {
        "project": project,
        "boq_items": boq_items,
        "calc_map": calc_map,
        "binding_counts": binding_counts,
        "status_label": status_label,
        "standard_label": standard_label,
        "generated": generated,
        "created_zh": created_zh,
        "org_name": org_name,
        "org_cert": org_cert,
        "total_items": total_items,
        "bound_count": bound_count,
        "unbound_count": unbound_count,
        "calculated_count": calculated_count,
        "total_labor": total_labor,
        "total_material": total_material,
        "total_machine": total_machine,
        "total_direct": total_direct,
        "total_management": total_mgmt,
        "total_profit": total_profit,
        "total_regulatory": total_regulatory,
        "total_pre_tax": total_pre_tax,
        "total_tax": total_tax,
        "total_measures": total_measures,
        "line_grand": line_grand,
        "grand_total": grand_total,
        "budget": budget,
        "surplus": surplus,
        "area": area,
        "divisions": divisions,
        "material_rows": material_rows,
    }


def export_valuation_report_html(project_id: int, db: Session) -> bytes:
    """按 cost-project-report.html 版式生成成果造价报表 HTML（单文件自包含）。"""
    data = _collect_valuation_data(project_id, db)
    project = data["project"]
    project_name = project.name or "未命名项目"
    owner = project.owner or "（未设置）"
    e = _html_escape

    total_items = data["total_items"]
    grand_total = data["grand_total"]
    budget = data["budget"]
    surplus = data["surplus"]

    report_prefix = (data["org_name"][:2] if len(data["org_name"]) >= 2 else data["org_name"])
    year = data["generated"][:4]
    report_no = f"{report_prefix}项报字〔{year}〕第 {project_id:03d} 号"

    # ── 一、项目概况 ──
    status_label = data["status_label"]
    area_txt = f"{data['area']:,.2f}" if data["area"] is not None else "—"
    budget_txt = f"{budget:,.2f}" if budget else "—"
    total_qty = sum(b.quantity for b in data["boq_items"])
    overview_para = (
        f"本工程为{e(project.region or '')}的{e(project.project_type or '')}项目，采用{data['standard_label']}计价。"
        f"项目当前状态{status_label}，共纳入工程量清单{e(total_items)} 项。"
        "本报表依据项目清单、定额绑定、材料价格与规则包费率经系统计价计算生成。"
    )
    overview_pairs = [
        ("项目名称", project_name, "建设地点", project.region or "—"),
        ("建设单位", owner, "工程类型", project.project_type or "—"),
        ("计价标准", project.standard_type, "项目状态", status_label),
        ("工程量清单", f"{total_items} 项", "总工程量", f"{total_qty:,.4f}"),
        ("开工日期", str(project.start_date or "—"), "竣工日期", str(project.end_date or "—")),
        ("建筑面积", f"{area_txt} ㎡", "项目预算", f"{budget_txt} 元"),
    ]
    overview_rows = "".join(
        f"          <tr><td style=\"width:20%\"><strong class=\"key\">{e(a)}</strong></td><td>{e(b)}</td>"
        f"<td style=\"width:18%\"><strong class=\"key\">{e(c)}</strong></td><td>{e(d)}</td></tr>"
        for a, b, c, d in overview_pairs
    )

    # ── 二、投资完成总览 ──
    has_budget = budget > 0
    if has_budget:
        budget_desc = f"为 {budget:,.2f} 元"
        surplus_label = "超支" if surplus < 0 else "结余"
        surplus_part = f" 概算预计{surplus_label}{abs(surplus) / 10000:,.2f} 万元。"
    else:
        budget_desc = "未设置，以造价合计作为显示基准"
        surplus_part = ""
    invest_para = (
        f"截至{e(data['generated'])}，项目预算（概算口径）{budget_desc}，"
        f"造价合计<strong class=\"key\">{data['grand_total']:,.2f}</strong> 元（{_fmt_wan(grand_total)} 万元）。"
        f"其中清单计价 {total_items} 项、已完成计价 {data['calculated_count']} 项、定额绑定 {data['bound_count']} 项。"
        f"{surplus_part}"
    )
    grand_wan = _fmt_wan(grand_total)
    budget_wan = _fmt_wan(budget)
    comp_scale = max(budget, grand_total) or 1
    card_a_pct = (budget / comp_scale * 100) if budget else 0
    card_b_pct = (grand_total / comp_scale * 100) if grand_total else 0
    bind_rate = (data["bound_count"] / total_items * 100) if total_items else 0.0
    stat_cards = "".join(
        f"""        <div class="stat-card{cls}">
          <div class="label">{e(label)}</div>
          <div class="value">{e(value)}<span class="unit">{e(unit)}</span></div>
          <div class="sub">{e(sub)}</div>
        </div>"""
        for label, value, unit, sub, cls in [
            ("项目预算/概算", budget_wan if has_budget else "未设置", "万元", f"{budget_txt} 元" if has_budget else "未设置概算口径", ""),
            ("造价合计", grand_wan, "万元", "含税工程造价", ""),
            ("清单项数", f"{total_items}", "项", f"已计价 {data['calculated_count']} 项", ""),
            ("定额绑定率", f"{bind_rate:.1f}", "%", f"未绑定 {data['unbound_count']} 项", "warn" if data["unbound_count"] else ""),
        ]
    )
    invest_rows_parts = [
        ("1", "项目预算/概算", budget_wan, "100.00%" if has_budget else "—", "项目初始化设置" if has_budget else "未设置概算口径", False),
        ("2", "分部分项工程费", _fmt_wan(data["line_grand"]), f"{data['line_grand'] / budget * 100:.2f}%" if has_budget else "—", "清单定额计价合计", False),
        ("3", "其中：措施项目费", _fmt_wan(data["total_measures"]), f"{data['total_measures'] / budget * 100:.2f}%" if has_budget else "—", "措施项目计算口径", False),
        ("4", "规费", _fmt_wan(data["total_regulatory"]), f"{data['total_regulatory'] / budget * 100:.2f}%" if has_budget else "—", "规费费率计提", False),
        ("5", "税金", _fmt_wan(data["total_tax"]), f"{data['total_tax'] / budget * 100:.2f}%" if has_budget else "—", "增值税率计提", False),
        ("6", "造价合计", grand_wan, f"{grand_total / budget * 100:.2f}%" if has_budget else "100.00%", "含税工程造价", True),
    ]
    sur_cls = ""
    if has_budget:
        sur_cls = " up" if surplus < 0 else " down"
        invest_rows_parts.append(
            (
                "7",
                "概算预计" + ("超支" if surplus < 0 else "结余"),
                _fmt_wan(abs(surplus)),
                f"{abs(surplus) / budget * 100:.2f}%",
                "预算-造价合计",
                False,
            )
        )
    invest_rows = "".join(
        f"            <tr{' class=\"total\"' if total else ''}><td class=\"ctr\">{e(idx)}</td><td>{e(name)}</td>"
        f"<td class=\"num{' ' + sur_cls if (total and has_budget and surplus < 0) else ''}\">{e(val)}</td>"
        f"<td class=\"ctr num\">{e(pct)}</td><td class=\"ctr\">{e(desc)}</td></tr>"
        for idx, name, val, pct, desc, total in invest_rows_parts
    )
    invest_note = (
        "注：分部分项工程费=人材机+管理费+利润+规费+税金（清单计价口径）；造价合计=分部分项工程费+措施项目费；"
        "「概算预计结余/超支」=项目预算−造价合计。"
    )

    # ── 三、造价构成分析 ──
    comp_para = (
        f"按费用性质对造价合计{data['grand_total']:,.2f} 元进行结构分解：材料费占比最高"
        f"（{data['total_material'] / grand_total * 100:.2f}%），其次为人工费"
        f"（{data['total_labor'] / grand_total * 100:.2f}%）与税金"
        f"（{data['total_tax'] / grand_total * 100:.2f}%）。"
        if grand_total
        else "项目暂无计算结果，无法进行造价构成分析。"
    )
    comp_items = [
        ("人工费", data["total_labor"], "清单定额人工费合计"),
        ("材料费", data["total_material"], "清单定额材料费合计"),
        ("机械费", data["total_machine"], "清单定额机械费合计"),
        ("直接费", data["total_direct"], "人+材+机"),
        ("管理费", data["total_management"], "企业管理费"),
        ("利润", data["total_profit"], "利润"),
        ("规费", data["total_regulatory"], "社会保险费等"),
        ("税金", data["total_tax"], "增值税"),
        ("造价合计", data["grand_total"], "含税工程造价"),
    ]
    comp_rows = "".join(
        f"""            <tr{(' class="total"' if i == len(comp_items) - 1 else '')}><td class="ctr">{'—' if i == len(comp_items) - 1 else i + 1}</td>"""
        f"""<td>{e(name)}</td><td class="num">{_fmt_wan(val)}</td><td class="ctr num">"""
        f"""{val / grand_total * 100:.2f}%</td><td class="ctr">{e(desc)}</td></tr>"""
        for i, (name, val, desc) in enumerate(comp_items)
    )
    hbars = ""
    for name, val, desc in comp_items:
        pct = (val / grand_total * 100) if grand_total else 0.0
        hbars += (
            f"      <div class=\"hbar\">"
            f"<span class=\"hbar-label\">{e(name)}</span>"
            f"<div class=\"hbar-track\"><div class=\"hbar-fill\" style=\"width:{min(pct, 100):.2f}%\"></div></div>"
            f"<span class=\"hbar-val\">{pct:.2f}% · {_fmt_wan(val)}万</span></div>\n"
        )

    # ── 四、分部造价执行 ──
    division_para = (
        f"项目共划分 {len(data['divisions'])} 个分部，分部造价合计 {data['grand_total']:,.2f} 元。"
        "各分部按施工顺序与金额降序排列，执行情况见表4-1。"
    )
    division_rows = "".join(
        f"            <tr><td class=\"ctr\">{i}</td><td>{e(d['name'])}</td><td class=\"num\">{d['count']}</td>"
        f"<td class=\"num\">{d['bound']}</td><td class=\"num\">{_fmt_wan(d['total'])}</td>"
        f"<td class=\"ctr num\">{d['pct']:.2f}%</td></tr>"
        for i, d in enumerate(data["divisions"], 1)
    )
    if not data["divisions"]:
        division_rows = "            <tr><td class=\"ctr\">—</td><td colspan=\"5\">项目暂无清单分部数据</td></tr>"
    division_note = "注：占比为各分部金额占造价合计的比例；金额单位为万元。"
    division_hbars = ""
    for d in data["divisions"]:
        division_hbars += (
            f"      <div class=\"hbar\"><span class=\"hbar-label\">{e(d['name'])}</span>"
            f"<div class=\"hbar-track\"><div class=\"hbar-fill\" style=\"width:{min(d['pct'], 100):.2f}%\"></div></div>"
            f"<span class=\"hbar-val\">{d['pct']:.2f}% · {_fmt_wan(d['total'])}万</span></div>\n"
        )
    if not data["divisions"]:
        division_hbars = "      <p>暂无分部数据。</p>\n"

    # ── 五、清单计价明细 ──
    items_para = (
        f"清单计价明细共 {total_items} 项，按分部与清单序号排列，逐项列示综合单价与合价。"
        f"其中已计价 {data['calculated_count']} 项、未计价 {total_items - data['calculated_count']} 项。"
    )
    shown_items = data["boq_items"][:150]
    item_rows_parts = []
    for i, b in enumerate(shown_items, 1):
        c = data["calc_map"].get(b.id)
        unit_price = _fmt_yuan(c.total_cost / b.quantity if c and b.quantity else None)
        total_price = _fmt_yuan(c.total_cost if c else None)
        if data["binding_counts"].get(b.id, 0) > 0:
            bound_txt = "已绑定"
        else:
            bound_txt = '<strong class="bad">未绑定</strong>'
        item_rows_parts.append(
            f"            <tr>\n"
            f"              <td class=\"ctr\">{i}</td>\n"
            f"              <td>{e(b.code)}</td>\n"
            f"              <td>{e(b.name)}</td>\n"
            f"              <td>{e(b.division or '未分类')}</td>\n"
            f"              <td class=\"ctr\">{e(b.unit)}</td>\n"
            f"              <td class=\"num\">{b.quantity:,.2f}</td>\n"
            f"              <td class=\"num\">{unit_price}</td>\n"
            f"              <td class=\"num\">{total_price}</td>\n"
            f"              <td class=\"ctr\">{bound_txt}</td>\n"
            f"            </tr>"
        )
    item_rows = "\n".join(item_rows_parts)
    if not shown_items:
        item_rows = "            <tr><td class=\"ctr\">—</td><td colspan=\"8\">项目暂无清单数据</td></tr>"
    if len(shown_items) < total_items:
        shown_tip = "如需完整清单可参考系统清单明细页"
    else:
        shown_tip = "已全量展示"
    items_note = (
        f"注：共 {total_items} 项，明细表仅展示前 {len(shown_items)} 项（{shown_tip}）；综合单价=合价÷工程量。"
    )

    # ── 六、计价与定额绑定情况 ──
    no_calc_count = total_items - data["calculated_count"]
    binding_para = (
        f"定额绑定与计价完成情况：已绑定 {data['bound_count']}/{total_items} 项（{bind_rate:.2f}%），"
        f"已完成计价 {data['calculated_count']}/{total_items} 项。"
        "未绑定或未计价的清单项将无法生成完整造价，影响成果完整度。"
    )
    binding_cards = "".join(
        f"""        <div class="stat-card{cls}">
          <div class="label">{e(label)}</div>
          <div class="value">{e(value)}<span class="unit">{e(unit)}</span></div>
          <div class="sub">{e(sub)}</div>
        </div>"""
        for label, value, unit, sub, cls in [
            ("已绑定", f"{data['bound_count']}", "项", f"绑定率 {bind_rate:.2f}%", ""),
            ("未绑定", f"{data['unbound_count']}", "项", "未关联定额子目", "warn" if data["unbound_count"] else ""),
            ("已计价", f"{data['calculated_count']}", "项", "已生成综合单价", ""),
            ("未计价", f"{no_calc_count}", "项", "缺少计算结果", "warn" if no_calc_count else ""),
        ]
    )
    unbound_list = [b for b in data["boq_items"] if data["binding_counts"].get(b.id, 0) == 0][:20]
    unbound_rows = "".join(
        f"""            <tr>
              <td class="ctr">{i}</td>
              <td>{e(b.code)}</td>
              <td>{e(b.name)}</td>
              <td>{e(b.division or '未分类')}</td>
              <td class="ctr">{e(b.unit)}</td>
              <td class="num">{b.quantity:,.2f}</td>
            </tr>"""
        for i, b in enumerate(unbound_list, 1)
    )
    if not unbound_list:
        unbound_rows = "            <tr><td class=\"ctr\">—</td><td colspan=\"5\">项目清单已全部绑定定额,无未绑定项</td></tr>"
    unbound_note = (
        f"注：共 {data['unbound_count']} 项未绑定定额，表6-1 仅展示前 {len(unbound_list)} 项。"
        "请为未绑定清单项关联定额子目并重新执行计价。"
    )

    # ── 七、材料价格 ──
    if data["material_rows"]:
        material_para = (
            f"按项目区域（{e(project.region or '默认')}）匹配的材料价格共 {len(data['material_rows'])} 类，"
            "以下为各材料最新生效价格，供综合单价计算与调差参考。"
        )
        material_rows_html = "".join(
            f"""            <tr>
              <td class="ctr">{i}</td>
              <td>{e(r.name)}</td>
              <td>{e(r.spec or '—')}</td>
              <td class="ctr">{e(r.unit)}</td>
              <td class="num">{r.unit_price:,.2f}</td>
              <td>{e(r.region or '默认')}</td>
              <td class="ctr">{e(r.effective_date or '—')}</td>
            </tr>"""
            for i, r in enumerate(data["material_rows"], 1)
        )
        material_note = "注：价格为系统中该区域/默认区域当前生效的最新单价，单位以表中为准。"
    else:
        material_para = "项目当前没有匹配的材料价格数据。"
        material_rows_html = (
            "            <tr><td class=\"ctr\">—</td><td colspan=\"6\">暂无材料价格数据，请先在「材料价格」模块维护后重新导出</td></tr>"
        )
        material_note = "注：综合单价计算会按材料价格模块的数据取价，建议维护项目区域对应的材料价格。"

    # ── 八、风险提示 ──
    risks = []
    if data["unbound_count"] > 0:
        risks.append(
            f"清单项未绑定定额风险。<strong class=\"bad\">{data['unbound_count']}</strong> 个清单项未关联定额子目,"
            "将无法完整参与计价计算并计入造价合计,建议尽快完成定额绑定。"
        )
    if no_calc_count > 0:
        risks.append(
            f"清单项缺少计算结果风险。<strong class=\"bad\">{no_calc_count}</strong> 个清单项尚无计算成果"
            "（可能因未绑定或绑定定额缺少人材机构成),建议重新执行计价计算。"
        )
    if has_budget and surplus < 0:
        risks.append(
            f"概算超支风险。当前造价合计已超出项目预算"
            f"<strong class=\"bad\">{abs(surplus) / 10000:,.2f}</strong> 万元（超支率 "
            f"{abs(surplus) / budget * 100:.2f}%）,建议复核偏差分部并严格控制后续成本。"
        )
    if not risks:
        if total_items == 0:
            risks.append("项目无清单数据。请先导入或录入工程量清单,再执行定额绑定与计价计算。")
        else:
            risks.append("当前项目清单已全部绑定并完成计价,造价结果完整,暂无重大风险。")
    risk_items = "".join(
        f"      <p><strong class=\"key\">{i}. {e(risk.split('。')[0])}。</strong>{e(risk.split('。', 1)[1])}</p>\n"
        for i, risk in enumerate(risks, 1)
    )
    risk_count = len(risks)

    plans = []
    if data["unbound_count"] > 0:
        plans.append(("完成未绑定清单项定额关联", f"完成 {data['unbound_count']} 个清单项定额子目绑定"))
    if no_calc_count > 0:
        plans.append(("复核未计价清单项", f"对 {no_calc_count} 个无计算成果清单项重新计价"))
    if has_budget and surplus < 0:
        plans.append(("超支部分部偏差专项复核", "对造价超概算的分部进行专项分析并出具控制建议"))
    if len(plans) < 4:
        plans.append(("核对主要材料价格信息", "核对材料价格与当期信息价一致性，更新价格数据"))
    if len(plans) < 4:
        plans.append(("成果文件三级复核", "对报表成果执行编制人自审、复核人复审、审定人终审"))
    if len(plans) < 4:
        plans.append(("按合同约定办理价款结算", "依据合同约定及时办理工程价款计量与支付审核"))
    plan_rows = "".join(
        f"""            <tr><td class="ctr">{i}</td><td>{e(name)}</td><td>{e(desc)}</td></tr>"""
        for i, (name, desc) in enumerate(plans[:4], 1)
    )

    if has_budget:
        if surplus >= 0:
            conclusion_head = "总体评价："
            conclusion_body = (
                f"截至本报告期，项目造价合计 {data['grand_total']:,.2f} 元，控制在项目预算以内，"
                f"预计结余 {surplus / 10000:,.2f} 万元，投资控制总体情况良好。"
            )
            callout_cls = ""
        else:
            conclusion_head = "总体评价："
            conclusion_body = (
                f"截至本报告期，项目造价合计 {data['grand_total']:,.2f} 元，已超出项目预算"
                f"{abs(surplus) / 10000:,.2f} 万元，存在超支风险，请重点关注并采取措施。"
            )
            callout_cls = " warn"
    else:
        conclusion_head = "总体评价："
        conclusion_body = (
            f"截至本报告期，项目造价合计 {data['grand_total']:,.2f} 元（未设置预算，无法判断结余），"
            "建议为项目设置概算/预算口径以开展投资对标。"
        )
        callout_cls = ""

    html = _VALUATION_TEMPLATE.format(
        css=_VALUATION_CSS,
        title=f"{e(project_name)}成果造价报表({year})",
        report_no=e(report_no),
        org_name=e(data["org_name"]),
        org_cert=e(data["org_cert"]),
        project_name=e(project_name),
        standard_label=e(data["standard_label"]),
        standard_type=e(project.standard_type or "—"),
        generated=e(data["generated"]),
        created_zh=e(data["created_zh"]),
        owner=e(owner),
        overview_para=overview_para,
        overview_rows=overview_rows,
        invest_para=invest_para,
        stat_cards=stat_cards,
        invest_rows=invest_rows,
        invest_note=invest_note,
        card_a_pct=f"{card_a_pct:.2f}",
        grand_pct=f"{card_b_pct:.2f}",
        budget_wan=e(budget_wan),
        grand_wan=e(grand_wan),
        comp_para=comp_para,
        comp_rows=comp_rows,
        hbars=hbars,
        division_para=division_para,
        division_rows=division_rows,
        division_note=division_note,
        division_hbars=division_hbars,
        items_para=items_para,
        item_rows=item_rows,
        items_note=items_note,
        binding_para=binding_para,
        binding_cards=binding_cards,
        unbound_shown=len(unbound_list),
        unbound_rows=unbound_rows,
        unbound_note=unbound_note,
        material_para=material_para,
        material_rows=material_rows_html,
        material_note=material_note,
        risk_count=risk_count,
        risk_items=risk_items,
        plan_rows=plan_rows,
        callout_cls=callout_cls,
        conclusion_head=conclusion_head,
        conclusion_body=conclusion_body,
    )
    return html.encode("utf-8")
