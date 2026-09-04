"""Sprint 5 integration tests: BOQ CRUD, extended validation, diff explanation, division export.

DB fixtures provided by conftest.py.
"""

from app.models.boq_item import BoqItem
from app.models.line_item_quota_binding import LineItemQuotaBinding
from app.models.material_price import MaterialPrice
from app.models.quota_item import QuotaItem


def _seed_with_division(db, project_id):
    """Seed BOQ + quota + bindings with division labels."""
    boq1 = BoqItem(project_id=project_id, code="010101", name="混凝土浇筑C30",
                   unit="m3", quantity=100, division="土建")
    boq2 = BoqItem(project_id=project_id, code="020101", name="给排水管安装",
                   unit="m", quantity=50, division="安装")
    q1 = QuotaItem(quota_code="D-C30", name="混凝土浇筑C30", unit="m3",
                   labor_qty=2.0, material_qty=5.0, machine_qty=1.0)
    q2 = QuotaItem(quota_code="D-PIPE", name="给排水管安装", unit="m",
                   labor_qty=1.0, material_qty=3.0, machine_qty=0.5)
    db.add_all([boq1, boq2, q1, q2])
    # 注入材料价格数据，避免 _lookup_price 返回 None 导致总价为 0，diff 无法检测变更
    db.add_all([
        MaterialPrice(code="SP5-L", name="人工费", unit="工日", unit_price=100.0),
        MaterialPrice(code="SP5-M", name="材料费", unit="t", unit_price=50.0),
        MaterialPrice(code="SP5-N", name="机械费", unit="台班", unit_price=80.0),
    ])
    db.commit()
    db.refresh(boq1)
    db.refresh(boq2)
    db.refresh(q1)
    db.refresh(q2)
    db.add(LineItemQuotaBinding(boq_item_id=boq1.id, quota_item_id=q1.id))
    db.add(LineItemQuotaBinding(boq_item_id=boq2.id, quota_item_id=q2.id))
    db.commit()
    return boq1, boq2, q1, q2


# ---------------------------------------------------------------------------
# BOQ Item CRUD
# ---------------------------------------------------------------------------

def test_create_boq_item(client):
    r = client.post("/api/projects", json={"name": "CRUD", "region": "bj"})
    pid = r.json()["id"]

    r = client.post(f"/api/projects/{pid}/boq-items", json={
        "code": "NEW01", "name": "新建清单项", "unit": "m2", "quantity": 50,
        "division": "装饰",
    })
    assert r.status_code == 200
    item = r.json()
    assert item["code"] == "NEW01"
    assert item["division"] == "装饰"
    assert item["quantity"] == 50


def test_update_boq_item(client, db):
    r = client.post("/api/projects", json={"name": "Update", "region": "sh"})
    pid = r.json()["id"]

    boq = BoqItem(project_id=pid, code="U01", name="原名", unit="m", quantity=10, is_dirty=0)
    db.add(boq)
    db.commit()
    db.refresh(boq)

    r = client.put(f"/api/projects/{pid}/boq-items/{boq.id}", json={
        "name": "新名", "quantity": 20,
    })
    assert r.status_code == 200
    assert r.json()["name"] == "新名"
    assert r.json()["quantity"] == 20

    # dirty flag should be set
    db.refresh(boq)
    assert boq.is_dirty == 1


def test_update_boq_item_creates_audit_log(client, db):
    r = client.post("/api/projects", json={"name": "UpAudit", "region": "bj"})
    pid = r.json()["id"]

    boq = BoqItem(project_id=pid, code="A01", name="Test", unit="m", quantity=5)
    db.add(boq)
    db.commit()
    db.refresh(boq)

    client.put(f"/api/projects/{pid}/boq-items/{boq.id}", json={"quantity": 99})

    r = client.get(f"/api/projects/{pid}/audit-logs")
    logs = r.json()
    assert any(l["action"] == "update_boq_item" for l in logs)


def test_delete_boq_item(client, db):
    r = client.post("/api/projects", json={"name": "Del", "region": "bj"})
    pid = r.json()["id"]

    boq = BoqItem(project_id=pid, code="D01", name="ToDelete", unit="m", quantity=1)
    db.add(boq)
    db.commit()
    db.refresh(boq)

    r = client.delete(f"/api/projects/{pid}/boq-items/{boq.id}")
    assert r.status_code == 200

    r = client.get(f"/api/projects/{pid}/boq-items")
    assert len(r.json()) == 0

    # Audit log recorded
    r = client.get(f"/api/projects/{pid}/audit-logs")
    assert any(l["action"] == "delete_boq_item" for l in r.json())


def test_delete_boq_item_404(client):
    r = client.post("/api/projects", json={"name": "D404", "region": "bj"})
    pid = r.json()["id"]
    r = client.delete(f"/api/projects/{pid}/boq-items/9999")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Extended Validation Rules
# ---------------------------------------------------------------------------

def test_validation_duplicate_code(client, db):
    """DB 唯一约束 (project_id, code) 已在 section 7 加入，
    重复编码无法写入数据库，校验服务不再需要检测 DB 层面的重复。
    此测试验证约束生效：插入第二条重复编码应失败，校验接口正常返回。"""
    import pytest
    from sqlalchemy.exc import IntegrityError

    r = client.post("/api/projects", json={"name": "DupCode", "region": "bj"})
    pid = r.json()["id"]

    db.add(BoqItem(project_id=pid, code="DUP01", name="A", unit="m", quantity=1))
    db.commit()

    # 第二条重复编码应被 DB 唯一约束拒绝
    db.add(BoqItem(project_id=pid, code="DUP01", name="B", unit="m", quantity=2))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    # 校验接口应正常返回，且不再报告 DUPLICATE_CODE（因为 DB 已阻止重复）
    r = client.get(f"/api/projects/{pid}/validation-issues")
    report = r.json()
    assert all(i["code"] != "DUPLICATE_CODE" for i in report["issues"])


