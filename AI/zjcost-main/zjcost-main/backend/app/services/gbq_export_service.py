"""GBQ-style tender package export.

按 GB 50500 招标工程量清单版式（广联达 GBQ8 清理导出样式，参考桌面"文件夹2"）
生成一个 zip：根工作簿 = 工程清单汇总（23 张 4.x 表），单项工程/各专业工作簿（9 张表）。
"""

from __future__ import annotations

import io
import zipfile
from datetime import datetime, timezone

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy.orm import Session

from app.models.boq_item import BoqItem
from app.models.calc_result import CalcResult
from app.models.line_item_quota_binding import LineItemQuotaBinding
from app.models.project import Project
from app.models.quota_item import QuotaItem
from app.services.export_service import division_rank
from app.services.project_calc_service import run_project_calculation

FONT = "宋体"

ROOT_SHEETS = [
    "4.1 招标工程量清单封面",
    "4.3 投标报价填报说明",
    "4.4 工程量清单计算规则说明",
    "4.5 工程项目清单汇总表（适用于单价合同）",
    "4.5 工程项目清单汇总表（适用于单价合同）(分包)",
    "4.8 材料暂估单价表",
    "4.9 措施项目清单计价表",
    "4.9 措施项目清单计价表(分包)",
    "4.9-1 安全生产标准化措施费明细表",
    "4.9-1 安全生产标准化措施费明细表(分包)",
    "4.9-2 施工垃圾场外运输和消纳费明细表",
    "4.9-3 措施项目清单价格组成分析表",
    "4.9-4 措施项目费用分拆表",
    "4.9-5 大型机械进出场及安拆费用组成明细表",
    "4.10 其他项目清单计价表",
    "4.10-1 暂列金额明细表",
    "4.10-2 专业工程暂估价表",
    "4.10-3 计日工表",
    "4.10-4 总承包服务费计价表",
    "4.10-3 配合服务费计价表（分包）",
    "4.11 增值税计价表",
    "4.12 费率报价表",
    "4.14 人机费用表",
]

UNIT_SHEETS = [
    "4.1 招标工程量清单封面",
    "4.3 投标报价填报说明",
    "4.4 工程量清单计算规则说明",
    "4.6 分部分项工程项目清单计价表",
    "4.7 分部分项工程项目清单综合单价分析表 A",
    "4.7 分部分项工程项目清单综合单价分析表 B",
    "4.8 材料暂估单价表",
    "4.13 主要材料选用表",
    "4.15 发包人提供的材料一览表",
]


def _new_wb(sheet_names: list[str]) -> openpyxl.Workbook:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for title in sheet_names:
        wb.create_sheet(title)
    return wb


class _Styler:
    """与 GBQ 导出相仿的样式助手：细黑边框 + 宋体 + 浅蓝表头。"""

    def __init__(self, ws):
        self.ws = ws
        self._thin = Side(style="thin", color="999999")
        self.BD = Border(left=self._thin, right=self._thin, top=self._thin, bottom=self._thin)
        self.HDR_FILL = PatternFill("solid", start_color="DCE6F1")
        self.SUB_FILL = PatternFill("solid", start_color="F2F7FB")

    def css(self, r1, c1, r2=None, c2=None) -> None:
        ws = self.ws
        r2 = r2 or r1
        c2 = c2 or c1
        for r in range(r1, r2 + 1):
            for c in range(c1, c2 + 1):
                cell = ws.cell(row=r, column=c)
                cell.border = self.BD
                if cell.font and not cell.font.name:
                    cell.font = Font(name=FONT, size=10)
                if cell.alignment is None or not cell.alignment.horizontal:
                    cell.alignment = Alignment(horizontal="left", vertical="center")

    def put(self, r, c, v, *, font: Font | None = None, align: str = "left",
            fill: str | None = None, border: bool = True, size: int = 10, bold: bool = False) -> None:
        ws = self.ws
        cell = ws.cell(row=r, column=c, value=v)
        cell.font = font or Font(name=FONT, size=size, bold=bold)
        cell.alignment = Alignment(horizontal=align, vertical="center", wrap_text=(align == "left"))
        if fill:
            cell.fill = PatternFill("solid", start_color=fill)
        if border:
            cell.border = self.BD
        return cell

    def merge(self, r1, c1, r2, c2, v="", *, font=None, align="center", size=10, bold=False,
              border=True, fill=None):
        if r1 == r2 and c1 == c2:
            return self.put(r1, c1, v, font=font, align=align, size=size, bold=bold, border=border, fill=fill)
        ws = self.ws
        ws.merge_cells(start_row=r1, start_column=c1, end_row=r2, end_column=c2)
        return self.put(r1, c1, v, font=font, align=align, size=size, bold=bold, border=border, fill=fill)

    def widths(self, widths: list[float]) -> None:
        for i, w in enumerate(widths, 1):
            self.ws.column_dimensions[get_column_letter(i)].width = w

    def header(self, r, headers: list[tuple[int, str, bool]], fill="DCE6F1") -> None:
        for c, text, bold in headers:
            self.put(r, c, text, align="center", fill=fill, border=True, bold=bold)

    def note_row(self, r, text, c1=1, c2=None) -> None:
        ws = self.ws
        for c in range(c1, (c2 or ws.max_column) + 1):
            if ws.cell(row=r, column=c).border:
                ws.cell(row=r, column=c).border = Border()


# ── 通用封面 / 说明 ──────────────────────────────────────────────


def _cover(ws, st: _Styler, project_name: str, widths: list[float]) -> None:
    st.merge(1, 1, 1, 2, "工程名称:", align="left", size=10)
    st.merge(1, 3, 1, 7, project_name, align="left", bold=True, size=11)
    st.merge(2, 1, 2, 7, "招标工程量清单", align="center", size=20, bold=True, border=False)
    rows = [
        ("编  制  人：", "(造价专业人员盖CA电子执业专用章)"),
        ("审  核  人：", "(一级造价工程师盖CA电子执业专用章)"),
        ("编 制 单 位：", "(盖企业CA电子印章)"),
        ("法定代表人或其委托代理人：", "(盖个人CA电子印章)"),
        ("", ""),
        ("招  标  人：", "(盖企业CA电子印章)"),
        ("法定代表人或其委托代理人：", "(盖个人CA电子印章)"),
        ("", ""),
        ("编 制 时 间：", "      年    月    日"),
    ]
    r = 4
    for left, right in rows:
        st.merge(r, 1, r, 2, left, align="left")
        st.merge(r, 3, r, 4, "", align="left")
        st.merge(r, 5, r, 6, right, align="left")
        r += 1
    st.merge(r, 1, r, 7, "", border=False)
    st.widths(widths)


