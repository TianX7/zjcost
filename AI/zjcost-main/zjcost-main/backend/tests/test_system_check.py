from app.models.material_price import MaterialPrice
from app.models.quota_item import QuotaItem


def test_system_check_reports_core_capabilities(client, db):
    db.add_all([
        QuotaItem(
            quota_code=f"Q-{idx}",
            name=f"Quota {idx}",
            unit="m3",
            discipline="土建",
            base_price=100,
            has_resource_details=0,
        )
        for idx in range(1000)
    ])
    db.add(MaterialPrice(code="M-1", name="Concrete", unit="m3", unit_price=450))
    db.commit()

    response = client.get("/api/system-check")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] in {"ok", "warning", "error"}
    assert payload["counts"]["quota_items"] == 1000
    assert payload["counts"]["material_prices"] == 1
    keys = {item["key"] for item in payload["checks"]}
    assert {"database", "quota_library", "material_prices", "ifc_parser", "cad_converter", "zh_provider"} <= keys
