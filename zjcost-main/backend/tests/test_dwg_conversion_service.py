from pathlib import Path

from app.services import dwg_conversion_service


def test_bundled_converter_directory_is_preferred(tmp_path, monkeypatch):
    converter = tmp_path / "ODAFileConverter.exe"
    converter.write_bytes(b"placeholder")

    monkeypatch.setenv("ZJCOST_CAD_CONVERTER_DIR", str(tmp_path))
    monkeypatch.setattr(dwg_conversion_service.shutil, "which", lambda _: None)
    monkeypatch.setattr(dwg_conversion_service.glob, "glob", lambda _: [])

    candidates = dwg_conversion_service._find_dxf_to_dwg_candidates()

    assert candidates
    assert Path(candidates[0].path) == converter
    assert candidates[0].source == "bundled"


def test_converter_status_reports_missing_tools(monkeypatch):
    monkeypatch.delenv("ZJCOST_CAD_CONVERTER_DIR", raising=False)
    monkeypatch.delenv("DXF_CONVERTER_PATH", raising=False)
    monkeypatch.delenv("DWG_CONVERTER_PATH", raising=False)
    monkeypatch.delenv("ODA_FILE_CONVERTER", raising=False)
    monkeypatch.delenv("LIBREDWG_DXF2DWG", raising=False)
    monkeypatch.delenv("LIBREDWG_DWG2DXF", raising=False)
    monkeypatch.setattr(dwg_conversion_service, "_BUNDLED_CONVERTER_DIRS", ())
    monkeypatch.setattr(dwg_conversion_service.shutil, "which", lambda _: None)
    monkeypatch.setattr(dwg_conversion_service.glob, "glob", lambda _: [])

    status = dwg_conversion_service.get_converter_status()

    assert status["dxf_to_dwg"] is False
    assert status["dwg_to_dxf"] is False
    assert "backend/tools/cad-converters" in status["instructions"]
