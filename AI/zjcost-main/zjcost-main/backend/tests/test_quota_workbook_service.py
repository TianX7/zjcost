import io

import openpyxl

from app.models.quota_item import QuotaItem
from app.services.quota_workbook_service import (
    inspect_quota_workbook,
    parse_and_import_quota_with_sheets,
)


def _workbook_bytes() -> bytes:
    wb = openpyxl.Workbook()
    ws1 = wb.active
    ws1.title = "土建"
    ws1.append(["定额编号", "定额名称", "单位", "人工费", "材料费", "机械费", "章节"])
    ws1.append(["1-1", "人工挖土方", "m3", 1, 2, 3, "第1章 土石方工程"])

    ws2 = wb.create_sheet("电气")
    ws2.append(["定额编号", "定额名称", "单位", "人工费", "材料费", "机械费"])
    ws2.append(["借4-1-1", "变压器安装", "台", 4, 5, 6])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_inspect_quota_workbook_lists_sheets():
    sheets = inspect_quota_workbook(_workbook_bytes())

    assert len(sheets) == 2
    assert sheets[0]["name"] == "土建"
    assert sheets[0]["importable"] is True
    assert sheets[0]["inferred_discipline"] == "土建"
    assert sheets[1]["name"] == "电气"
    assert sheets[1]["inferred_discipline"] == "电气"


def test_quota_import_can_target_selected_sheet(db):
    result = parse_and_import_quota_with_sheets(
        _workbook_bytes(),
        db,
        discipline="AUTO",
        sheet_names=["电气"],
    )

    assert result.created == 1
    assert result.updated == 0
    rows = db.query(QuotaItem).all()
    assert len(rows) == 1
    assert rows[0].quota_code == "借4-1-1"
    assert rows[0].discipline == "电气"
    assert rows[0].name == "变压器安装"
    assert rows[0].chapter == "第四册 电气设备安装工程"


def test_quota_import_auto_classifies_each_sheet(db):
    result = parse_and_import_quota_with_sheets(_workbook_bytes(), db, discipline="AUTO")

    assert result.created == 2
    rows = {
        (row.discipline, row.quota_code): row
        for row in db.query(QuotaItem).all()
    }
    assert ("土建", "1-1") in rows
    assert ("电气", "借4-1-1") in rows
