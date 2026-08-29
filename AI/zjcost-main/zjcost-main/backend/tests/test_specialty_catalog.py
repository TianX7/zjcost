from app.data.specialty_catalog import SPECIALTY_DISCIPLINES
from app.services.price_fetch_service import get_reference_prices
from app.services.quota_import_service import VALID_DISCIPLINES
from app.services.quota_workbook_service import infer_discipline


def test_specialty_disciplines_are_valid():
    assert set(SPECIALTY_DISCIPLINES).issubset(VALID_DISCIPLINES)


def test_specialty_discipline_inference():
    assert infer_discipline("仿古建筑", quota_name="仿古青瓦屋面铺设") == "仿古"
    assert infer_discipline("光伏", quota_name="组串式逆变器安装") == "光伏"
    assert infer_discipline("古渠灌溉", quota_name="农渠闸门安装") == "水利灌溉"


def test_specialty_reference_prices_are_searchable():
    pv = get_reference_prices(query="光伏组件")
    irrigation = get_reference_prices(query="青石渠板")

    assert any(item.code.startswith("PV-") for item in pv)
    assert any(item.code.startswith("IR-") for item in irrigation)

