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

# 说明：GS 五项基价已统一降低 50%（原价/2 固化为下方 SECTIONS 与 GS_RESOURCES 数据，
# 不保留运行时折扣，保证 seed 幂等可重复执行）。

# 五法并用的编制方法说明
METHOD_NOTE = (
    "编制方法：现场实测＋工艺测定＋专家论证＋案例类比＋交叉定额组合。"
    "数据源自荒漠长城遗址现场踏勘实测，五组数据互锁校验，字段化可追溯。"
)

# (编码, 名称, 单位, 人工, 材料, 机械, 基价, 工作内容, 适用范围, 检测报告编号)
SECTIONS = [
    (
        "GS-01", "戈壁料换填", "10m³", 8.00, 10.80, 1.90, 1708.500,
        "测量放线、基坑开挖、戈壁料装运（含场内运输）、分层摊铺、洒水湿润、分层碾压夯实、压实系数检测、整平找坡、余土外运等全部施工过程。六道工序：挖、装、运、摊铺、洒水、碾压。",
        "适用于荒漠戈壁砂土场地、盐渍土场地的地基换填处理，换填材料为级配戈壁料（砂砾石），换填厚度≤1.0m，压实系数≥0.95。换填厚度超过1.0m时，人工和机械消耗量乘以系数1.10。",
        "GS-01-CL-2026-001",
    ),
    (
        "GS-02", "荒漠微型桩加固", "10m", 6.50, 12.00, 2.25, 1750.250,
        "测量放线定位、钻机就位、成孔（螺旋钻孔/潜孔锤成孔）、清孔、钢筋笼制作安装、注浆管埋设、水泥砂浆灌注、桩头处理、桩间土清理、检测配合等全部施工过程。",
        "适用于荒漠软弱地基、盐渍土地基的微型桩加固处理，孔径φ150～φ300mm，桩长≤15m，桩型为钢筋混凝土灌注桩（压力注浆型）。",
        "GS-02-CL-2026-002",
    ),
    (
        "GS-03", "荒漠地基注浆加固", "10m", 5.20, 11.00, 2.10, 1475.000,
        "测量放线、注浆孔定位、钻机成孔、注浆管安装、封孔、浆液配制、压力注浆（分序注浆）、注浆效果检测配合、孔口处理等全部施工过程。",
        "适用于荒漠软弱地基、粉细砂层、盐渍土层的注浆加固处理，包括防渗帷幕注浆、地基补强注浆、回填土注浆密实等。注浆孔深≤20m，注浆压力≤1.0MPa。",
        "GS-03-CL-2026-003",
    ),
    (
        "GS-04", "光伏可逆式支架安装", "10组", 4.80, 24.00, 0.75, 2759.500,
        "支架基础检查验收、支架构件开箱检验、配重块安装（平屋面）、导轨安装（坡屋面）、支架立柱/横梁安装、组件压块安装、临边安全防护、屋面成品保护、支架调整校正、自检记录等全部施工过程。",
        "适用于文化遗产保护工程、文保建筑及类似对屋面完整性有特殊要求的建（构）筑物的光伏建筑一体化可逆式支架安装。包括平屋面配重式和坡屋面导轨式两种安装形式，抗风等级≥12级。",
        "GS-04-CL-2026-004",
    ),
    (
        "GS-05", "光伏并网调试", "1系统", 12.00, 50.00, 13.50, 3855.125,
        "光伏系统检查、绝缘电阻测试、接地电阻测试、逆变器参数设置、系统联调、并网检测、72小时试运行、试运行数据记录、调试报告编制等全部施工过程。",
        "适用于荒漠文旅驿站及类似建（构）筑物的分布式光伏建筑一体化系统并网调试，装机容量≤500kWp，电压等级≤380V/10kV。含系统自检、联调、72小时试运行。",
        "GS-05-CL-2026-005",
    ),
]