def _fill_declare(ws, st: _Styler, project_name: str, title: str, note: str, widths: list[float]) -> None:
    st.merge(1, 2, 1, 4, title, align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 4, f"工程名称：{project_name}", align="left", border=False)
    st.put(2, 5, "第  1  页  共  1  页", align="right", border=False)
    st.merge(3, 1, 4, 5, note, align="left", size=9)
    st.note_row(5, "注：")
    st.widths(widths)


# ── 根工作簿：工程清单汇总（23 表） ────────────────────────────


def _build_root_wb(project: Project, grand: float, total_boq: float, regulatory: float,
                   tax: float, div_sums: dict[str, float]) -> bytes:
    wb = _new_wb(ROOT_SHEETS)
    wb.fonts = None
    name = project.name or "未命名项目"

    # 4.1 封面
    _cover(wb["4.1 招标工程量清单封面"], _Styler(wb["4.1 招标工程量清单封面"]), name,
           [11, 13, 12, 20, 14, 14, 12])

    # 4.3 投标报价填报说明
    st = _Styler(wb["4.3 投标报价填报说明"])
    _fill_declare(wb["4.3 投标报价填报说明"], st, name, "投标报价填报说明",
                  "注：投标报价填报说明应包括工程范围、工程特征、计划工期、施工现场情况、施工组织特点及其他需要说明的问题等内容。",
                  [20, 10, 26, 10, 20])

    # 4.4 工程量清单计算规则说明
    st = _Styler(wb["4.4 工程量清单计算规则说明"])
    _fill_declare(wb["4.4 工程量清单计算规则说明"], st, name, "工程量清单计算规则说明",
                  "注：1 采用国家及行业工程量计算标准的，应明确相应国家及行业标准的名称及编号；\n"
                  "    2 根据工程项目特点补充完善计算规则的，应列明工程量清单的详细计算规则。",
                  [18, 10, 30, 22, 10])

    # 4.5 工程项目清单汇总表
    for wname in ("4.5 工程项目清单汇总表（适用于单价合同）", "4.5 工程项目清单汇总表（适用于单价合同）(分包)"):
        ws = wb[wname]
        st = _Styler(ws)
        st.merge(1, 1, 1, 8, "工程项目清单汇总表", align="center", size=14, bold=True, border=False)
        st.merge(2, 1, 2, 6, f"工程名称：{name}", align="left", border=False)
        st.put(2, 8, "第 1 页  共 1 页", align="right", border=False)
        st.merge(3, 1, 3, 3, "序号", align="center", fill="DCE6F1", bold=True)
        st.merge(3, 4, 3, 6, "项目内容", align="center", fill="DCE6F1", bold=True)
        st.merge(3, 7, 3, 7, "金额（元）", align="center", fill="DCE6F1", bold=True)
        st.merge(3, 8, 3, 8, "其中：材料暂估价（元）", align="center", fill="DCE6F1", bold=True)
        st.widths([8, 26, 3, 8, 10, 10, 12, 16])
        r = 4
        st.put(4, 1, "1", align="center")
        st.merge(4, 2, 4, 3, "分部分项工程项目", align="left")
        r += 1
        st.put(r, 1, "1.1", align="center")
        st.merge(r, 2, r, 3, "单项工程", align="left")
        r += 1
        for i, (d, s) in enumerate(sorted(div_sums.items(), key=lambda kv: division_rank(kv[0])), 1):
            st.put(r, 1, f"1.1.{i}", align="center")
            st.merge(r, 2, r, 3, d, align="left")
            st.put(r, 7, round(s, 2), align="right")
            r += 1
        for no, lab in [("2", "措施项目"), ("2.1", "其中：安全生产标准化措施费"),
                        ("2.2", "其中：施工垃圾场外运输和消纳费"),
                        ("3", "其他项目"), ("3.1", "其中：暂列金额（不包括计日工）"),
                        ("3.2", "其中：专业工程暂估价"), ("3.3", "其中：计日工")]:
            st.put(r, 1, no, align="center")
            st.merge(r, 2, r, 3, lab, align="left")
            r += 1
        st.put(r, 1, "合计", align="center", bold=True)
        st.merge(r, 2, r, 3, "", align="left")
        st.put(r, 7, round(grand, 2), align="right", bold=True)
        st.merge(r + 1, 1, r + 1, 8, "", border=False)

    # 4.8 材料暂估单价表（根，空框架）
    _blank_4_8(wb["4.8 材料暂估单价表"], name, [7, 30, 11, 9, 10, 8, 8, 16])

    # 4.9 措施项目清单计价表
    for wname in ("4.9 措施项目清单计价表", "4.9 措施项目清单计价表(分包)"):
        _measure_4_9(wb[wname], name)

    # 4.9-1 安全生产标准化措施费明细表
    for wname in ("4.9-1 安全生产标准化措施费明细表", "4.9-1 安全生产标准化措施费明细表(分包)"):
        _measure_4_9_1(wb[wname], name)

    # 4.9-2 施工垃圾场外运输和消纳费明细表
    _measure_4_9_2(wb["4.9-2 施工垃圾场外运输和消纳费明细表"], name)

    # 4.9-3 措施项目清单价格组成分析表
    _measure_4_9_3(wb["4.9-3 措施项目清单价格组成分析表"], name)

    # 4.9-4 措施项目费用分拆表
    _measure_4_9_4(wb["4.9-4 措施项目费用分拆表"], name)

    # 4.9-5 大型机械进出场及安拆费用组成明细表
    _measure_4_9_5(wb["4.9-5 大型机械进出场及安拆费用组成明细表"], name)

    # 4.10 其他项目清单计价表
    _other_4_10(wb["4.10 其他项目清单计价表"], name)

    # 4.10-1 暂列金额明细表
    _other_4_10_1(wb["4.10-1 暂列金额明细表"], name)

    # 4.10-2 专业工程暂估价表
    _other_4_10_2(wb["4.10-2 专业工程暂估价表"], name)

    # 4.10-3 计日工表
    _other_4_10_3(wb["4.10-3 计日工表"], name)

    # 4.10-4 总承包服务费计价表 + 4.10-3 配合服务费计价表（分包）
    _other_4_10_4(wb["4.10-4 总承包服务费计价表"], name, "总承包服务费计价表")
    _other_4_10_4(wb["4.10-3 配合服务费计价表（分包）"], name, "配合服务费计价表")

    # 4.11 增值税计价表
    _vatax_4_11(wb["4.11 增值税计价表"], name, tax)

    # 4.12 费率报价表
    _rate_4_12(wb["4.12 费率报价表"], name)

    # 4.14 人机费用表
    _man_machine_4_14(wb["4.14 人机费用表"], name, div_sums)

    buf = io.BytesIO()
    wb.save(buf)
    wb.close()
    return buf.getvalue()


