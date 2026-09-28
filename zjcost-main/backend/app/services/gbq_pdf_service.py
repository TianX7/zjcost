"""GBQ-style tender package PDF export (folder2 layout).

与 gbq_export_service 的 Excel 清单包同构：封封面 → 填报说明 → 汇总表（4.5）
→ 各专业分册（4.6 分部分项清单计价表 + 4.7A 综合单价分析表）。
"""

from __future__ import annotations

import io
import os
import platform
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
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

from app.models.project import Project
from app.services.export_service import division_rank
from app.services.project_calc_service import run_project_calculation


def _register_chinese_font() -> str:
    """Try to register a Chinese-capable font; fall back to Helvetica."""
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
            os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts", "simhei.ttf"),
        ]

    for path in font_candidates:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont("GBQFont", path, subfontIndex=0))
                return "GBQFont"
            except Exception:
                continue
    return "Helvetica"


def export_tender_package_pdf(project_id: int, db: Session) -> bytes:
    """按文件夹2（GB50500 招标工程量清单）版式生成 PDF。"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError(f"Project {project_id} not found")

    summary, line_results = run_project_calculation(project_id=project_id, db=db)
    font_name = _register_chinese_font()
    grand = float(summary.grand_total or 0)
    tax = float(summary.total_tax or 0)
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    project_name = project.name or "未命名项目"

    rows = sorted(line_results, key=lambda t: (division_rank(t[0].division or ""), t[0].sort_order or 0))
    groups: dict[str, list] = {}
    div_sums: dict[str, float] = {}
    for boq, result in rows:
        d = boq.division or "建筑工程"
        groups.setdefault(d, []).append((boq, result))
        div_sums[d] = div_sums.get(d, 0.0) + float(result.total or 0)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=12 * mm, rightMargin=12 * mm,
                            topMargin=15 * mm, bottomMargin=14 * mm)
    W = doc.width

    def P(txt, size=9, align=0, bold=False, after=0, before=0):
        return Paragraph(txt, ParagraphStyle(
            "GBQ", fontName=font_name, fontSize=size, leading=size + 5,
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
            ("BACKGROUND", (0, 0), (-1, header_rows - 1), colors.HexColor("#DCE6F1")),
        ]
        if total_row is not None:
            st.append(("BACKGROUND", (0, total_row), (-1, total_row), colors.HexColor("#E2EFDA")))
        t = Table(data, colWidths=widths, repeatRows=header_rows)
        t.setStyle(TableStyle(st))
        return t

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont(font_name, 7)
        canvas.drawCentredString(A4[0] / 2, 8 * mm,
                                 f"{project_name} — 招标工程量清单    第 {doc_.page} 页")
        canvas.restoreState()

    el: list = []

    # ── 封面（4.1 招标工程量清单封面） ──
    el.append(Spacer(1, 14 * mm))
    el.append(P("工　程", 13, 1, before=6))
    el.append(P(project_name, 16, 1, bold=True))
    el.append(P("招标工程量清单", 22, 1, bold=True, before=10, after=18))
    cover_rows = [
        ("编  制  人：", "（造价专业人员盖CA电子执业专用章）"),
        ("审  核  人：", "（一级造价工程师盖CA电子执业专用章）"),
        ("编 制 单 位：", "（盖企业CA电子印章）"),
        ("法定代表人或其委托代理人：", "（盖个人CA电子印章）"),
        ("", ""),
        ("招  标  人：", "（盖企业CA电子印章）"),
        ("法定代表人或其委托代理人：", "（盖个人CA电子印章）"),
        ("", ""),
        ("编 制 时 间：", generated),
    ]
    cover_data = []
    for left, right in cover_rows:
        cover_data.append([Paragraph(left, ParagraphStyle("g", fontName=font_name, fontSize=11,
                                                          leading=17, wordWrap="CJK")),
                           Paragraph(f"　　{right}", ParagraphStyle("g", fontName=font_name, fontSize=11,
                                                                    leading=17, wordWrap="CJK"))])
    ct = Table(cover_data, colWidths=[62 * mm, 88 * mm])
    ct.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("FONTNAME", (0, 0), (-1, -1), font_name),
    ]))
    el.append(ct)
    el.append(Spacer(1, 4 * mm))
    el.append(P("（第 1 页 共 1 页）", 8, 2))
    el.append(PageBreak())

    # ── 投标报价填报说明 ──
    el.append(P("投标报价填报说明", 15, 1, bold=True, after=8))
    el.append(P(f"工程名称：{project_name}", 10, after=6))
    el.append(P("注：投标报价填报说明应包括工程范围、工程特征、计划工期、施工现场情况、"
                "施工组织特点及其他需要说明的问题等内容。", 9, after=2))
    el.append(Spacer(1, 6 * mm))
    el.append(P("工程量清单计算规则说明", 15, 1, bold=True, after=8))
    el.append(P(f"工程名称：{project_name}", 10, after=6))
    el.append(P("注：1 采用国家及行业工程量计算标准的，应明确相应国家及行业标准的名称及编号；"
                "2 根据工程项目特点补充完善计算规则的，应列明工程量清单的详细计算规则。", 9, after=2))
    el.append(PageBreak())

    # ── 4.5 工程项目清单汇总表 ──
    el.append(P("工程项目清单汇总表", 15, 1, bold=True, after=4))
    el.append(P(f"工程名称：{project_name}", 9, after=4))
    rows5 = [("1", "分部分项工程项目", round(sum(div_sums.values()), 2)),
             ("1.1", "单项工程", round(sum(div_sums.values()), 2))]
    for i, (d, s) in enumerate(sorted(div_sums.items(), key=lambda kv: division_rank(kv[0])), 1):
        rows5.append((f"1.1.{i}", d, round(s, 2)))
    rows5.append(("2", "措施项目", 0.0))
    rows5.append(("2.1", "其中：安全生产标准化措施费", 0.0))
    rows5.append(("2.2", "其中：施工垃圾场外运输和消纳费", 0.0))
    rows5.append(("3", "其他项目", 0.0))
    rows5.append(("3.1", "其中：暂列金额（不包括计日工）", 0.0))
    rows5.append(("3.2", "其中：专业工程暂估价", 0.0))
    rows5.append(("3.3", "其中：计日工", 0.0))
    data5 = [[Paragraph("序号", ParagraphStyle("h", fontName=font_name, fontSize=9, alignment=1)),
              Paragraph("项目内容", ParagraphStyle("h", fontName=font_name, fontSize=9, alignment=1)),
              Paragraph("金额（元）", ParagraphStyle("h", fontName=font_name, fontSize=9, alignment=1))]]
    for row in rows5:
        if len(row) == 3:
            no, item, val = row
        else:
            no, item, val = row[0], row[1], row[2]
        data5.append([Paragraph(str(no), ParagraphStyle("g", fontName=font_name, fontSize=9, alignment=1)),
                      Paragraph(str(item), ParagraphStyle("g", fontName=font_name, fontSize=9, alignment=0)),
                      Paragraph(f"{val:,.2f}", ParagraphStyle("g", fontName=font_name, fontSize=9, alignment=2))])
    total_row5 = len(data5)
    data5.append([Paragraph("合计", ParagraphStyle("g", fontName=font_name, fontSize=9, alignment=1, fontWeight="bold")),
                  Paragraph("", ParagraphStyle("g", fontName=font_name, fontSize=9)),
                  Paragraph(f"{grand:,.2f}", ParagraphStyle("g", fontName=font_name, fontSize=9, alignment=2, fontWeight="bold"))])
    el.append(tbl(data5, [18 * mm, 82 * mm, 50 * mm], total_row=total_row5))
    el.append(P("注：专业工程暂估价项目中，除计日工外的暂列金额和计日工均计入本项目汇总表。", 8, 0, before=4))
    el.append(PageBreak())

    # ── 各专业分册 ──
    for unit, unit_rows in groups.items():
        # 4.6 分部分项工程项目清单计价表
        el.append(P("分部分项工程项目清单计价表", 15, 1, bold=True, after=4))
        el.append(P(f"工程名称：（{unit}单位工程）", 9, after=4))
        head = ["序号", "项目编码", "项目名称", "项目特征描述", "计量单位", "工程量", "综合单价（元）", "合价（元）"]
        data = [[Paragraph(x, ParagraphStyle("h", fontName=font_name, fontSize=8.5, alignment=1))
                 for x in head]]
        srt = sorted(unit_rows, key=lambda t: (t[0].sort_order or 0))
        for i, (boq, result) in enumerate(srt, 1):
            qty = float(boq.quantity or 1) or 1
            total = float(result.total or 0)
            data.append([
                Paragraph(str(i), ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=1)),
                Paragraph(str(boq.code or ""), ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=0)),
                Paragraph(str(boq.name or ""), ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=0)),
                Paragraph(str(boq.division or ""), ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=0)),
                Paragraph(str(boq.unit or ""), ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=1)),
                Paragraph(f"{qty:,.2f}", ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=2)),
                Paragraph(f"{total / qty:,.2f}", ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=2)),
                Paragraph(f"{total:,.2f}", ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=2)),
            ])
        t6 = len(data)
        data.append([Paragraph(chr(215), ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=1)),
                     Paragraph("本页小计", ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=0)),
                     Paragraph("", ParagraphStyle("g", fontName=font_name, fontSize=8.5)),
                     Paragraph("", ParagraphStyle("g", fontName=font_name, fontSize=8.5)),
                     Paragraph("", ParagraphStyle("g", fontName=font_name, fontSize=8.5)),
                     Paragraph("", ParagraphStyle("g", fontName=font_name, fontSize=8.5)),
                     Paragraph("", ParagraphStyle("g", fontName=font_name, fontSize=8.5)),
                     Paragraph(f"{sum(float(r.total or 0) for _, r in unit_rows):,.2f}",
                               ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=2))])
        el.append(tbl(data, [11 * mm, 25 * mm, 34 * mm, 42 * mm, 13 * mm, 16 * mm, 20 * mm, 26 * mm],
                      total_row=t6))
        el.append(P("注：为计取规费等的使用，可在表中增设其中：“定额人工费”。", 8, 0, before=4))
        el.append(PageBreak())

        # 4.7A 综合单价分析表（人材机管利）
        el.append(P("分部分项工程项目清单综合单价分析表", 15, 1, bold=True, after=4))
        el.append(P(f"工程名称：（{unit}单位工程）", 9, after=4))
        head7 = ["项目编码", "项目名称", "计量单位", "工程量", "人工费", "材料费", "机械费", "企业管理费", "利润", "综合单价"]
        data7 = [[Paragraph(x, ParagraphStyle("h", fontName=font_name, fontSize=8, alignment=1))
                  for x in head7]]
        for boq, result in srt:
            qty = float(boq.quantity or 1) or 1
            lab, mat, mac = (float(result.labor_cost or 0), float(result.material_cost or 0),
                             float(result.machine_cost or 0))
            mng, pro, tot = (float(result.management_fee or 0), float(result.profit or 0),
                             float(result.total or 0))
            cells = [str(boq.code or ""), f"{boq.name or ''}\n规格：{boq.division or ''}",
                     str(boq.unit or ""), f"{qty:,.2f}",
                     f"{lab / qty:,.2f}", f"{mat / qty:,.2f}", f"{mac / qty:,.2f}",
                     f"{mng / qty:,.2f}", f"{pro / qty:,.2f}", f"{tot / qty:,.2f}"]
            data7.append([Paragraph(c, ParagraphStyle("g", fontName=font_name, fontSize=8, alignment=2 if h > 1 else 0)) for h, c in enumerate(cells)])
        t7 = len(data7)
        data7.append([Paragraph("合计", ParagraphStyle("g", fontName=font_name, fontSize=8, alignment=1, fontWeight="bold")),
                      Paragraph("", ParagraphStyle("g", fontName=font_name, fontSize=8)),
                      Paragraph("", ParagraphStyle("g", fontName=font_name, fontSize=8)),
                      Paragraph("", ParagraphStyle("g", fontName=font_name, fontSize=8)),
                      Paragraph(f"{sum(float(r.labor_cost or 0) for _, r in unit_rows):,.2f}",
                                ParagraphStyle("g", fontName=font_name, fontSize=8, alignment=2)),
                      Paragraph(f"{sum(float(r.material_cost or 0) for _, r in unit_rows):,.2f}",
                                ParagraphStyle("g", fontName=font_name, fontSize=8, alignment=2)),
                      Paragraph(f"{sum(float(r.machine_cost or 0) for _, r in unit_rows):,.2f}",
                                ParagraphStyle("g", fontName=font_name, fontSize=8, alignment=2)),
                      Paragraph(f"{sum(float(r.management_fee or 0) for _, r in unit_rows):,.2f}",
                                ParagraphStyle("g", fontName=font_name, fontSize=8, alignment=2)),
                      Paragraph(f"{sum(float(r.profit or 0) for _, r in unit_rows):,.2f}",
                                ParagraphStyle("g", fontName=font_name, fontSize=8, alignment=2)),
                      Paragraph(f"{sum(float(r.total or 0) for _, r in unit_rows):,.2f}",
                                ParagraphStyle("g", fontName=font_name, fontSize=8, alignment=2, fontWeight="bold"))])
        el.append(tbl(data7, [24 * mm, 46 * mm, 13 * mm, 15 * mm, 17 * mm, 17 * mm, 17 * mm, 18 * mm, 14 * mm, 16 * mm],
                      fs=7.5, total_row=t7))
        el.append(PageBreak())

    # ── 增值税计价表 ──
    el.append(P("增值税计价表", 15, 1, bold=True, after=4))
    el.append(P(f"工程名称：{project_name}", 9, after=4))
    data11 = [
        ["序号", "项目名称", "计算基础", "计算基数", "税率/征收率（%）", "金额（元）"],
        ["1", "增值税", "分部分项工程项目+措施项目+其他项目-其中：专业工程暂估价", "—", "9", f"{tax:,.2f}"],
    ]
    ws11 = [[Paragraph(data11[0][h], ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=1))
             for h in range(6)]]
    ws11.append([Paragraph("1", ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=1)),
                 Paragraph("增值税", ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=0)),
                 Paragraph("分部分项工程项目+措施项目+其他项目−其中：专业工程暂估价",
                           ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=0)),
                 Paragraph("—", ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=2)),
                 Paragraph("9", ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=1)),
                 Paragraph(f"{tax:,.2f}", ParagraphStyle("g", fontName=font_name, fontSize=8.5, alignment=2))])
    el.append(tbl(ws11, [12 * mm, 22 * mm, 62 * mm, 26 * mm, 20 * mm, 26 * mm]))
    el.append(Spacer(1, 1 * mm))
    el.append(P(f"编制时间：{generated}", 9, 2))

    doc.build(el, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()