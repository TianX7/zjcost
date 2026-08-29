from app.models.boq_item import BoqItem
from app.models.calc_result import CalcResult
from app.models.line_item_quota_binding import LineItemQuotaBinding
from app.models.project import Project
from app.models.quota_item import QuotaItem
from app.api.routes.reports import get_report
from app.services.drawing_valuation_service import (
    binding_coefficient_for_units,
    create_valuation_from_drawing,
    match_quota_for_boq,
)
from app.services.project_calc_service import run_project_calculation

from app.services.pricing_engine import DEFAULT_FEE_CONFIG, _r2


def expected_total_with_fees(base_total: float) -> float:
    fee = DEFAULT_FEE_CONFIG
    base_total = _r2(base_total)
    pretax = _r2(base_total + _r2(base_total * fee.management_rate)
                 + _r2(base_total * fee.profit_rate) + _r2(base_total * fee.regulatory_rate))
    return _r2(pretax + _r2(pretax * fee.tax_rate))


def test_create_valuation_from_drawing_creates_project_items_and_price(db):
    quota = QuotaItem(
        quota_code="010401001",
        name="现浇混凝土基础",
        unit="m³",
        labor_qty=0.0,
        material_qty=0.0,
        machine_qty=0.0,
        work_content="基础施工",
        applicable_scope="基础构件",
        chapter="土建",
        version="test",
        base_price=100.0,
        has_resource_details=0,
    )
    db.add(quota)
    db.commit()

    result = create_valuation_from_drawing(
        db=db,
        task_id="task-001",
        boq_suggestions=[
            {
                "source_component_id": "F-1",
                "suggested_code": "010401001",
                "suggested_name": "现浇混凝土基础 C30",
                "suggested_unit": "m³",
                "suggested_quantity": 12.5,
                "characteristics": "基础构件",
                "confidence": 94,
                "material": "C30混凝土",
                "component_count": 1,
            }
        ],
    )

    assert result["project_id"] is not None
    assert result["boq_items_created"] == 1
    assert result["matched"] == 1
    assert result["skipped"] == 0
    assert result["grand_total"] == expected_total_with_fees(1250)
    assert result["total_direct"] == 1250
    assert result["error"] is None

    project = db.query(Project).filter(Project.id == result["project_id"]).first()
    assert project is not None
    assert project.name.startswith("图纸自动套定额-")
    assert project.region == "默认区域"

    boq = db.query(BoqItem).filter(BoqItem.project_id == project.id).first()
    assert boq is not None
    assert boq.quantity == 12.5

    binding = db.query(LineItemQuotaBinding).filter(LineItemQuotaBinding.boq_item_id == boq.id).first()
    assert binding is not None

    assert result["items"][0]["status"] == "matched"
    assert result["items"][0]["quota_code"] == quota.quota_code


def test_create_valuation_from_ifc_uses_distinct_project_name(db):
    quota = QuotaItem(
        quota_code="030801001",
        name="管道安装",
        unit="m",
        base_price=10.0,
        has_resource_details=0,
    )
    db.add(quota)
    db.commit()

    result = create_valuation_from_drawing(
        db=db,
        task_id="task-ifc",
        source_type="ifc",
        boq_suggestions=[
            {
                "source_component_id": "Pipe-1",
                "suggested_code": "030801001",
                "suggested_name": "管道安装",
                "suggested_unit": "m",
                "suggested_quantity": 5,
            }
        ],
    )

    project = db.query(Project).filter(Project.id == result["project_id"]).first()
    assert project is not None
    assert project.name.startswith("IFC自动套定额-")
    assert project.description == "由IFC模型自动套定额生成。"


def test_create_valuation_scales_quota_price_units(db):
    quota = QuotaItem(
        quota_code="030801001",
        name="管道安装",
        unit="100m",
        base_price=1000.0,
        has_resource_details=0,
    )
    db.add(quota)
    db.commit()

    result = create_valuation_from_drawing(
        db=db,
        task_id="task-scale",
        boq_suggestions=[
            {
                "source_component_id": "Pipe-1",
                "suggested_code": "030801001",
                "suggested_name": "管道安装",
                "suggested_unit": "m",
                "suggested_quantity": 300,
            }
        ],
    )

    assert result["matched"] == 1
    assert result["grand_total"] == expected_total_with_fees(3000)

    binding = db.query(LineItemQuotaBinding).first()
    assert binding is not None
    assert binding.coefficient == 0.01