def _blank_4_8(ws, name, widths) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 8, "材料暂估单价表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 6, f"工程名称：{name}", align="left", border=False)
    st.put(2, 8, "第  1  页  共  1  页", align="right", border=False)
    st.header(3, [(1, "序号", True), (2, "材料名称", True), (4, "规格型号", True),
                  (5, "单位", True), (7, "暂估单价（元）", True), (8, "备注", True)])
    st.merge(3, 1, 4, 1); st.merge(3, 2, 4, 2); st.merge(3, 4, 4, 4)
    st.merge(3, 5, 4, 5); st.merge(3, 7, 4, 7); st.merge(3, 8, 4, 8)
    st.widths(widths)


def _measure_4_9(ws, name) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 9, "措施项目清单计价表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 8, f"工程名称：{name}", align="left", border=False)
    st.put(2, 9, "第 1 页  共 1 页", align="right", border=False)
    st.header(3, [(1, "序号", True), (3, "项目编码", True), (4, "项目名称", True),
                  (5, "计量单位", True), (6, "工作内容", True), (7, "价格（元）", True), (9, "备注", True)])
    st.merge(3, 1, 3, 2); st.merge(3, 7, 3, 8)
    rows = [("1", "安全生产标准化措施费", "项", "附明细", "明细详见表4.9-1"),
            ("2", "现场管理费", "项", "明细详见表4.9-3", "明细详见表4.9-3"),
            ("3", "施工垃圾场外运输和消纳费", "项", "明细详见表4.9-2", "明细详见表4.9-2"),
            ("4", "脚手架工程费", "项", "明细详见表4.9-3", "明细详见表4.9-3")]
    r = 4
    for no, item, unit, work, note in rows:
        st.put(r, 1, no, align="center"); st.merge(r, 1, r, 2)
        st.put(r, 4, item, align="left"); st.put(r, 5, unit, align="center")
        st.put(r, 6, work, align="left"); st.merge(r, 7, r, 8)
        st.put(r, 9, note, align="left")
        r += 1
    st.widths([4, 4, 9, 15, 12, 11, 11, 4, 16])


def _measure_4_9_1(ws, name) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 12, "安全生产标准化措施费明细表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 9, f"工程名称：{name}", align="left", border=False)
    st.put(2, 12, "第 1 页  共 1 页", align="right", border=False)
    st.merge(3, 1, 4, 1, "序号", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 4, 4, 4, "项目编码", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 5, 4, 5, "项目名称", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 6, 3, 8, "不含税金额（元）", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 11, 4, 11, "含税金额（元）", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 12, 4, 12, "备注", align="center", fill="DCE6F1", bold=True)
    st.put(4, 6, "实际成本（元）", align="center", fill="DCE6F1", bold=True)
    st.put(4, 7, "企业管理费（元）", align="center", fill="DCE6F1", bold=True)
    st.put(4, 8, "利润（元）", align="center", fill="DCE6F1", bold=True)
    st.put(4, 10, "小计（元）", align="center", fill="DCE6F1", bold=True)
    rows = [("1", "管理目标等级（达标）对应的《图集》标准内项目措施费", ["1.1 安全生产费", "1.2 文明施工费", "1.3 环境保护费", "1.4 临时设施费"]),
            ("2", "特殊安全生产标准化措施费", ["2.1 管理目标等级对应的《图集》标准外项目措施费",
                                          "2.2 超过一定规模的危大工程对应的安全生产标准化增加措施费",
                                          "2.3 其他特殊安全生产标准化措施费"])]
    r = 5
    for no, head, subs in rows:
        st.put(r, 1, no, align="center")
        st.merge(r, 2, r, 5)
        st.put(r, 2, head, align="left")
        st.merge(r, 6, r, 10)
        r += 1
        for sub in subs:
            st.put(r, 1, "其", align="center")
            st.put(r, 2, "", align="center")
            st.merge(r, 3, r, 5)
            st.put(r, 3, sub, align="left")
            st.merge(r, 6, r, 10)
            r += 1
    st.put(r, 1, "合  计", align="center", bold=True)
    st.merge(r, 2, r, 10)
    st.print_area = f"A1:L{r}"
    st.widths([4, 4, 3, 8, 24, 10, 10, 10, 4, 10, 10, 8])


def _measure_4_9_2(ws, name) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 11, "施工垃圾场外运输和消纳费明细表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 8, f"工程名称：{name}", align="left", border=False)
    st.put(2, 11, "第 1 页  共 1 页", align="right", border=False)
    st.header(3, [(1, "序号", True), (2, "项目编码", True), (3, "项目名称", True),
                  (4, "计算基础", True), (7, "费率（%）", True), (8, "企业管理费（元）", True),
                  (9, "利润（元）", True), (10, "不含税金额（元）", True), (11, "备注", True)])
    rows = [("1", "（单项工程）施工垃圾场外运输和消纳费"), ("1.1", "（各单位工程）施工垃圾场外运输和消纳费")]
    r = 4
    for no, lab in rows:
        st.put(r, 1, no, align="center"); st.merge(r, 2, r, 2)
        st.merge(r, 3, r, 3, lab, align="left")
        st.merge(r, 4, r, 5)
        st.merge(r, 7, r, 7); st.merge(r, 8, r, 8); st.merge(r, 9, r, 9)
        st.merge(r, 10, r, 10); st.put(r, 11, "按实发生计取", align="left")
        r += 1
    st.put(r, 1, "合  计", align="center", bold=True)
    st.merge(r, 2, r, 10)
    st.widths([10, 12, 28, 14, 4, 8, 8, 12, 12, 12, 12])


