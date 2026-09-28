from collections import Counter

from app.services.ifc_parse_service import (
    IFC_PREVIEW_MESH_PER_CLASS,
    _select_preview_elements,
    _should_extract_preview_mesh,
)


def _element(ifc_class: str, index: int, mesh: bool = False) -> dict:
    return {
        "id": f"{ifc_class}-{index}",
        "type": ifc_class,
        "label": ifc_class,
        "name": f"{ifc_class}-{index}",
        "mesh_kind": "mesh" if mesh else "box",
    }


def test_ifc_preview_selection_keeps_major_structure_types_visible():
    elements_by_class = {
        "IfcColumn": [_element("IfcColumn", i, mesh=i < 10) for i in range(500)],
        "IfcBeam": [_element("IfcBeam", i, mesh=i < 3) for i in range(20)],
        "IfcWall": [_element("IfcWall", i, mesh=i < 3) for i in range(20)],
        "IfcSlab": [_element("IfcSlab", i, mesh=i < 3) for i in range(20)],
    }

    preview = _select_preview_elements(elements_by_class, 80)
    counts = Counter(item["type"] for item in preview)

    assert len(preview) == 80
    assert counts["IfcColumn"] < 80
    assert counts["IfcBeam"] > 0
    assert counts["IfcWall"] > 0
    assert counts["IfcSlab"] > 0


def test_ifc_preview_selection_returns_all_elements_when_under_limit():
    elements_by_class = {
        "IfcColumn": [_element("IfcColumn", i) for i in range(3)],
        "IfcBeam": [_element("IfcBeam", i) for i in range(2)],
        "IfcBuildingElementProxy": [_element("IfcBuildingElementProxy", i) for i in range(4)],
    }

    preview = _select_preview_elements(elements_by_class, 20)
    counts = Counter(item["type"] for item in preview)

    assert len(preview) == 9
    assert counts["IfcColumn"] == 3
    assert counts["IfcBeam"] == 2
    assert counts["IfcBuildingElementProxy"] == 4


def test_ifc_preview_selection_includes_unknown_physical_classes_when_limited():
    elements_by_class = {
        "IfcColumn": [_element("IfcColumn", i) for i in range(5)],
        "IfcBuildingElementProxy": [_element("IfcBuildingElementProxy", i) for i in range(5)],
    }

    preview = _select_preview_elements(elements_by_class, 6)
    counts = Counter(item["type"] for item in preview)

    assert len(preview) == 6
    assert counts["IfcColumn"] > 0
    assert counts["IfcBuildingElementProxy"] > 0


def test_ifc_preview_mesh_budget_is_per_class():
    attempts_by_class = {"IfcColumn": IFC_PREVIEW_MESH_PER_CLASS}

    assert not _should_extract_preview_mesh("IfcColumn", 10, attempts_by_class)
    assert _should_extract_preview_mesh("IfcBeam", 10, attempts_by_class)
