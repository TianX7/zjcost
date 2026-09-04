# -*- coding: utf-8 -*-
"""荒漠特殊工艺补充定额种子脚本（GS-01 ~ GS-05）

五项补充定额，依据 GB/T 50500-2024 计价标准可溯要求编制：
现场实测、工艺测定、专家论证、案例类比、交叉定额组合，五法并用。
覆盖：戈壁料换填、微型桩、注浆加固、光伏可逆式支架、并网调试。

幂等：按 (discipline='补充定额', quota_code) upsert，可重复执行；
GS-01 的人材机明细每次重新写入，保证与定额行一致。

用法：python seed_gs_quotas.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from app.db.session import SessionLocal
from app.models.quota_item import QuotaItem
from app.models.quota_resource_detail import QuotaResourceDetail

DISCIPLINE = "补充定额"
CHAPTER = "荒漠特殊工艺补充定额"
VERSION = "2026 荒漠驿站补充版"

# 五法并用的编制方法说明
METHOD_NOTE = (
    "编制方法：现场实测＋工艺测定＋专家论证＋案例类比＋交叉定额组合。"
    "数据源自荒漠长城遗址现场踏勘实测，五组数据互锁校验，字段化可追溯。"
)

# (编码, 名称, 单位, 人工, 材料, 机械, 基价, 工作内容, 适用范围, 检测报告编号)
SECTIONS = [
    (
        "GS-01", "戈壁料换填", "m³", 0.8, 0, 0.3, 524.75,
        "戈壁料挖、装、运、摊铺、洒水、碾压六道工序，压实系数≥0.95，分层摊铺、机械碾压成活。",
        "荒漠/戈壁砂土场地的地基换填工程，承接墙下条形基础线荷载、扩散基底压强、阻隔地下盐性水侵蚀。",
        "GS-01-JC-001",
    ),
    (
        "GS-02", "荒漠区域微型桩加固", "m", 1.2, 0.05, 0.6, 380.15,
        "成孔、清孔、钢筋笼安放、高压注浆，桩径≤300mm，砂土场地加密布设。",
        "戈壁砂土场地承载力不足区域的地基加固，替代深基础降低沉降风险。",
        "GS-02-JC-002",
    ),
    (
        "GS-03", "荒漠地基注浆加固", "m³", 1.1, 1.4, 0.55, 465.30,
        "钻孔、制浆、高压分段注浆，浆液充填砂层孔隙，形成复合地基。",
        "盐渍土、松散砂层地基的固结加固，兼防水阻盐。",
        "GS-03-JC-003",
    ),
    (
        "GS-04", "光伏可逆式支架安装", "t", 4.5, 1.05, 1.8, 1850.00,
        "檩条加密、导轨顺坡铺设、螺栓压块连接（不焊接），后期可整体拆除归还文保区域；临边双层防护网、屋面成品保护毯含在措施费内单列。",
        "平屋面混凝土配重基础与坡屋面顺铺导轨的光伏支架安装，抗风12级设计。",
        "GS-04-JC-004",
    ),
    (
        "GS-05", "光伏电站并网调试", "项", 6.0, 0.3, 3.0, 3200.00,
        "系统调试、并网检测、72小时试运行，分项计费，出具并网检测报告。",
        "荒漠驿站光伏建筑一体化的并网发电系统调试与验收。",
        "GS-05-JC-005",
    ),
]

# GS-01 人材机明细：(类别, 资源编码, 名称, 规格, 单位, 消耗量, 单价, 是否主材)
GS01_RESOURCES = [
    ("人工", "RGRN-001", "综合工日", "三类人工", "工日", 0.8, 220.00, 0),
    ("材料", "CLGL-001", "级配戈壁料", "粒径≤150mm", "m³", 1.05, 45.00, 1),
    ("材料", "CLQT-002", "水", "施工用水", "m³", 0.30, 5.00, 0),
    ("机械", "JXPB-001", "平地机", "≥118kW", "台班", 0.15, 1100.00, 0),
    ("机械", "JXYL-001", "振动压路机", "≥18t", "台班", 0.15, 900.00, 0),
]

# ── 循环材料三级计价演示数据 ─────────────────────────────────────
# 将「旧青砖回收」演示条目按 回收/加工/运输 三级拆分：
# 千块 2150 元 = 回收 800 + 加工 850 + 运输 500 → 综合单价 2.15 元/块，
# 与汇报稿「综合单价 2.15 元/块、三级可追溯」一致。
DEMO_BRICK_CODE = "OM-ZH-001"
DEMO_BRICK_LEVEL_PRICES = {"recycle_price": 800.0, "process_price": 850.0, "transport_price": 500.0, "base_price": 2150.0}


def _update_demo_brick_prices(db) -> None:
    item = (
        db.query(QuotaItem)
        .filter(QuotaItem.discipline == "旧材料", QuotaItem.quota_code == DEMO_BRICK_CODE)
        .first()
    )
    if item is None:
        print(f"提示：未找到演示旧砖条目 {DEMO_BRICK_CODE}，跳过三级价格更新")
        return
    for key, value in DEMO_BRICK_LEVEL_PRICES.items():
        setattr(item, key, value)
    print(f"演示旧砖三级价格已更新：{DEMO_BRICK_CODE} 回收800/加工850/运输500 → 综合单价 2150 元/千块（2.15 元/块）")


def _upsert_quota(db, code: str, name: str, unit: str, labor: float, material: float,
                  machine: float, base_price: float, work_content: str,
                  applicable_scope: str, report_no: str) -> QuotaItem:
    item = (
        db.query(QuotaItem)
        .filter(QuotaItem.discipline == DISCIPLINE, QuotaItem.quota_code == code)
        .first()
    )
    fields = dict(
        quota_code=code,
        discipline=DISCIPLINE,
        name=name,
        unit=unit,
        labor_qty=labor,
        material_qty=material,
        machine_qty=machine,
        base_price=base_price,
        work_content=work_content,
        applicable_scope=applicable_scope,
        chapter=CHAPTER,
        version=VERSION,
        origin_note=METHOD_NOTE,
        inspection_report_no=report_no,
        acquisition_method="",
        has_resource_details=1 if code == "GS-01" else 0,
    )
    if item is None:
        item = QuotaItem(**fields)
        db.add(item)
    else:
        for key, value in fields.items():
            setattr(item, key, value)
    return item


def _sync_resources(db, quota: QuotaItem, rows: list[tuple]) -> None:
    db.query(QuotaResourceDetail).filter(
        QuotaResourceDetail.quota_item_id == quota.id
    ).delete()
    for category, rcode, rname, spec, unit, qty, price, main in rows:
        db.add(QuotaResourceDetail(
            quota_item_id=quota.id,
            category=category,
            resource_code=rcode,
            resource_name=rname,
            spec=spec,
            unit=unit,
            quantity=qty,
            unit_price=price,
            is_main_material=main,
        ))


def main() -> None:
    db = SessionLocal()
    try:
        created = 0
        for code, name, unit, labor, material, machine, price, work, scope, report in SECTIONS:
            item = _upsert_quota(db, code, name, unit, labor, material, machine, price, work, scope, report)
            if code == "GS-01":
                db.flush()  # 先取到新定额行的 id，再插入人材机明细
                _sync_resources(db, item, GS01_RESOURCES)
            created += 1
        _update_demo_brick_prices(db)
        db.commit()
        total = db.query(QuotaItem).filter(QuotaItem.discipline == DISCIPLINE).count()
        print(f"补充定额入库完成：{created} 项（当前库内共 {total} 项，专业='{DISCIPLINE}'）")
    finally:
        db.close()


if __name__ == "__main__":
    main()