def test_create_valuation_marks_extreme_total_as_review_error(db):
    quota = QuotaItem(
        quota_code="010101001",
        name="大型土建工程",
        unit="项",
        discipline="土建",
        base_price=120_000_000.0,
        has_resource_details=0,
    )
    db.add(quota)
    db.commit()

    result = create_valuation_from_drawing(
        db=db,
        task_id="task-extreme-total",
        boq_suggestions=[
            {
                "source_component_id": "A-1",
                "suggested_code": "010101001",
                "suggested_name": "大型土建工程",
                "suggested_unit": "项",
                "suggested_quantity": 1,
            }
        ],
    )

    assert result["grand_total"] >= 100_000_000
    assert result["review_summary"]["errors"] >= 1
    assert any(item["category"] == "total_outlier" for item in result["review_items"])
    assert result["error"] == "自动计价存在高风险复核项，暂不能直接作为最终造价。"


def test_project_calculation_prefers_base_price_for_imported_aggregate_quota(db):
    project = Project(
        name="Imported aggregate quota project",
        region="Default",
        project_type="building",
        status="draft",
        standard_type="GB50500",
        language="zh",
        currency="CNY",
    )
    quota = QuotaItem(
        quota_code="5-31",
        name="C20现浇混凝土 直形墙 混凝土",
        unit="m3",
        discipline="土建",
        labor_qty=55.0,
        material_qty=480.0,
        machine_qty=34.0,
        base_price=569.38,
        has_resource_details=0,
    )
    db.add_all([project, quota])
    db.flush()

    boq = BoqItem(
        project_id=project.id,
        code="010404001",
        name="现浇混凝土墙",
        unit="m³",
        quantity=858.805,
    )
    db.add(boq)
    db.flush()
    db.add(LineItemQuotaBinding(boq_item_id=boq.id, quota_item_id=quota.id))
    db.commit()

    summary, line_results = run_project_calculation(project.id, db)

    expected = expected_total_with_fees(round(858.805 * 569.38, 2))
    assert len(line_results) == 1
    assert summary.grand_total == expected
    assert summary.grand_total < 1_000_000


def test_project_calculation_uses_quota_base_price_when_quantities_are_empty(db):
    project = Project(
        name="Base price project",
        region="Default",
        project_type="building",
        status="draft",
        standard_type="GB50500",
        language="zh",
        currency="CNY",
    )
    quota = QuotaItem(
        quota_code="BP-001",
        name="Base price quota",
        unit="m3",
        labor_qty=0.0,
        material_qty=0.0,
        machine_qty=0.0,
        base_price=100.0,
        has_resource_details=0,
    )
    db.add_all([project, quota])
    db.flush()

    boq = BoqItem(
        project_id=project.id,
        code="010401001",
        name="Concrete",
        unit="m3",
        quantity=12.5,
    )
    db.add(boq)
    db.flush()
    db.add(LineItemQuotaBinding(boq_item_id=boq.id, quota_item_id=quota.id))
    db.commit()

    summary, line_results = run_project_calculation(project.id, db)

    assert len(line_results) == 1
    assert summary.total_direct == 1250
    assert summary.grand_total == expected_total_with_fees(1250)


def test_project_calculation_clears_stale_unbound_cached_result(db):
    project = Project(
        name="Stale cache project",
        region="Default",
        project_type="building",
        status="draft",
        standard_type="GB50500",
        language="zh",
        currency="CNY",
    )
    quota = QuotaItem(
        quota_code="5-31",
        name="C20现浇混凝土 直形墙",
        unit="m3",
        base_price=100.0,
        has_resource_details=0,
    )
    db.add_all([project, quota])
    db.flush()

    bound = BoqItem(
        project_id=project.id,
        code="010404001",
        name="现浇混凝土墙",
        unit="m3",
        quantity=10,
    )
    stale_unbound = BoqItem(
        project_id=project.id,
        code="010404002",  # 使用不同编码以符合 DB 唯一约束 (project_id, code)
        name="旧缓存未绑定墙",
        unit="m3",
        quantity=10,
    )
    db.add_all([bound, stale_unbound])
    db.flush()
    db.add(LineItemQuotaBinding(boq_item_id=bound.id, quota_item_id=quota.id))
    db.add(CalcResult(boq_item_id=stale_unbound.id, total_cost=99_999_999.0))
    db.commit()

    summary, line_results = run_project_calculation(project.id, db)

    assert len(line_results) == 1
    assert summary.grand_total == expected_total_with_fees(1000)
    assert db.query(CalcResult).filter(CalcResult.boq_item_id == stale_unbound.id).first() is None


def test_drawing_quota_matching_keeps_building_boq_out_of_installation_quota():
    quotas = [
        QuotaItem(id=1, quota_code="4-1", name="M10干混砌筑砂浆 实心砖基础", unit="m3", discipline="土建", base_price=571.61),
        QuotaItem(id=2, quota_code="10-55", name="管道安装 墙体开槽", unit="m", discipline="给排水", base_price=9999.0),
    ]
    boq = BoqItem(project_id=1, code="010301001", name="砖基础砌筑", unit="m³", quantity=35)

    quota, confidence = match_quota_for_boq(boq, quotas)

    assert quota is not None
    assert quota.quota_code == "4-1"
    assert confidence >= 0.3


