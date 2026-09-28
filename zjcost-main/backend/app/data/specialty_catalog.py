"""Specialty material and quota catalog for less-common project types.

These values are built-in reference data for offline workflows. They are
not a substitute for project-specific information prices or supplier quotes.
"""

from __future__ import annotations

REFERENCE_EFFECTIVE_DATE = "2026-06-01"

SPECIALTY_DISCIPLINES = ("仿古", "光伏", "水利灌溉")

SPECIALTY_MATERIAL_PRICES: list[dict[str, object]] = [
    # 仿古 / 古建
    {"code": "FG-MAT-001", "name": "仿古青砖", "spec": "240x115x53 MU10", "unit": "千块", "unit_price": 980, "region": "", "source": "reference", "category": "仿古材料"},
    {"code": "FG-MAT-002", "name": "仿古小青瓦", "spec": "180x180mm", "unit": "千片", "unit_price": 1450, "region": "", "source": "reference", "category": "仿古材料"},
    {"code": "FG-MAT-003", "name": "仿古筒瓦", "spec": "200x120mm", "unit": "千片", "unit_price": 1680, "region": "", "source": "reference", "category": "仿古材料"},
    {"code": "FG-MAT-004", "name": "仿古板瓦", "spec": "200x180mm", "unit": "千片", "unit_price": 1280, "region": "", "source": "reference", "category": "仿古材料"},
    {"code": "FG-MAT-005", "name": "勾头滴水", "spec": "青灰陶制", "unit": "套", "unit_price": 28, "region": "", "source": "reference", "category": "仿古材料"},
    {"code": "FG-MAT-006", "name": "仿古脊瓦", "spec": "青灰陶制", "unit": "m", "unit_price": 96, "region": "", "source": "reference", "category": "仿古材料"},
    {"code": "FG-MAT-007", "name": "青石板", "spec": "600x300x30mm", "unit": "m²", "unit_price": 185, "region": "", "source": "reference", "category": "仿古石材"},
    {"code": "FG-MAT-008", "name": "青石栏板", "spec": "雕刻栏板", "unit": "m", "unit_price": 1280, "region": "", "source": "reference", "category": "仿古石材"},
    {"code": "FG-MAT-009", "name": "青石望柱", "spec": "150x150x1200mm", "unit": "根", "unit_price": 680, "region": "", "source": "reference", "category": "仿古石材"},
    {"code": "FG-MAT-010", "name": "杉木古建构件料", "spec": "一级烘干", "unit": "m³", "unit_price": 4200, "region": "", "source": "reference", "category": "仿古木作"},
    {"code": "FG-MAT-011", "name": "斗拱成品构件", "spec": "中式仿古", "unit": "攒", "unit_price": 2600, "region": "", "source": "reference", "category": "仿古木作"},
    {"code": "FG-MAT-012", "name": "木雕花格", "spec": "仿古窗棂", "unit": "m²", "unit_price": 760, "region": "", "source": "reference", "category": "仿古木作"},
    {"code": "FG-MAT-013", "name": "砖雕构件", "spec": "仿古纹样", "unit": "件", "unit_price": 320, "region": "", "source": "reference", "category": "仿古材料"},
    {"code": "FG-MAT-014", "name": "糯米灰浆", "spec": "古建修缮配合比", "unit": "m³", "unit_price": 680, "region": "", "source": "reference", "category": "仿古灰浆"},
    {"code": "FG-MAT-015", "name": "麻刀灰", "spec": "石灰麻刀浆", "unit": "m³", "unit_price": 520, "region": "", "source": "reference", "category": "仿古灰浆"},
    {"code": "FG-MAT-016", "name": "桐油", "spec": "木作防护", "unit": "kg", "unit_price": 34, "region": "", "source": "reference", "category": "仿古油饰"},
    {"code": "FG-MAT-017", "name": "生漆", "spec": "古建油饰", "unit": "kg", "unit_price": 185, "region": "", "source": "reference", "category": "仿古油饰"},

    # 光伏
    {"code": "PV-MAT-001", "name": "单晶硅光伏组件", "spec": "N型 575Wp", "unit": "块", "unit_price": 520, "region": "", "source": "reference", "category": "光伏材料"},
    {"code": "PV-MAT-002", "name": "单晶硅光伏组件", "spec": "PERC 550Wp", "unit": "块", "unit_price": 480, "region": "", "source": "reference", "category": "光伏材料"},
    {"code": "PV-MAT-003", "name": "组串式逆变器", "spec": "110kW", "unit": "台", "unit_price": 18500, "region": "", "source": "reference", "category": "光伏设备"},
    {"code": "PV-MAT-004", "name": "微型逆变器", "spec": "2kW", "unit": "台", "unit_price": 1680, "region": "", "source": "reference", "category": "光伏设备"},
    {"code": "PV-MAT-005", "name": "热镀锌光伏支架", "spec": "Q235B", "unit": "t", "unit_price": 6200, "region": "", "source": "reference", "category": "光伏支架"},
    {"code": "PV-MAT-006", "name": "铝合金光伏导轨", "spec": "AL6005-T5", "unit": "m", "unit_price": 32, "region": "", "source": "reference", "category": "光伏支架"},
    {"code": "PV-MAT-007", "name": "光伏电缆", "spec": "PV1-F 1x4mm²", "unit": "m", "unit_price": 5.8, "region": "", "source": "reference", "category": "光伏电缆"},
    {"code": "PV-MAT-008", "name": "光伏电缆", "spec": "PV1-F 1x6mm²", "unit": "m", "unit_price": 8.6, "region": "", "source": "reference", "category": "光伏电缆"},
    {"code": "PV-MAT-009", "name": "MC4接头", "spec": "1500V", "unit": "套", "unit_price": 9.5, "region": "", "source": "reference", "category": "光伏电缆"},
    {"code": "PV-MAT-010", "name": "直流汇流箱", "spec": "16进1出 1500V", "unit": "台", "unit_price": 3200, "region": "", "source": "reference", "category": "光伏设备"},
    {"code": "PV-MAT-011", "name": "交流并网柜", "spec": "400V", "unit": "台", "unit_price": 16800, "region": "", "source": "reference", "category": "光伏设备"},
    {"code": "PV-MAT-012", "name": "箱式变压器", "spec": "10kV/0.4kV 1250kVA", "unit": "台", "unit_price": 185000, "region": "", "source": "reference", "category": "光伏设备"},
    {"code": "PV-MAT-013", "name": "镀锌接地扁钢", "spec": "40x4", "unit": "m", "unit_price": 13.5, "region": "", "source": "reference", "category": "光伏防雷接地"},
    {"code": "PV-MAT-014", "name": "镀锌电缆桥架", "spec": "200x100", "unit": "m", "unit_price": 78, "region": "", "source": "reference", "category": "光伏电缆"},
    {"code": "PV-MAT-015", "name": "屋面光伏压载块", "spec": "C30预制", "unit": "块", "unit_price": 42, "region": "", "source": "reference", "category": "光伏支架"},

    # 古渠灌溉 / 水利
    {"code": "IR-MAT-001", "name": "青石渠板", "spec": "600x400x80mm", "unit": "块", "unit_price": 95, "region": "", "source": "reference", "category": "古渠灌溉"},
    {"code": "IR-MAT-002", "name": "毛石", "spec": "MU30", "unit": "m³", "unit_price": 165, "region": "", "source": "reference", "category": "古渠灌溉"},
    {"code": "IR-MAT-003", "name": "块石", "spec": "护砌用", "unit": "m³", "unit_price": 210, "region": "", "source": "reference", "category": "古渠灌溉"},
    {"code": "IR-MAT-004", "name": "浆砌石砂浆", "spec": "M10", "unit": "m³", "unit_price": 330, "region": "", "source": "reference", "category": "古渠灌溉"},
    {"code": "IR-MAT-005", "name": "HDPE防渗膜", "spec": "1.0mm", "unit": "m²", "unit_price": 18.5, "region": "", "source": "reference", "category": "灌溉防渗"},
    {"code": "IR-MAT-006", "name": "复合土工膜", "spec": "两布一膜 600g", "unit": "m²", "unit_price": 12.8, "region": "", "source": "reference", "category": "灌溉防渗"},
    {"code": "IR-MAT-007", "name": "预制混凝土U型渠槽", "spec": "U60", "unit": "m", "unit_price": 128, "region": "", "source": "reference", "category": "灌溉渠槽"},
    {"code": "IR-MAT-008", "name": "预制混凝土U型渠槽", "spec": "U80", "unit": "m", "unit_price": 188, "region": "", "source": "reference", "category": "灌溉渠槽"},
    {"code": "IR-MAT-009", "name": "PE灌溉管", "spec": "DN160 PE100", "unit": "m", "unit_price": 76, "region": "", "source": "reference", "category": "灌溉管材"},
    {"code": "IR-MAT-010", "name": "HDPE双壁波纹管", "spec": "DN300 SN8", "unit": "m", "unit_price": 185, "region": "", "source": "reference", "category": "灌溉管材"},
    {"code": "IR-MAT-011", "name": "铸铁闸门", "spec": "600x600 手电两用", "unit": "套", "unit_price": 6800, "region": "", "source": "reference", "category": "灌溉闸门"},
    {"code": "IR-MAT-012", "name": "螺杆启闭机", "spec": "5t", "unit": "台", "unit_price": 5200, "region": "", "source": "reference", "category": "灌溉闸门"},
    {"code": "IR-MAT-013", "name": "橡胶止水带", "spec": "300x8mm", "unit": "m", "unit_price": 58, "region": "", "source": "reference", "category": "灌溉防渗"},
    {"code": "IR-MAT-014", "name": "闭孔泡沫板", "spec": "20mm", "unit": "m²", "unit_price": 16, "region": "", "source": "reference", "category": "灌溉防渗"},
    {"code": "IR-MAT-015", "name": "生态护坡砌块", "spec": "400x300x120mm", "unit": "m²", "unit_price": 86, "region": "", "source": "reference", "category": "灌溉护砌"},
    {"code": "IR-MAT-016", "name": "砂砾石垫层", "spec": "级配", "unit": "m³", "unit_price": 145, "region": "", "source": "reference", "category": "灌溉护砌"},
]