def test_validation_missing_material_price_only_when_bound_quota_needs_it(client, db):
    """Warn only for price buckets that are actually used by bound quotas."""
    r = client.post("/api/projects", json={"name": "NoMP", "region": "sh"})
    pid = r.json()["id"]

    boq = BoqItem(project_id=pid, code="X01", name="Item", unit="m", quantity=1)
    quota = QuotaItem(
        quota_code="MP-REQ",
        name="Item",
        unit="m",
        labor_qty=1,
        material_qty=0,
        machine_qty=2,
    )
    db.add_all([boq, quota])
    db.commit()
    db.refresh(boq)
    db.refresh(quota)
    db.add(LineItemQuotaBinding(boq_item_id=boq.id, quota_item_id=quota.id))
    db.commit()

    r = client.get(f"/api/projects/{pid}/validation-issues")
    report = r.json()
    mp_issues = [i for i in report["issues"] if i["code"] == "MISSING_MATERIAL_PRICE"]
    assert {i["message"].split("[", 1)[1].split("]", 1)[0] for i in mp_issues} == {"人工费", "机械费"}


def test_validation_skips_material_price_for_base_price_quota(client, db):
    r = client.post("/api/projects", json={"name": "BasePriceQuota", "region": "sh"})
    pid = r.json()["id"]

    boq = BoqItem(project_id=pid, code="BP01", name="Item", unit="m3", quantity=1)
    quota = QuotaItem(
        quota_code="BP-1",
        name="Item",
        unit="m³",
        labor_qty=0,
        material_qty=0,
        machine_qty=0,
        base_price=120,
    )
    db.add_all([boq, quota])
    db.commit()
    db.refresh(boq)
    db.refresh(quota)
    db.add(LineItemQuotaBinding(boq_item_id=boq.id, quota_item_id=quota.id))
    db.commit()

    r = client.get(f"/api/projects/{pid}/validation-issues")
    codes = {i["code"] for i in r.json()["issues"]}
    assert "MISSING_MATERIAL_PRICE" not in codes
    assert "ZERO_QUOTA_CONTENT" not in codes
    assert "UNIT_MISMATCH" not in codes


def test_validation_no_rule_package_uses_default_fee_config(client, db):
    r = client.post("/api/projects", json={"name": "NoRP", "region": "demo"})
    pid = r.json()["id"]

    db.add(BoqItem(project_id=pid, code="R01", name="Item", unit="m", quantity=1))
    db.commit()

    r = client.get(f"/api/projects/{pid}/validation-issues")
    report = r.json()
    assert not any(i["code"] == "NO_RULE_PACKAGE" for i in report["issues"])


# ---------------------------------------------------------------------------
# 辅助 Diff Explanation
# ---------------------------------------------------------------------------

def test_diff_has_explanation(client, db):
    r = client.post("/api/projects", json={"name": "DiffExp", "region": "bj"})
    pid = r.json()["id"]
    boq1, boq2, q1, q2 = _seed_with_division(db, pid)

    r1 = client.post(f"/api/projects/{pid}/snapshots", json={"label": "v1"})
    sid1 = r1.json()["id"]

    # Change quantity
    boq1.quantity = 200
    boq1.is_dirty = 1
    db.commit()

    r2 = client.post(f"/api/projects/{pid}/snapshots", json={"label": "v2"})
    sid2 = r2.json()["id"]

    r = client.post(f"/api/projects/{pid}/diff", json={
        "snapshot_a_id": sid1, "snapshot_b_id": sid2,
    })
    diff = r.json()
    assert "explanation" in diff
    assert len(diff["explanation"]) > 0
    assert "变更" in diff["explanation"]
    assert "总价变动" in diff["explanation"]


def test_diff_unchanged_explanation(client, db):
    r = client.post("/api/projects", json={"name": "DiffUn", "region": "sh"})
    pid = r.json()["id"]
    _seed_with_division(db, pid)

    r1 = client.post(f"/api/projects/{pid}/snapshots", json={"label": "a"})
    r2 = client.post(f"/api/projects/{pid}/snapshots", json={"label": "b"})

    r = client.post(f"/api/projects/{pid}/diff", json={
        "snapshot_a_id": r1.json()["id"], "snapshot_b_id": r2.json()["id"],
    })
    diff = r.json()
    assert "未变" in diff["explanation"]


# ---------------------------------------------------------------------------
# Division Summary Export
# ---------------------------------------------------------------------------

def test_export_has_division_sheet(client, db):
    """Valuation report should contain a division summary sheet."""
    r = client.post("/api/projects", json={"name": "DivExp", "region": "bj"})
    pid = r.json()["id"]
    _seed_with_division(db, pid)

    r = client.post(f"/api/exports/valuation-report?project_id={pid}")
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers["content-type"]

    # Verify it's a valid xlsx with division-related sheets
    import io, openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    assert len(wb.sheetnames) >= 2
    assert any("分" in name or "汇总" in name for name in wb.sheetnames)