# 各 GS 人材机明细（对齐《荒漠文旅项目企业补充定额（GS系列·试行版）》）：
# (类别, 资源编码, 名称, 规格, 单位, 消耗量, 单价, 是否主材)
GS_RESOURCES = {
"GS-01": [
    ("人工", "RGRN-001", "综合工日", "建筑普工+技工", "工日", 8.00, 110.000, 0),
    ("材料", "CLGL-001", "戈壁料", "级配砂砾石，最大粒径≤60mm", "m³", 10.80, 17.500, 1),
    ("材料", "CLQT-002", "水", "洒水湿润用", "m³", 0.60, 2.500, 0),
    ("机械", "JXZJ-031", "装载机", "1.5m³以内", "台班", 0.50, 450.000, 0),
    ("机械", "JXZC-032", "自卸汽车", "5t以内", "台班", 0.80, 325.000, 0),
    ("机械", "JXYL-001", "振动压路机", "12t以内", "台班", 0.30, 375.000, 0),
    ("机械", "JXDH-033", "蛙式打夯机", "2.8kW", "台班", 0.20, 90.000, 0),
    ("机械", "JXSC-034", "洒水车", "4000L", "台班", 0.10, 225.000, 0),
],
"GS-02": [
    ("人工", "RGRN-002", "综合工日", "技工+普工", "工日", 6.50, 110.000, 0),
    ("材料", "CLGJ-101", "钢筋", "HRB400，φ12～φ25", "t", 0.18, 1900.000, 1),
    ("材料", "CLSN-102", "水泥", "P·O 42.5", "t", 0.45, 260.000, 0),
    ("材料", "CLZS-103", "中砂", "细度模数2.3～2.0", "m³", 0.30, 60.000, 0),
    ("材料", "CLZG-104", "注浆管", "φ25mm PVC", "m", 12.00, 4.000, 0),
    ("材料", "CLQT-105", "水", "", "m³", 0.50, 2.500, 0),
    ("机械", "JXLZ-201", "螺旋钻机", "φ300以内", "台班", 0.80, 300.000, 0),
    ("机械", "JXKY-202", "空气压缩机", "9m³/min", "台班", 0.50, 250.000, 0),
    ("机械", "JXZB-203", "注浆泵", "UB-3型", "台班", 0.60, 200.000, 0),
    ("机械", "JXQD-204", "钢筋切断机", "φ40以内", "台班", 0.10, 75.000, 0),
    ("机械", "JXWQ-205", "钢筋弯曲机", "φ40以内", "台班", 0.10, 75.000, 0),
    ("机械", "JXDH-206", "交流电焊机", "30kVA", "台班", 0.15, 60.000, 0),
],
"GS-03": [
    ("人工", "RGRN-003", "综合工日", "技工+普工", "工日", 5.20, 110.000, 0),
    ("材料", "CLSN-301", "水泥", "P·O 42.5", "t", 0.80, 260.000, 1),
    ("材料", "CLSB-302", "水玻璃", "模数2.8～3.2，波美度38～40°Bé", "t", 0.15, 900.000, 0),
    ("材料", "CLZS-303", "中砂", "", "m³", 0.10, 60.000, 0),
    ("材料", "CLZG-304", "注浆管", "φ25mm PVC/镀锌钢管", "m", 11.00, 4.000, 0),
    ("材料", "CLQT-305", "水", "", "m³", 0.80, 2.500, 0),
    ("机械", "JXDZ-401", "地质钻机", "XY-1型", "台班", 0.60, 325.000, 0),
    ("机械", "JXZB-402", "注浆泵", "UBJ-2型，压力≤1MPa", "台班", 0.80, 210.000, 0),
    ("机械", "JXNJ-403", "泥浆搅拌机", "φ800mm", "台班", 0.40, 175.000, 0),
    ("机械", "JXKY-404", "空气压缩机", "9m³/min", "台班", 0.30, 250.000, 0),
],
"GS-04": [
    ("人工", "RGRN-004", "综合工日", "安装技工+普工", "工日", 4.80, 110.000, 0),
    ("材料", "CLDG-501", "铝合金导轨", "6063-T5，阳极氧化", "m", 24.00, 15.000, 1),
    ("材料", "CLYB-502", "中压块/边压块", "铝合金，配套螺栓", "个", 80.00, 1.500, 0),
    ("材料", "CLJJ-503", "专用夹具", "屋面檩条夹具", "个", 40.00, 7.500, 0),
    ("材料", "CLLS-504", "螺栓螺母", "不锈钢304，M8/M10", "个", 120.00, 0.750, 0),
    ("材料", "CLPZ-505", "混凝土配重块", "C30预制，按设计", "个", 20.00, 60.000, 0),
    ("材料", "CLCP-506", "成品保护膜", "阻燃", "m²", 15.00, 4.000, 0),
    ("材料", "CLAQ-507", "安全防护网", "双层，密目式", "m²", 8.00, 6.000, 0),
    ("机械", "JXDB-601", "电动扳手", "充电式，力矩可调", "台班", 0.40, 50.000, 0),
    ("机械", "JXHL-602", "手动葫芦", "1t", "台班", 0.20, 100.000, 0),
    ("机械", "JXQJ-603", "切割机", "型材切割机", "台班", 0.15, 90.000, 0),
],
"GS-05": [
    ("人工", "RGRN-005", "综合工日", "电气调试工程师+技工", "工日", 12.00, 130.000, 0),
    ("材料", "CLXL-701", "调试用线缆", "BV-2.5mm²", "m", 50.00, 1.250, 0),
    ("材料", "CLBQ-702", "标识标签", "", "个", 1.00, 2.500, 0),
    ("材料", "CLBZ-703", "调试报告用纸", "A4", "张", 0.50, 0.250, 0),
    ("机械", "JXGF-801", "光伏系统测试仪", "PROVA-200A或同级", "台班", 2.00, 400.000, 0),
    ("机械", "JXJY-802", "绝缘电阻测试仪", "500V/1000V", "台班", 1.50, 150.000, 0),
    ("机械", "JXJD-803", "接地电阻测试仪", "数字式", "台班", 1.00, 125.000, 0),
    ("机械", "JXDN-804", "电能质量分析仪", "FLUKE-435或同级", "台班", 1.50, 300.000, 0),
    ("机械", "JXWB-805", "万用表", "数字式，高精度", "台班", 3.00, 60.000, 0),
    ("机械", "JXQL-806", "钳形电流表", "交直流", "台班", 2.00, 75.000, 0),
    ("机械", "JXBJ-807", "笔记本电脑", "含调试软件", "台班", 3.00, 100.000, 0),
],
}