def _measure_4_9_3(ws, name) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 12, "措施项目清单价格组成分析表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 9, f"工程名称：{name}", align="left", border=False)
    st.put(2, 12, "第 1 页  共 1 页", align="right", border=False)
    st.header(3, [(1, "项目编码", True), (2, "措施项目名称", True), (3, "拟采取主要方案或投入资源描述", True),
                  (4, "实际成本详细计算过程", True), (6, "不含税金额（元）", True),
                  (11, "含税金额（元）", True), (12, "备注", True)])
    st.put(4, 6, "实际成本", align="center", fill="DCE6F1", bold=True)
    st.put(4, 7, "企业管理费", align="center", fill="DCE6F1", bold=True)
    st.put(4, 8, "利润", align="center", fill="DCE6F1", bold=True)
    st.put(4, 9, "小计", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 6, 3, 10)
    sample = ["安全生产费", "安全帽", "临边洞口交叉高处作业防护", "文明施工费", "安全警示标志牌", "废水沉淀池"]
    r = 5
    st.merge(5, 2, 5, 3)
    st.put(5, 2, "", align="left")
    for i, s in enumerate(sample):
        st.merge(r, 2, r, 3)
        st.put(r, 2, s, align="left")
        st.merge(r, 4, r, 5)
        st.merge(r, 6, r, 8)
        st.merge(r, 9, r, 10)
        st.put(r, 11, "", align="right"); st.put(r, 12, "", align="left")
        r += 1
    st.widths([10, 12, 22, 6, 6, 10, 9, 9, 4, 10, 12, 12])


def _measure_4_9_4(ws, name) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 12, "措施项目费用分拆表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 8, f"工程名称：{name}", align="left", border=False)
    st.put(2, 12, "第 1 页  共 1 页", align="right", border=False)
    st.header(3, [(1, "序号", True), (2, "项目编码", True), (4, "措施项目名称", True),
                  (6, "价格（元）", True)])
    st.merge(3, 6, 3, 7)
    st.put(3, 8, "1.初始设立费用", align="center", fill="DCE6F1", bold=True)
    st.put(3, 10, "2.中期运行费用", align="center", fill="DCE6F1", bold=True)
    st.put(3, 12, "3.后期拆除费用", align="center", fill="DCE6F1", bold=True)
    st.put(4, 8, "占比（%）", align="center", fill="DCE6F1", bold=True)
    st.put(4, 9, "金额（元）", align="center", fill="DCE6F1", bold=True)
    st.put(4, 10, "占比（%）", align="center", fill="DCE6F1", bold=True)
    st.put(4, 11, "金额（元）", align="center", fill="DCE6F1", bold=True)
    st.put(4, 12, "占比（%）", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 8, 3, 9); st.merge(3, 10, 3, 11)
    sample = [("1", "措施项目"), ("1.1", "安全生产标准化措施费"),
              ("1.1.1", "管理目标等级（达标）对应的《图集》标准内项目措施费"),
              ("1.1.1.1", "安全生产费"), ("1.1.1.1.1", "安全帽"), ("1.1.1.1.2", "临边洞口交叉高处作业防护")]
    r = 5
    for no, s in sample:
        st.put(r, 1, no, align="center")
        st.merge(r, 2, r, 3)
        st.merge(r, 4, r, 5)
        st.put(r, 4, s, align="left")
        for c in (6, 7, 8, 9, 10, 11, 12):
            st.put(r, c, "", align="right")
        r += 1
    st.widths([10, 12, 4, 18, 6, 10, 8, 8, 8, 8, 10, 10])


def _measure_4_9_5(ws, name) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 11, "大型机械进出场及安拆费用组成明细表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 8, f"工程名称：{name}", align="left", border=False)
    st.put(2, 11, "第 1 页  共 1 页", align="right", border=False)
    st.merge(3, 1, 5, 1, "序号", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 2, 5, 2, "大型机械名称、规格、型号", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 3, 5, 3, "数量", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 4, 5, 4, "进出场次数", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 5, 3, 7, "进出场及安拆费用综合单价（元）", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 8, 5, 8, "合价（元）", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 9, 5, 9, "备注", align="center", fill="DCE6F1", bold=True)
    st.put(4, 5, "机械安拆费", align="center", fill="DCE6F1", bold=True)
    st.put(4, 6, "机械装卸运输费", align="center", fill="DCE6F1", bold=True)
    st.put(4, 7, "固定装置安拆费", align="center", fill="DCE6F1", bold=True)
    st.put(5, 5, "C1", align="center", fill="DCE6F1"); st.put(5, 6, "C2", align="center", fill="DCE6F1")
    st.put(5, 7, "C3", align="center", fill="DCE6F1")
    r = 6
    for s in ("汽车起重机 25t", "塔式起重机 QTZ63"):
        st.put(r, 1, r - 5, align="center")
        st.merge(r, 2, r, 2, s, align="left")
        st.put(r, 3, "", align="center"); st.put(r, 4, "", align="center")
        st.merge(r, 5, r, 5); st.merge(r, 6, r, 6); st.merge(r, 7, r, 7)
        st.put(r, 8, "", align="right"); st.put(r, 9, "按实际发生计取", align="left")
        r += 1
    st.widths([7, 14, 7, 9, 9, 10, 9, 10, 9, 9, 9])


def _other_4_10(ws, name) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 7, "其他项目清单计价表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 6, f"工程名称：{name}", align="left", border=False)
    st.put(2, 7, "第 1 页  共 1 页", align="right", border=False)
    st.header(3, [(1, "序号", True), (2, "项目名称", True), (4, "计量单位", True),
                  (5, "金额（元）", True), (7, "备注", True)])
    rows = [("1", "暂列金额（不包括计日工）（不含税）", "明细详见表4.10-1"),
            ("2", "专业工程暂估价（含税）", "明细详见表4.10-2"),
            ("3", "计日工（不含税）", "明细详见表4.10-3"),
            ("4", "总承包服务费（不含税）", "明细详见表4.10-4"),
            ("5", "合同中约定的其他项目（不含税）", "")]
    r = 4
    for no, lab, note in rows:
        st.put(r, 1, no, align="center")
        st.merge(r, 2, r, 3, lab, align="left")
        st.put(r, 4, "项", align="center")
        st.merge(r, 5, r, 6)
        st.put(r, 7, note, align="left")
        r += 1
    st.widths([10, 20, 8, 12, 12, 4, 22])