def test_drawing_valuation_filters_installation_noise_from_building_drawing(db):
    quotas = [
        QuotaItem(quota_code="5-14", name="C20现浇混凝土 矩形柱", unit="m3", discipline="土建", base_price=628.44, has_resource_details=0),
        QuotaItem(quota_code="5-22", name="C20现浇混凝土 矩形梁", unit="m3", discipline="土建", base_price=545.06, has_resource_details=0),
        QuotaItem(quota_code="5-31", name="C20现浇混凝土 直形墙", unit="m3", discipline="土建", base_price=569.38, has_resource_details=0),
        QuotaItem(quota_code="10-55", name="给排水管道安装", unit="m", discipline="给排水", base_price=88.0, has_resource_details=0),
    ]
    db.add_all(quotas)
    db.commit()

    result = create_valuation_from_drawing(
        db=db,
        task_id="task-building-filter",
        boq_suggestions=[
            {"source_component_id": "C-1", "suggested_code": "010402001", "suggested_name": "现浇混凝土柱", "suggested_unit": "m³", "suggested_quantity": 10},
            {"source_component_id": "B-1", "suggested_code": "010403001", "suggested_name": "现浇混凝土梁", "suggested_unit": "m³", "suggested_quantity": 10},
            {"source_component_id": "W-1", "suggested_code": "010404001", "suggested_name": "现浇混凝土墙", "suggested_unit": "m³", "suggested_quantity": 10},
            {"source_component_id": "P-1", "suggested_code": "031001001", "suggested_name": "给排水管道安装", "suggested_unit": "m", "suggested_quantity": 1000},
        ],
    )

    assert result["boq_items_created"] == 3
    assert all("管道" not in item["name"] for item in result["items"])


def test_report_uses_quota_base_price_when_quantities_are_empty(db):
    project = Project(
        name="Report base price project",
        region="Default",
        project_type="building",
        status="draft",
        standard_type="GB50500",
        language="zh",
        currency="CNY",
    )
    quota = QuotaItem(
        quota_code="BP-002",
        name="Report quota",
        unit="m3",
        labor_qty=0.0,
        material_qty=0.0,
        machine_qty=0.0,
        base_price=88.0,
        has_resource_details=0,
    )
    db.add_all([project, quota])
    db.flush()

    boq = BoqItem(
        project_id=project.id,
        code="010401002",
        name="Report concrete",
        unit="m3",
        quantity=10,
    )
    db.add(boq)
    db.flush()
    db.add(LineItemQuotaBinding(boq_item_id=boq.id, quota_item_id=quota.id))
    db.commit()

    report = get_report(project_id=project.id, division=None, search=None, db=db)

    assert report.cost_summary.grand_total == expected_total_with_fees(880)
    assert report.line_items[0].total_cost == expected_total_with_fees(880)


def test_ifc_quota_matching_prefers_semantic_chapter_over_generic_words():
    quotas = [
        QuotaItem(id=1, quota_code="9-115", name="金属防水板", unit="m2", base_price=37.7),
        QuotaItem(id=2, quota_code="8-54", name="铝合金窗安装 推拉", unit="m2", base_price=334.14),
        QuotaItem(id=3, quota_code="5-40", name="C20现浇混凝土 有梁板", unit="m3", base_price=395.98),
        QuotaItem(id=4, quota_code="5-22", name="C20现浇混凝土 矩形梁", unit="m3", base_price=545.06),
    ]

    window = BoqItem(project_id=1, code="010803001", name="金属窗", unit="m²", quantity=10)
    beam = BoqItem(project_id=1, code="010403001", name="现浇混凝土梁", unit="m³", quantity=8)

    window_quota, window_confidence = match_quota_for_boq(window, quotas)
    beam_quota, beam_confidence = match_quota_for_boq(beam, quotas)

    assert window_quota is not None
    assert window_quota.quota_code == "8-54"
    assert window_confidence >= 0.3
    assert beam_quota is not None
    assert beam_quota.quota_code == "5-22"
    assert beam_confidence >= 0.3


def test_ifc_quota_matching_converts_ten_meter_quota_units():
    assert binding_coefficient_for_units("m", "10m") == 0.1
    assert binding_coefficient_for_units("m²", "10m2") == 0.1
    assert binding_coefficient_for_units("m", "100m") == 0.01
    assert binding_coefficient_for_units("个", "10个") == 0.1
    assert binding_coefficient_for_units("kg", "100kg") == 0.01
    assert binding_coefficient_for_units("m", "km") == 0.001
    assert binding_coefficient_for_units("m³", "m3") == 1.0
