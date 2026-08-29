from pathlib import Path

import ezdxf

from app.services.dxf_analysis_service import analyze_dxf_bytes, sanitize_preview_svg
from app.services.dwg_conversion_service import convert_dxf_to_dwg_bytes


def _save_doc_bytes(doc, path):
    doc.saveas(path)
    return path.read_bytes()


def _sample_building_dxf_bytes(tmp_path):
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    msp.add_lwpolyline(
        [(0, 0), (600, 0), (600, 600), (0, 600)],
        close=True,
        dxfattribs={"layer": "砼柱"},
    )
    msp.add_line((1000, 0), (5000, 0), dxfattribs={"layer": "梁"})
    msp.add_lwpolyline(
        [(0, 1000), (4000, 1000), (4000, 3000), (0, 3000)],
        close=True,
        dxfattribs={"layer": "楼板"},
    )
    msp.add_lwpolyline(
        [(5000, 1000), (5600, 1000), (5600, 1800), (5000, 1800)],
        close=True,
        dxfattribs={"layer": "窗"},
    )
    msp.add_text("KZ1 600x600", dxfattribs={"layer": "TEXT", "insert": (0, 800)})
    msp.add_text("KL1 300x600", dxfattribs={"layer": "TEXT", "insert": (1000, 300)})
    msp.add_text("板厚120", dxfattribs={"layer": "TEXT", "insert": (0, 3300)})
    return _save_doc_bytes(doc, tmp_path / "sample-building.dxf")


def test_sanitize_preview_svg_removes_active_content():
    raw = '<svg><script>alert(1)</script><foreignObject>x</foreignObject><a href="javascript:alert(1)" onclick="x()"><path onload="x()" /></a><use href="https://example.com/x" /></svg>'

    sanitized = sanitize_preview_svg(raw)

    assert "script" not in sanitized.lower()
    assert "foreignobject" not in sanitized.lower()
    assert "javascript:" not in sanitized.lower()
    assert "onclick" not in sanitized.lower()
    assert "onload" not in sanitized.lower()
    assert "https://example.com" not in sanitized


def test_analyze_sample_dxf_extracts_common_components(tmp_path):
    progress_events = []
    result = analyze_dxf_bytes(
        _sample_building_dxf_bytes(tmp_path),
        "sample-building.dxf",
        progress_callback=progress_events.append,
    )

    assert result["error"] is None
    assert result["preview_svg"].startswith("<svg")
    assert "rgba(" not in result["preview_svg"]
    assert "dr-recognition-highlight" in result["preview_svg"]
    assert result["preview_svg"].count("dr-recognition-highlight") >= 4
    assert 'data-recognition-index="1"' in result["preview_svg"]
    assert 'data-component-type="column"' in result["preview_svg"]
    assert any(event.get("preview_svg", "").startswith("<svg") for event in progress_events)
    assert any("正在标记构件" in event.get("progress", "") for event in progress_events)
    assert any("毫米" in item for item in result["diagnostics"])

    components_by_type = {item["type"]: item for item in result["components"]}
    assert "框架柱" in components_by_type
    assert "框架梁" in components_by_type
    assert "楼板" in components_by_type
    assert "窗" in components_by_type

    column = components_by_type["框架柱"]
    assert column["quantity_estimate"] > 0
    assert column["quantity_estimate"] < 1000
    assert "砼柱" in column["layers"]


def test_analyze_dwg_extension_with_dxf_content_parses_without_cloud_conversion(tmp_path):
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    msp.add_line((0, 0), (3000, 0), dxfattribs={"layer": "梁"})

    result = analyze_dxf_bytes(_save_doc_bytes(doc, tmp_path / "dwg-extension-content.dxf"), "sample.dwg")

    assert result["error"] is None
    assert result["drawing_type"] == "CAD 图纸（DWG 已转 DXF）"
    assert result["components"]
    assert any("内容已经是 DXF" in item for item in result["diagnostics"])


def test_analyze_real_dwg_import_converts_to_dxf_first(tmp_path):
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    msp.add_line((0, 0), (3000, 0), dxfattribs={"layer": "梁"})
    dxf_path = tmp_path / "direct-import.dxf"
    doc.saveas(dxf_path)

    converted = convert_dxf_to_dwg_bytes(dxf_path.read_bytes(), dxf_path.name)
    assert converted.error is None
    assert converted.dwg_bytes

    result = analyze_dxf_bytes(converted.dwg_bytes, "direct-import.dwg")

    assert result["error"] is None
    assert result["drawing_type"] == "CAD 图纸（DWG 已转 DXF）"
    assert result["preview_svg"].startswith("<svg")
    assert any("DWG 已通过内置转换器转换为 DXF" in item for item in result["diagnostics"])