def _other_4_10_1(ws, name) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 8, "暂列金额明细表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 6, f"工程名称：{name}", align="left", border=False)
    st.put(2, 8, "第 1 页  共 1 页", align="right", border=False)
    st.header(3, [(1, "序号", True), (2, "项目名称", True), (4, "计量单位", True),
                  (5, "不含税金额（元）", True), (7, "含税金额（元）", True), (8, "备注", True)])
    rows = [("1", "合同价格调整暂列金额", None), ("2", "未确定工程暂列金额", "2.1 未确定建筑工程"),]
    r = 4
    for no, lab, sub in rows:
        st.put(r, 1, no, align="center")
        if sub:
            st.put(r, 2, "", align="left")
            st.put(r, 2, "未确定工程暂列金额", align="left")
            st.put(r, 1, "2", align="center")
        else:
            st.merge(r, 2, r, 3, lab, align="left")
            st.put(r, 4, "元", align="center")
        st.merge(r, 5, r, 6); st.merge(r, 7, r, 7)
        r += 1
    st.widths([11, 24, 8, 6, 12, 6, 10, 14])


def _other_4_10_2(ws, name) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 10, "专业工程暂估价表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 8, f"工程名称：{name}", align="left", border=False)
    st.put(2, 10, "第 1 页  共 1 页", align="right", border=False)
    st.header(3, [(1, "序号", True), (2, "工程名称", True), (3, "工程内容", True),
                  (4, "暂估金额（元）", True), (8, "人+机占比（%）", True), (10, "备注", True)])
    st.put(4, 4, "不含税金额（元）", align="center", fill="DCE6F1", bold=True)
    st.put(4, 5, "增值税（元）", align="center", fill="DCE6F1", bold=True)
    st.put(4, 6, "含税金额（元）", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 4, 3, 6); st.merge(3, 8, 3, 9)
    st.widths([6, 14, 18, 11, 11, 11, 7, 7, 9, 12])


def _other_4_10_3(ws, name) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 8, "计 日 工 表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 7, f"工程名称：{name}", align="left", border=False)
    st.put(2, 8, "第  1  页  共  1  页", align="right", border=False)
    st.header(3, [(1, "编号", True), (3, "计日工名称", True), (4, "单位", True),
                  (5, "暂定数量", True), (6, "综合单价（元）", True), (7, "合价（元）", True)])
    st.merge(3, 3, 3, 3)
    rows = [("一", "人工", None), ("1", "普工", "工日"), ("", "人工小计", None),
            ("二", "材料", None), ("1", "水泥 42.5", "t"), ("", "材料小计", None),
            ("三", "施工机具", None), ("1", "汽车起重机 25t", "台班"), ("", "施工机具小计", None)]
    r = 4
    for no, item, unit in rows:
        st.put(r, 1, no, align="center")
        st.merge(r, 3, r, 3, item, align="left")
        st.put(r, 4, unit or "", align="center")
        st.put(r, 5, "", align="right"); st.put(r, 6, "", align="right"); st.put(r, 7, "", align="right")
        st.merge(r, 7, r, 7)
        r += 1
    st.put(r, 1, "4", align="center")
    st.merge(r, 3, r, 3, "企业管理费和利润", align="left")
    st.widths([8, 4, 30, 9, 10, 11, 12, 8])


def _other_4_10_4(ws, name, title) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 9, title, align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 8, f"工程名称：{name}", align="left", border=False)
    st.put(2, 9, "第 1 页  共 1 页", align="right", border=False)
    st.header(3, [(1, "序号", True), (2, "项目名称", True), (4, "服务内容", True),
                  (5, "计算基础（元）", True), (6, "费率（%）", True), (7, "金额（元）", True), (9, "备注", True)])
    rows = [("1", "发包人提供的材料", "材料保管工作"), ("2", "暂估价专业分包工程", "施工质量、进度管理；竣工资料管理"),
            ("3", "发包人发包专业工程", "施工质量、进度管理；竣工资料管理")]
    r = 4
    for no, item, svc in rows:
        st.put(r, 1, no, align="center")
        st.merge(r, 2, r, 3, item, align="left")
        st.put(r, 4, svc, align="left")
        st.merge(r, 5, r, 5); st.put(r, 6, "", align="center")
        st.merge(r, 7, r, 8)
        st.put(r, 9, "", align="left")
        r += 1
    st.widths([9, 25, 6, 18, 12, 8, 8, 4, 12])


def _vatax_4_11(ws, name, tax) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 8, "增值税计价表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 7, f"工程名称：{name}", align="left", border=False)
    st.put(2, 8, "第 1 页  共 1 页", align="right", border=False)
    st.header(3, [(1, "序号", True), (2, "项目名称", True), (3, "计算基础说明", True),
                  (4, "计算基数", True), (6, "税率/征收率（%）", True), (7, "金额（元）", True)])
    st.put(4, 1, "1", align="center")
    st.merge(4, 2, 4, 2, "增值税", align="left")
    st.merge(4, 3, 4, 3, "分部分项工程项目+措施项目+其他项目-其中：专业工程暂估价", align="left")
    st.merge(4, 4, 4, 5)
    st.put(4, 6, "9", align="center")
    st.merge(4, 7, 4, 7, round(tax, 2), align="right")
    st.widths([10, 16, 26, 10, 6, 10, 10, 8])


def _rate_4_12(ws, name) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 6, "费率报价表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 6, f"工程名称：{name}", align="left", border=False)
    st.header(3, [(1, "序号", True), (2, "费用名称", True), (4, "取费基数", True), (6, "报价费率（%）", True)])
    st.merge(3, 2, 3, 3); st.merge(3, 4, 3, 5)
    rows = [("A", "_________工程", None), ("A.1", "企业管理费", None), ("A.2", "利润", None),
            ("B", "_________工程", None), ("B.1", "企业管理费", None), ("B.2", "利润", None),
            ("C", "措施项目", None), ("C.1", "企业管理费", None), ("C.2", "利润", None)]
    r = 4
    for no, item, _ in rows:
        if no.startswith("A") and len(no) == 1:
            st.merge(r, 2, r, 3, item, align="left", bold=True)
            st.put(r, 1, no, align="center")
        else:
            st.put(r, 1, no, align="center")
            st.merge(r, 2, r, 3, item, align="left")
        st.merge(r, 4, r, 5)
        st.put(r, 6, "", align="right")
        r += 1
    st.widths([12, 16, 8, 14, 8, 12])


