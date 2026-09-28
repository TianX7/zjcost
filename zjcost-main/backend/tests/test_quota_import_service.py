import io

import openpyxl

from app.models.quota_item import QuotaItem
from app.models.quota_resource_detail import QuotaResourceDetail
from app.services.quota_import_service import (
    parse_and_import_quota,
    parse_and_import_resource_details,
)


def _xlsx_bytes(headers: list[str], rows: list[list[object]]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_quota_import_upserts_existing_codes(db):
    first = _xlsx_bytes(
        ["定额号", "名称", "单位", "人工", "材料", "机械", "章节"],
        [["Q-001", "混凝土浇筑", "m3", 1, 2, 3, "混凝土工程"]],
    )
    second = _xlsx_bytes(
        ["定额号", "名称", "单位", "人工", "材料", "机械", "章节"],
        [["Q-001", "混凝土浇筑更新", "m3", 4, 5, 6, "混凝土工程"]],
    )

    created = parse_and_import_quota(first, db)
    updated = parse_and_import_quota(second, db)

    assert created.created == 1
    assert created.updated == 0
    assert updated.created == 0
    assert updated.updated == 1

    rows = db.query(QuotaItem).filter(QuotaItem.quota_code == "Q-001").all()
    assert len(rows) == 1
    assert rows[0].name == "混凝土浇筑更新"
    assert rows[0].labor_qty == 4


def test_resource_detail_import_replaces_existing_details(db):
    quota = QuotaItem(
        quota_code="Q-RES",
        name="资源定额",
        unit="m",
        labor_qty=1,
        material_qty=1,
        machine_qty=1,
    )
    db.add(quota)
    db.commit()

    first = _xlsx_bytes(
        ["定额号", "类别", "资源名称", "单位", "消耗量", "单价"],
        [
            ["Q-RES", "人工", "人工一类", "工日", 1.2, 100],
            ["Q-RES", "材料", "材料一类", "kg", 3.4, 5],
        ],
    )
    second = _xlsx_bytes(
        ["定额号", "类别", "资源名称", "单位", "消耗量", "单价"],
        [["Q-RES", "人工", "人工更新", "工日", 2.5, 120]],
    )

    initial = parse_and_import_resource_details(first, db)
    repeated = parse_and_import_resource_details(second, db)

    assert initial.imported == 2
    assert repeated.imported == 1
    assert repeated.replaced == 2

    details = db.query(QuotaResourceDetail).filter(
        QuotaResourceDetail.quota_item_id == quota.id,
    ).all()
    assert len(details) == 1
    assert details[0].resource_name == "人工更新"