def test_analyze_text_annotations_rank_repeated_beam_specs(tmp_path):
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    msp.add_line((0, 0), (10000, 0), dxfattribs={"layer": "BEAM"})
    msp.add_text("KL1 250x500", dxfattribs={"layer": "TEXT", "insert": (0, 500)})
    msp.add_text("KL2 250x500", dxfattribs={"layer": "TEXT", "insert": (2000, 500)})
    msp.add_text("KL3 300x600", dxfattribs={"layer": "TEXT", "insert": (4000, 500)})

    dxf_path = tmp_path / "beam-specs.dxf"
    result = analyze_dxf_bytes(_save_doc_bytes(doc, dxf_path), dxf_path.name)

    assert result["error"] is None
    beam = next(item for item in result["components"] if item["type"] == "框架梁")
    assert beam["spec"] == "250×500"
    assert abs(beam["quantity_estimate"] - 1.25) < 0.01


def test_analyze_column_uses_annotated_story_height(tmp_path):
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    msp.add_lwpolyline(
        [(0, 0), (600, 0), (600, 600), (0, 600)],
        close=True,
        dxfattribs={"layer": "COLUMN"},
    )
    msp.add_text("KZ1 600x600", dxfattribs={"layer": "TEXT", "insert": (0, 800)})
    msp.add_text("CH=3600", dxfattribs={"layer": "TEXT", "insert": (0, 1200)})

    dxf_path = tmp_path / "column-story-height.dxf"
    result = analyze_dxf_bytes(_save_doc_bytes(doc, dxf_path), dxf_path.name)

    assert result["error"] is None
    column = next(item for item in result["components"] if item["type"] == "框架柱")
    assert column["spec"] == "600×600"
    assert abs(column["quantity_estimate"] - 1.296) < 0.01
    assert any("层高 3.60m" in item for item in result["diagnostics"])


def test_analyze_wall_uses_direct_thickness_and_story_height_annotations(tmp_path):
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    msp.add_line((0, 0), (10000, 0), dxfattribs={"layer": "WALL"})
    msp.add_text("T=200", dxfattribs={"layer": "TEXT", "insert": (0, 500)})
    msp.add_text("CH=3000", dxfattribs={"layer": "TEXT", "insert": (0, 1000)})

    dxf_path = tmp_path / "wall-thickness-story-height.dxf"
    result = analyze_dxf_bytes(_save_doc_bytes(doc, dxf_path), dxf_path.name)

    assert result["error"] is None
    wall = next(item for item in result["components"] if item["type"] == "剪力墙")
    assert wall["spec"] == "T=200"
    assert abs(wall["quantity_estimate"] - 6.0) < 0.01


def test_analyze_installation_disciplines_from_dxf_layers_and_annotations(tmp_path):
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    msp.add_line((0, 0), (12000, 0), dxfattribs={"layer": "给水管道"})
    msp.add_text("给水 DN50", dxfattribs={"layer": "TEXT", "insert": (0, 300)})
    msp.add_line((0, 1000), (8000, 1000), dxfattribs={"layer": "电气配管"})
    msp.add_text("SC20", dxfattribs={"layer": "TEXT", "insert": (0, 1300)})
    msp.add_line((0, 2000), (10000, 2000), dxfattribs={"layer": "风管"})
    msp.add_text("风管 500x320", dxfattribs={"layer": "TEXT", "insert": (0, 2300)})
    msp.add_circle((1000, 3000), 100, dxfattribs={"layer": "烟感"})
    msp.add_circle((2000, 3000), 100, dxfattribs={"layer": "烟感"})

    dxf_path = tmp_path / "installation.dxf"
    result = analyze_dxf_bytes(_save_doc_bytes(doc, dxf_path), dxf_path.name)

    assert result["error"] is None
    components_by_type = {item["type"]: item for item in result["components"]}
    assert "给排水管道" in components_by_type
    assert "电气配管" in components_by_type
    assert "通风风管" in components_by_type
    assert "消防设备器具" in components_by_type
    assert abs(components_by_type["给排水管道"]["quantity_estimate"] - 12.0) < 0.01
    assert abs(components_by_type["电气配管"]["quantity_estimate"] - 8.0) < 0.01
    assert abs(components_by_type["通风风管"]["quantity_estimate"] - 5.0) < 0.01
    assert components_by_type["消防设备器具"]["quantity_estimate"] == 2
    suggestion_names = {item["suggested_name"] for item in result["boq_suggestions"]}
    assert any("给排水管道安装" in name for name in suggestion_names)
    assert any("电气配管" in name for name in suggestion_names)
    assert any("通风风管制作安装" in name for name in suggestion_names)