def _man_machine_4_14(ws, name, div_sums) -> None:
    # 人机费用表：按分部汇总人工费+施工机具使用费。因汇总口径来自 calc 单价结果，
    # 演示按各分部清单条目估算（这里取分部合计的权重示意，具体由调用方注入）。
    st = _Styler(ws)
    st.merge(1, 1, 1, 5, "人机费用表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 4, f"工程名称：{name}", align="left", border=False)
    st.put(2, 5, "第  1  页  共  1  页", align="right", border=False)
    st.header(3, [(1, "序号", True), (2, "工程名称", True), (3, "人工费＋施工机具使用费（元）", True)])
    st.put(4, 1, "A", align="center")
    st.merge(4, 2, 4, 2, "单项工程", align="left", bold=True)
    st.merge(4, 3, 4, 3, round(sum(div_sums.values()), 2) or "", align="right")
    r = 5
    for i, d in enumerate(div_sums, 1):
        st.put(r, 1, f"A.{i}", align="center")
        st.merge(r, 2, r, 2, d, align="left")
        st.merge(r, 3, r, 3, round(div_sums[d], 2), align="right")
        r += 1
    st.widths([12, 38, 22, 10, 12])


# ── 单位工程工作簿：各专业（9 表） ────────────────────────────


def _build_unit_wb(project: Project, unit_name: str, rows: list[tuple[BoqItem, CalcResult]]) -> bytes:
    wb = _new_wb(UNIT_SHEETS)
    name = unit_name

    _cover(wb["4.1 招标工程量清单封面"], _Styler(wb["4.1 招标工程量清单封面"]), name,
           [10, 14, 12, 20, 12, 14, 10])

    st = _Styler(wb["4.3 投标报价填报说明"])
    _fill_declare(wb["4.3 投标报价填报说明"], st, name, "投标报价填报说明",
                  "注：投标报价填报说明应包括工程范围、工程特征、计划工期、施工现场情况、施工组织特点及其他需要说明的问题等内容。",
                  [20, 10, 26, 10, 20])

    st = _Styler(wb["4.4 工程量清单计算规则说明"])
    _fill_declare(wb["4.4 工程量清单计算规则说明"], st, name, "工程量清单计算规则说明",
                  "注：1 采用国家及行业工程量计算标准的，应明确相应国家及行业标准的名称及编号；\n"
                  "    2 根据工程项目特点补充完善计算规则的，应列明工程量清单的详细计算规则。",
                  [18, 10, 30, 22, 10])

    _unit_4_6(wb["4.6 分部分项工程项目清单计价表"], name, rows)
    _unit_4_7_a(wb["4.7 分部分项工程项目清单综合单价分析表 A"], name, rows)
    _unit_4_7_b(wb["4.7 分部分项工程项目清单综合单价分析表 B"], name, rows)

    _blank_4_8(wb["4.8 材料暂估单价表"], name, [12, 31, 9, 9, 10, 8, 8, 16])

    _unit_4_13(wb["4.13 主要材料选用表"], name, rows)

    st = _Styler(wb["4.15 发包人提供的材料一览表"])
    ws = wb["4.15 发包人提供的材料一览表"]
    st.merge(1, 1, 1, 11, "发包人提供材料一览表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 9, f"工程名称：{name}", align="left", border=False)
    st.put(2, 11, "第 1 页  共 1 页", align="right", border=False)
    st.header(3, [(1, "序号", True), (2, "材料设备名称", True), (4, "规格型号", True),
                  (5, "单位", True), (6, "数量", True), (7, "单价（元）", True),
                  (8, "合价（元）", True), (10, "其中：有效损耗率（%）", True), (11, "备注", True)])
    st.merge(3, 1, 4, 1); st.merge(3, 2, 4, 2); st.merge(3, 4, 4, 4)
    st.merge(3, 5, 4, 5); st.merge(3, 6, 4, 6); st.merge(3, 7, 4, 7)
    st.merge(3, 8, 4, 9); st.merge(3, 10, 4, 10); st.merge(3, 11, 4, 11)
    st.widths([8, 21, 3, 10, 7, 8, 9, 8, 8, 10, 10])

    buf = io.BytesIO()
    wb.save(buf)
    wb.close()
    return buf.getvalue()


def _unit_4_6(ws, name, rows) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 11, "分部分项工程项目清单计价表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 10, f"工程名称：（{name}单位工程）", align="left", border=False)
    st.put(2, 11, "第 1 页  共 1 页", align="right", border=False)
    st.merge(3, 1, 5, 1, "序号", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 2, 5, 2, "项目编码", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 3, 5, 3, "项目名称", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 4, 5, 4, "项目特征描述", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 5, 5, 5, "计量单位", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 6, 5, 6, "工程量", align="center", fill="DCE6F1", bold=True)
    st.merge(3, 7, 3, 11, "金额（元）", align="center", fill="DCE6F1", bold=True)
    st.put(4, 7, "综合单价", align="center", fill="DCE6F1", bold=True)
    st.put(4, 8, "合价", align="center", fill="DCE6F1", bold=True)
    st.merge(4, 9, 4, 11, "其中", align="center", fill="DCE6F1", bold=True)
    st.put(5, 9, "材料暂估价", align="center", fill="DCE6F1", bold=True)
    st.merge(4, 7, 5, 7); st.merge(4, 8, 5, 8)
    st.merge(5, 9, 5, 9); st.merge(5, 10, 5, 11)
    r = 6
    for i, (boq, result) in enumerate(rows, 1):
        qty = float(boq.quantity or 1) or 1
        total = float(result.total or 0)
        st.put(r, 1, i, align="center")
        st.put(r, 2, boq.code or "", align="left")
        st.put(r, 3, boq.name or "", align="left")
        st.put(r, 4, boq.division or "未分类", align="left")
        st.put(r, 5, boq.unit or "", align="center")
        st.put(r, 6, round(qty, 2), align="right")
        st.put(r, 7, round(total / qty, 2), align="right")
        st.put(r, 8, round(total, 2), align="right")
        st.merge(r, 9, r, 11)
        r += 1
    st.put(r, 1, "", align="left")
    st.merge(r, 2, r, 7, "本页小计", align="left")
    st.put(r, 8, round(sum(float(res.total or 0) for _, res in rows), 2), align="right")
    st.merge(r, 9, r, 11)
    st.merge(r + 1, 2, r + 1, 11, "注：为计取规费等的使用，可在表中增设其中：“定额人工费”。", align="left", border=False)
    st.widths([7, 10, 11, 14, 9, 7, 8, 10, 4, 3, 4])


def _unit_4_7_a(ws, name, rows) -> None:
    st = _Styler(ws)
    st.widths([9, 20, 8, 8, 9, 9, 4, 9, 9, 8, 9, 4, 9, 9, 9, 8])
    r = 1
    for boq, result in rows:
        qty = float(boq.quantity or 1) or 1
        lab, mat, mac = (float(result.labor_cost or 0), float(result.material_cost or 0),
                         float(result.machine_cost or 0))
        mng, pro, tot = (float(result.management_fee or 0), float(result.profit or 0),
                         float(result.total or 0))
        up = (lambda v: round(v / qty, 2)) if qty else (lambda v: 0)
        st.merge(r, 1, r, 16, "")
        r += 1
        st.merge(r, 1, r, 15, f"工程名称：{name}", align="left", border=False)
        st.put(r, 16, "第 1 页  共 1 页", align="right", border=False)
        r += 1
        st.merge(r, 1, r, 2, "项目编码", align="center", fill="DCE6F1", bold=True)
        st.merge(r, 3, r, 4, boq.code or "", align="left")
        st.merge(r, 5, r, 7, "项目名称", align="center", fill="DCE6F1", bold=True)
        st.merge(r, 8, r, 10, boq.name or "", align="left")
        st.merge(r, 11, r, 11, "计量单位", align="center", fill="DCE6F1", bold=True)
        st.put(r, 12, boq.unit or "", align="center")
        st.put(r, 13, "工程量", align="center", fill="DCE6F1", bold=True)
        st.merge(r, 14, r, 15, round(qty, 2), align="right")
        st.merge(r, 16, r, 16, "综合单价（元）", align="center", fill="DCE6F1", bold=True, size=9)
        r += 1
        st.merge(r, 1, r, 16, "清单综合单价组成明细", align="center", fill="DCE6F1", bold=True)
        r += 1
        st.put(r, 1, "编制依据", align="center", fill="DCE6F1", bold=True)
        st.merge(r, 2, r, 5, "名称", align="center", fill="DCE6F1")
        st.put(r, 7, "单位", align="center", fill="DCE6F1")
        st.put(r, 8, "数量", align="center", fill="DCE6F1")
        st.merge(r, 9, r, 11, "单价（元）", align="center", fill="DCE6F1")
        st.merge(r, 12, r, 14, "合价（元）", align="center", fill="DCE6F1")
        st.merge(r, 15, r, 16, "备注", align="center", fill="DCE6F1")
        r += 1
        h = r
        for c, v in [(1, "编号"), (2, "定额项目"), (7, "单位"), (8, "数量"),
                     (9, "人工费"), (10, "材料费"), (11, "机械费"), (12, "人工费"),
                     (13, "材料费"), (14, "机械费")]:
            st.put(r, c, v, align="center", fill="DCE6F1", bold=True)
        st.merge(r, 2, r, 6)
        st.merge(r, 9, r, 9); st.merge(r, 10, r, 10); st.merge(r, 11, r, 11)
        st.merge(r, 12, r, 12); st.merge(r, 13, r, 13); st.merge(r, 14, r, 14)
        st.merge(r, 15, r, 16)
        r += 1
        st.put(r, 1, "1-01", align="center")
        st.merge(r, 2, r, 6, "综合定额（组价结果）", align="left")
        st.put(r, 7, boq.unit or "", align="center")
        st.put(r, 8, round(qty, 2), align="right")
        for c, v in [(9, up(lab)), (10, up(mat)), (11, up(mac)),
                     (12, round(lab + mac, 2)), (13, round(mat, 2)), (14, 0)]:
            st.put(r, c, v, align="right")
        st.merge(r, 15, r, 16)
        r += 2
        st.merge(r, 1, r, 16, "")
        r += 1
        st.merge(r, 1, r, 16, "材    料    费    明    细", align="center", fill="DCE6F1", bold=True)
        r += 1
        for c, v in [(1, "序号"), (2, "主要材料名称、规格、型号"), (8, "单位"), (9, "数量"),
                     (10, "单价（元）"), (12, "合价（元）"), (14, "暂估单价（元）"), (15, "暂估合价（元）")]:
            st.put(r, c, v, align="center", fill="DCE6F1", bold=True)
        st.merge(r, 2, r, 7)
        st.merge(r, 8, r, 8); st.merge(r, 9, r, 9); st.merge(r, 10, r, 11)
        st.merge(r, 12, r, 13); st.put(r, 14, "", align="center"); st.put(r, 15, "", align="center")
        r += 1
        st.put(r, 1, 1, align="center")
        st.merge(r, 2, r, 7, "主要材料（综合）", align="left")
        st.put(r, 8, boq.unit or "", align="center")
        st.put(r, 9, round(qty, 2), align="right")
        st.merge(r, 10, r, 11, up(mat), align="right")
        st.merge(r, 12, r, 13, round(mat, 2), align="right")
        st.put(r, 14, "", align="right"); st.put(r, 15, "", align="right")
        r += 1
        st.put(r, 1, "", align="left")
        st.merge(r, 2, r, 13, "清单项目综合单价", align="left", bold=True)
        st.merge(r, 14, r, 16, round(tot / qty, 2) if qty else 0, align="right", bold=True)
        r += 2
    st.put(r, 1, "", align="left", border=False)
    st.merge(r, 2, r, 16, "注：1.如不使用省级或行业建设主管部门发布的计价依据，可不填定额编码、名称等；\n    2.招标文件提供了暂估单价的材料，按暂估的单价填入相应栏。", align="left", border=False)


def _unit_4_7_b(ws, name, rows) -> None:
    st = _Styler(ws)
    st.widths([9, 14, 7, 8, 9, 12, 8, 8, 8, 5, 9, 8])
    r = 1
    for boq, result in rows:
        qty = float(boq.quantity or 1) or 1
        lab, mat, mac = (float(result.labor_cost or 0), float(result.material_cost or 0),
                         float(result.machine_cost or 0))
        mng, pro, tot = (float(result.management_fee or 0), float(result.profit or 0),
                         float(result.total or 0))
        up = (lambda v: round(v / qty, 2)) if qty else (lambda v: 0)
        st.merge(r, 1, r, 12, "")
        r += 1
        st.merge(r, 1, r, 11, f"工程名称：{name}", align="left", border=False)
        st.put(r, 12, "第 1 页  共 1 页", align="right", border=False)
        r += 1
        st.put(r, 1, "项目编码", align="center", fill="DCE6F1", bold=True)
        st.put(r, 2, boq.code or "", align="left")
        st.put(r, 3, "项目名称", align="center", fill="DCE6F1", bold=True)
        st.merge(r, 4, r, 6, boq.name or "", align="left")
        st.put(r, 7, "计量单位", align="center", fill="DCE6F1", bold=True)
        st.put(r, 8, boq.unit or "", align="center")
        r += 1
        st.put(r, 1, "项目特征", align="center", fill="DCE6F1", bold=True)
        st.merge(r, 2, r, 12, f"{boq.division or ''}／{boq.name or ''}", align="left")
        r += 1
        st.header(r, [(1, "序号", True), (2, "费用项目", True), (4, "单位", True),
                      (5, "数量", True), (7, "计算基础（元）", True), (8, "费率（%）", True),
                      (9, "单价（元）", True), (10, "其中：暂估单价（元）", True),
                      (11, "合价（元）", True), (12, "其中：暂估合价（元）", True)])
        st.merge(r, 2, r, 3); st.merge(r, 4, r, 4); st.merge(r, 5, r, 6)
        st.merge(r, 7, r, 7); st.merge(r, 8, r, 8); st.merge(r, 9, r, 9)
        st.merge(r, 10, r, 10); st.merge(r, 11, r, 11); st.merge(r, 12, r, 12)
        r += 1
        fees = [("1", "人工费", up(lab), round(lab, 2)),
                ("2", "材料费", up(mat), round(mat, 2)),
                ("3", "施工机具使用费", up(mac), round(mac, 2)),
                ("4", "1+2+3小计", round(up(lab) + up(mat) + up(mac), 2), round(lab + mat + mac, 2)),
                ("5", "企业管理费", up(mng), round(mng, 2)),
                ("6", "利润", up(pro), round(pro, 2))]
        for no, label, u, t in fees:
            st.put(r, 1, no, align="center")
            st.merge(r, 2, r, 3, label, align="left")
            st.put(r, 4, "", align="center")
            st.merge(r, 5, r, 6, "", align="right")
            st.put(r, 7, "", align="right"); st.put(r, 8, "", align="center")
            st.merge(r, 9, r, 9, u, align="right")
            st.put(r, 10, "", align="right")
            st.merge(r, 11, r, 11, t, align="right")
            st.put(r, 12, "", align="right")
            r += 1
        st.merge(r, 1, r, 10, "综合单价（元）", align="left", bold=True)
        st.merge(r, 11, r, 12, round(tot / qty, 2) if qty else 0, align="right", bold=True)
        r += 2


def _unit_4_13(ws, name, rows) -> None:
    st = _Styler(ws)
    st.merge(1, 1, 1, 10, "主要材料选用表", align="center", size=14, bold=True, border=False)
    st.merge(2, 1, 2, 10, f"工程名称：{name}", align="left", border=False)
    st.header(3, [(1, "序号", True), (2, "材料名称", True), (3, "单位", True),
                  (4, "单价（元）", True), (5, "数量", True), (7, "品牌/厂家", True),
                  (8, "规格型号", True), (10, "备注", True)])
    st.merge(3, 5, 3, 6); st.merge(3, 7, 3, 7); st.merge(3, 8, 3, 9)
    st.merge(3, 10, 3, 10)
    r = 4
    for i, (boq, result) in enumerate(rows, 1):
        qty = float(boq.quantity or 1) or 1
        mat = float(result.material_cost or 0)
        st.put(r, 1, i, align="center")
        st.merge(r, 2, r, 2, f"{boq.name or ''}（主材）", align="left")
        st.put(r, 3, boq.unit or "", align="center")
        st.put(r, 4, round(mat / qty, 2) if qty else 0, align="right")
        st.merge(r, 5, r, 6, round(qty, 2) if qty else "", align="right")
        st.put(r, 7, "／", align="center")
        st.merge(r, 8, r, 9, "荒漠调价系数 ×1.15", align="left")
        st.put(r, 10, "", align="left")
        r += 1
    st.widths([10, 24, 9, 15, 8, 8, 12, 10, 10, 6])


# ── 打包主入口 ──────────────────────────────────────────────


def export_tender_package(project_id: int, db: Session) -> bytes:
    """导出招标工程量清单 zip 包（文件夹2样式）：

        {项目名}.xlsx                  ← 23 张根表（4.1~4.14）
        └─ 单项工程/
           ├─ {专业A}/{专业A}.xlsx     ← 9 张单位工程表
           └─ {专业B}/{专业B}.xlsx
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError(f"Project {project_id} not found")

    summary, line_results = run_project_calculation(project_id=project_id, db=db)
    grand = float(summary.grand_total or 0)
    total_boq = float(sum((r.total or 0) for _, r in line_results))
    regulatory = float(summary.total_regulatory or 0)
    tax = float(summary.total_tax or 0)

    groups: dict[str, list[tuple[BoqItem, CalcResult]]] = {}
    for boq, result in line_results:
        groups.setdefault(boq.division or "建筑工程", []).append((boq, result))
    div_sums = {d: sum(float(res.total or 0) for _, res in rows) for d, rows in groups.items()}

    root_bytes = _build_root_wb(project, grand, total_boq, regulatory, tax, div_sums)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        safe_root = "".join(c if c not in '\\/:*?"<>|' else "_" for c in (project.name or "项目"))
        zf.writestr(f"{safe_root}.xlsx", root_bytes)
        for unit, rows in groups.items():
            safe_unit = "".join(c if c not in '\\/:*?"<>|' else "_" for c in (unit or "建筑工程"))
            zf.writestr(f"单项工程/{safe_unit}/{safe_unit}.xlsx",
                        _build_unit_wb(project, unit, sorted(rows, key=lambda t: (division_rank(t[0].division or ""), t[0].sort_order))))
    return buf.getvalue()