SPECIALTY_QUOTA_ITEMS: list[dict[str, object]] = [
    # 仿古
    {"quota_code": "FG-A0101", "discipline": "仿古", "name": "仿古青砖墙砌筑", "unit": "m³", "labor_qty": 6.2, "material_qty": 4.8, "machine_qty": 0.2, "work_content": "选砖、浸水、调制灰浆、砌筑、勾缝、养护", "applicable_scope": "适用于仿古建筑、古建修缮青砖墙体", "chapter": "第1章 仿古砌筑与屋面", "base_price": 0.0},
    {"quota_code": "FG-A0102", "discipline": "仿古", "name": "仿古小青瓦屋面铺设", "unit": "m²", "labor_qty": 2.4, "material_qty": 3.6, "machine_qty": 0.1, "work_content": "铺瓦、调脊、座浆、清理", "applicable_scope": "适用于坡屋面仿古小青瓦", "chapter": "第1章 仿古砌筑与屋面", "base_price": 0.0},
    {"quota_code": "FG-A0103", "discipline": "仿古", "name": "筒瓦板瓦屋面铺设", "unit": "m²", "labor_qty": 2.8, "material_qty": 4.2, "machine_qty": 0.1, "work_content": "铺设筒瓦、板瓦、座浆、调直", "applicable_scope": "适用于仿古筒板瓦屋面", "chapter": "第1章 仿古砌筑与屋面", "base_price": 0.0},
    {"quota_code": "FG-A0104", "discipline": "仿古", "name": "勾头滴水安装", "unit": "m", "labor_qty": 1.1, "material_qty": 1.8, "machine_qty": 0.0, "work_content": "挂线、安装、座浆、校正", "applicable_scope": "适用于檐口勾头滴水构件", "chapter": "第1章 仿古砌筑与屋面", "base_price": 0.0},
    {"quota_code": "FG-B0101", "discipline": "仿古", "name": "木构架梁枋制作安装", "unit": "m³", "labor_qty": 18.0, "material_qty": 8.5, "machine_qty": 1.2, "work_content": "放样、下料、榫卯加工、吊装、校正", "applicable_scope": "适用于仿古木梁、枋、柱等构架", "chapter": "第2章 仿古木作", "base_price": 0.0},
    {"quota_code": "FG-B0102", "discipline": "仿古", "name": "斗拱制作安装", "unit": "攒", "labor_qty": 10.5, "material_qty": 6.8, "machine_qty": 0.5, "work_content": "构件制作、编号、试拼、安装、加固", "applicable_scope": "适用于仿古斗拱和装饰斗拱", "chapter": "第2章 仿古木作", "base_price": 0.0},
    {"quota_code": "FG-B0103", "discipline": "仿古", "name": "木花格门窗制作安装", "unit": "m²", "labor_qty": 4.5, "material_qty": 5.2, "machine_qty": 0.2, "work_content": "木作加工、安装、五金、修整", "applicable_scope": "适用于仿古花格窗、槅扇", "chapter": "第2章 仿古木作", "base_price": 0.0},
    {"quota_code": "FG-C0101", "discipline": "仿古", "name": "青石板地面铺装", "unit": "m²", "labor_qty": 1.6, "material_qty": 3.8, "machine_qty": 0.1, "work_content": "基层处理、试排、铺贴、勾缝", "applicable_scope": "适用于庭院、廊道、古建地面", "chapter": "第3章 仿古石作与雕饰", "base_price": 0.0},
    {"quota_code": "FG-C0102", "discipline": "仿古", "name": "石栏杆望柱安装", "unit": "m", "labor_qty": 3.6, "material_qty": 8.0, "machine_qty": 0.8, "work_content": "定位、吊装、校正、灌浆固定", "applicable_scope": "适用于仿古石栏板、望柱", "chapter": "第3章 仿古石作与雕饰", "base_price": 0.0},
    {"quota_code": "FG-C0103", "discipline": "仿古", "name": "砖雕木雕构件安装", "unit": "件", "labor_qty": 1.4, "material_qty": 2.5, "machine_qty": 0.0, "work_content": "基层处理、定位、安装、修补", "applicable_scope": "适用于仿古装饰雕刻构件", "chapter": "第3章 仿古石作与雕饰", "base_price": 0.0},
    {"quota_code": "FG-D0101", "discipline": "仿古", "name": "糯米灰浆勾缝", "unit": "m²", "labor_qty": 1.0, "material_qty": 1.2, "machine_qty": 0.0, "work_content": "清缝、配浆、勾缝、养护", "applicable_scope": "适用于古建砖石墙面修缮", "chapter": "第4章 仿古油饰修缮", "base_price": 0.0},
    {"quota_code": "FG-D0102", "discipline": "仿古", "name": "仿古油饰彩画", "unit": "m²", "labor_qty": 2.6, "material_qty": 2.8, "machine_qty": 0.0, "work_content": "基层处理、地仗、油饰、彩画、罩面", "applicable_scope": "适用于仿古木构件油饰彩画", "chapter": "第4章 仿古油饰修缮", "base_price": 0.0},

    # 光伏
    {"quota_code": "PV-A0101", "discipline": "光伏", "name": "光伏组件安装", "unit": "块", "labor_qty": 0.45, "material_qty": 1.1, "machine_qty": 0.05, "work_content": "组件搬运、定位、固定、接线", "applicable_scope": "适用于屋面、地面光伏组件安装", "chapter": "第1章 光伏组件与支架", "base_price": 0.0},
    {"quota_code": "PV-A0102", "discipline": "光伏", "name": "热镀锌光伏支架安装", "unit": "t", "labor_qty": 7.5, "material_qty": 1.05, "machine_qty": 2.0, "work_content": "支架拼装、吊装、找平、紧固", "applicable_scope": "适用于固定式光伏支架", "chapter": "第1章 光伏组件与支架", "base_price": 0.0},
    {"quota_code": "PV-A0103", "discipline": "光伏", "name": "铝合金导轨及压块安装", "unit": "m", "labor_qty": 0.18, "material_qty": 1.2, "machine_qty": 0.0, "work_content": "导轨定位、压块安装、紧固", "applicable_scope": "适用于屋面光伏导轨系统", "chapter": "第1章 光伏组件与支架", "base_price": 0.0},
    {"quota_code": "PV-A0104", "discipline": "光伏", "name": "屋面光伏压载基础安装", "unit": "块", "labor_qty": 0.25, "material_qty": 1.0, "machine_qty": 0.05, "work_content": "搬运、布置、找平、防水垫处理", "applicable_scope": "适用于不上人屋面压载式光伏", "chapter": "第1章 光伏组件与支架", "base_price": 0.0},
    {"quota_code": "PV-B0101", "discipline": "光伏", "name": "光伏电缆敷设 PV1-F", "unit": "m", "labor_qty": 0.12, "material_qty": 1.05, "machine_qty": 0.0, "work_content": "敷设、绑扎、编号、测试", "applicable_scope": "适用于直流侧光伏专用电缆", "chapter": "第2章 光伏电气设备", "base_price": 0.0},
    {"quota_code": "PV-B0102", "discipline": "光伏", "name": "MC4接头制作安装", "unit": "套", "labor_qty": 0.18, "material_qty": 1.0, "machine_qty": 0.0, "work_content": "剥线、压接、插接、防水检查", "applicable_scope": "适用于光伏组串连接", "chapter": "第2章 光伏电气设备", "base_price": 0.0},
    {"quota_code": "PV-B0103", "discipline": "光伏", "name": "组串式逆变器安装", "unit": "台", "labor_qty": 4.0, "material_qty": 2.0, "machine_qty": 0.3, "work_content": "支架固定、设备安装、接线、调试", "applicable_scope": "适用于组串式逆变器", "chapter": "第2章 光伏电气设备", "base_price": 0.0},
    {"quota_code": "PV-B0104", "discipline": "光伏", "name": "直流汇流箱安装", "unit": "台", "labor_qty": 2.0, "material_qty": 1.5, "machine_qty": 0.1, "work_content": "箱体安装、接线、编号、测试", "applicable_scope": "适用于直流汇流箱", "chapter": "第2章 光伏电气设备", "base_price": 0.0},
    {"quota_code": "PV-B0105", "discipline": "光伏", "name": "交流并网柜安装", "unit": "台", "labor_qty": 6.0, "material_qty": 3.5, "machine_qty": 0.6, "work_content": "柜体就位、母排电缆连接、调试", "applicable_scope": "适用于低压并网柜", "chapter": "第2章 光伏电气设备", "base_price": 0.0},
    {"quota_code": "PV-B0106", "discipline": "光伏", "name": "箱式变压器安装", "unit": "台", "labor_qty": 18.0, "material_qty": 8.0, "machine_qty": 8.0, "work_content": "基础复核、吊装就位、接线、试验", "applicable_scope": "适用于光伏升压箱变", "chapter": "第2章 光伏电气设备", "base_price": 0.0},
    {"quota_code": "PV-C0101", "discipline": "光伏", "name": "光伏防雷接地系统", "unit": "m", "labor_qty": 0.35, "material_qty": 1.0, "machine_qty": 0.05, "work_content": "接地扁钢敷设、焊接、防腐、测试", "applicable_scope": "适用于光伏场区防雷接地", "chapter": "第3章 光伏调试与并网", "base_price": 0.0},
    {"quota_code": "PV-C0102", "discipline": "光伏", "name": "光伏系统调试", "unit": "kWp", "labor_qty": 0.08, "material_qty": 0.05, "machine_qty": 0.02, "work_content": "绝缘测试、组串测试、逆变器调试、并网检查", "applicable_scope": "适用于分布式和集中式光伏系统", "chapter": "第3章 光伏调试与并网", "base_price": 0.0},

    # 水利灌溉 / 古渠
    {"quota_code": "IR-A0101", "discipline": "水利灌溉", "name": "古渠清淤疏浚", "unit": "m³", "labor_qty": 1.2, "material_qty": 0.1, "machine_qty": 1.8, "work_content": "淤泥清挖、装运、边坡修整", "applicable_scope": "适用于古渠、农渠清淤疏浚", "chapter": "第1章 渠道土石方与清淤", "base_price": 0.0},
    {"quota_code": "IR-A0102", "discipline": "水利灌溉", "name": "渠道土方开挖修整", "unit": "m³", "labor_qty": 0.8, "material_qty": 0.0, "machine_qty": 1.5, "work_content": "开挖、修坡、整平、弃土外运", "applicable_scope": "适用于农渠、斗渠、古渠修复", "chapter": "第1章 渠道土石方与清淤", "base_price": 0.0},
    {"quota_code": "IR-B0101", "discipline": "水利灌溉", "name": "浆砌毛石渠墙", "unit": "m³", "labor_qty": 5.8, "material_qty": 4.2, "machine_qty": 0.3, "work_content": "选石、拌浆、砌筑、勾缝、养护", "applicable_scope": "适用于渠道挡墙、渠帮砌筑", "chapter": "第2章 渠道护砌与防渗", "base_price": 0.0},
    {"quota_code": "IR-B0102", "discipline": "水利灌溉", "name": "青石渠底铺砌", "unit": "m²", "labor_qty": 2.2, "material_qty": 3.2, "machine_qty": 0.1, "work_content": "基层处理、青石铺砌、勾缝", "applicable_scope": "适用于古渠渠底、景观水渠", "chapter": "第2章 渠道护砌与防渗", "base_price": 0.0},
    {"quota_code": "IR-B0103", "discipline": "水利灌溉", "name": "预制U型渠槽安装", "unit": "m", "labor_qty": 1.1, "material_qty": 2.6, "machine_qty": 0.6, "work_content": "基槽整平、渠槽吊装、接缝处理", "applicable_scope": "适用于农田灌溉U型渠", "chapter": "第2章 渠道护砌与防渗", "base_price": 0.0},
    {"quota_code": "IR-B0104", "discipline": "水利灌溉", "name": "渠底防渗土工膜铺设", "unit": "m²", "labor_qty": 0.5, "material_qty": 1.3, "machine_qty": 0.0, "work_content": "基层清理、铺膜、搭接焊接、检测", "applicable_scope": "适用于渠道防渗工程", "chapter": "第2章 渠道护砌与防渗", "base_price": 0.0},
    {"quota_code": "IR-B0105", "discipline": "水利灌溉", "name": "生态护坡砌块铺设", "unit": "m²", "labor_qty": 1.4, "material_qty": 2.2, "machine_qty": 0.2, "work_content": "坡面整修、砌块铺设、填缝固坡", "applicable_scope": "适用于灌溉渠生态护坡", "chapter": "第2章 渠道护砌与防渗", "base_price": 0.0},
    {"quota_code": "IR-C0101", "discipline": "水利灌溉", "name": "伸缩缝止水带安装", "unit": "m", "labor_qty": 0.55, "material_qty": 1.1, "machine_qty": 0.0, "work_content": "定位、固定、接头处理、检查", "applicable_scope": "适用于渠道、闸室伸缩缝止水", "chapter": "第3章 渠系建筑物与闸门", "base_price": 0.0},
    {"quota_code": "IR-C0102", "discipline": "水利灌溉", "name": "农渠闸门安装", "unit": "座", "labor_qty": 8.0, "material_qty": 8.5, "machine_qty": 2.0, "work_content": "闸框安装、闸板就位、二次灌浆、调试", "applicable_scope": "适用于农渠、斗渠小型闸门", "chapter": "第3章 渠系建筑物与闸门", "base_price": 0.0},
    {"quota_code": "IR-C0103", "discipline": "水利灌溉", "name": "螺杆启闭机安装", "unit": "台", "labor_qty": 5.0, "material_qty": 3.5, "machine_qty": 0.8, "work_content": "设备就位、连接、调试、试运行", "applicable_scope": "适用于手电两用小型启闭机", "chapter": "第3章 渠系建筑物与闸门", "base_price": 0.0},
    {"quota_code": "IR-C0104", "discipline": "水利灌溉", "name": "量水堰及跌水构筑物", "unit": "座", "labor_qty": 10.0, "material_qty": 12.0, "machine_qty": 2.5, "work_content": "模板、钢筋、混凝土、砌筑、收面", "applicable_scope": "适用于灌溉渠量水、跌水节点", "chapter": "第3章 渠系建筑物与闸门", "base_price": 0.0},
    {"quota_code": "IR-D0101", "discipline": "水利灌溉", "name": "PE灌溉管道铺设", "unit": "m", "labor_qty": 0.65, "material_qty": 1.2, "machine_qty": 0.4, "work_content": "沟槽处理、管道铺设、热熔连接、试压", "applicable_scope": "适用于农田灌溉输配水管道", "chapter": "第4章 灌溉管网", "base_price": 0.0},
    {"quota_code": "IR-D0102", "discipline": "水利灌溉", "name": "灌溉管网阀门井", "unit": "座", "labor_qty": 6.5, "material_qty": 7.5, "machine_qty": 1.0, "work_content": "垫层、砌筑或浇筑、井盖安装", "applicable_scope": "适用于灌溉管网检查井、阀门井", "chapter": "第4章 灌溉管网", "base_price": 0.0},
]