# ── 循环材料三级计价演示数据 ─────────────────────────────────────
# 将「旧青砖回收」演示条目按 回收/加工/运输 三级拆分：
# 千块 2150 元 = 回收 800 + 加工 850 + 运输 500 → 综合单价 2.15 元/块，
# 与汇报稿「综合单价 2.15 元/块、三级可追溯」一致。
# 加工价 850 元/千块 = 清洗 250 + 切割 300 + 打磨 150 + 钻孔 150，四道工序可逐项追溯。
DEMO_BRICK_CODE = "OM-ZH-001"
DEMO_BRICK_LEVEL_PRICES = {
    "recycle_price": 800.0,
    "process_price": 850.0,
    "transport_price": 500.0,
    # ── 加工价工序拆分（单位：元/千块） ──
    "clean_price": 250.0,
    "cut_price": 300.0,
    "polish_price": 150.0,
    "drill_price": 150.0,
    # ── 三级价格来源凭证（可追溯） ──
    "recycle_source": "旧建材市场调研表-2026-08-20（汉口北市场）",
    "recycle_supplier": "汉口北旧建材大市场·废旧砖回收区",
    "process_source": "加工合同 JG-2026-021（清洗/切割/打磨/钻孔工序单价表）",
    "transport_source": "就地回收短运距运费单（500m）",
    "transport_distance": "500m",
    "base_price": 2150.0,
}


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
    print("  加工价 850 = 清洗250 + 切割300 + 打磨150 + 钻孔150，四道工序逐项可追溯")


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
        has_resource_details=1 if code in GS_RESOURCES else 0,
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
            if code in GS_RESOURCES:
                db.flush()  # 先取到新定额行的 id，再插入人材机明细
                _sync_resources(db, item, GS_RESOURCES[code])
            created += 1
        _update_demo_brick_prices(db)
        db.commit()
        total = db.query(QuotaItem).filter(QuotaItem.discipline == DISCIPLINE).count()
        print(f"补充定额入库完成：{created} 项（当前库内共 {total} 项，专业='{DISCIPLINE}'）")
    finally:
        db.close()


if __name__ == "__main__":
    main()
