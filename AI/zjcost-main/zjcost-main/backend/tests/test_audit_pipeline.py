from app.models.boq_item import BoqItem
from app.models.calc_result import CalcResult
from app.models.line_item_quota_binding import LineItemQuotaBinding
from app.models.project import Project
from app.models.quota_item import QuotaItem


class _OfflineProvider:
    def is_enabled(self) -> bool:
        return False

    def is_configured(self) -> bool:
        return False


def test_audit_pipeline_uses_local_fallback_when_zh_is_offline(client, db, monkeypatch):
    monkeypatch.setattr(
        "app.assistant.framework.base_handler.get_zh_provider",
        lambda: _OfflineProvider(),
    )

    project = Project(name="审计测试项目", region="默认区域", budget=10000)
    db.add(project)
    db.flush()

    quota = QuotaItem(
        quota_code="TJ-001",
        name="混凝土基础",
        unit="m3",
        discipline="土建",
        base_price=100,
        has_resource_details=0,
    )
    boq = BoqItem(
        project_id=project.id,
        code="010401001",
        name="基础混凝土",
        unit="m3",
        quantity=10,
        division="土建工程",
        is_dirty=0,
    )
    db.add_all([quota, boq])
    db.flush()
    db.add(LineItemQuotaBinding(boq_item_id=boq.id, quota_item_id=quota.id))
    db.add(CalcResult(boq_item_id=boq.id, total_cost=1000))
    db.commit()

    response = client.post(f"/api/projects/{project.id}/pipeline/audit")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert [stage["handler"] for stage in payload["stages"]] == [
        "local_binding_audit",
        "local_cost_audit",
        "local_validation_audit",
    ]
    assert "本地审计完成" in payload["final_answer"]

    logs = client.get(f"/api/projects/{project.id}/audit-logs").json()
    assert logs[0]["action"] == "audit.pipeline.local_completed"
    assert logs[0]["actor"] == "audit_pipeline"
