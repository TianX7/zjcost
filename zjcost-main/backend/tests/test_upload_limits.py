from io import BytesIO
import time

import ezdxf


def _electrical_dxf_bytes(tmp_path):
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    msp.add_line((0, 0), (12000, 0), dxfattribs={"layer": "ELEC_CONDUIT"})
    msp.add_line((0, 1000), (8000, 1000), dxfattribs={"layer": "CABLETRAY"})
    msp.add_circle((1000, 2000), 100, dxfattribs={"layer": "DB"})
    msp.add_text("SC20", dxfattribs={"layer": "TEXT", "insert": (0, 300)})
    msp.add_text("TRAY 200x100", dxfattribs={"layer": "TEXT", "insert": (0, 1300)})
    path = tmp_path / "electrical-http.dxf"
    doc.saveas(path)
    return path.read_bytes()


def test_drawing_upload_rejects_oversized_file(client, monkeypatch):
    monkeypatch.setenv("DRAWING_MAX_UPLOAD_MB", "1")
    payload = b"0\nSECTION\n" + (b"x" * (1024 * 1024 + 1))

    r = client.post(
        "/api/drawing-recognition",
        files={"file": ("large.dxf", BytesIO(payload), "application/dxf")},
    )

    assert r.status_code == 413
    assert "超过 1MB" in r.json()["detail"]


def test_drawing_upload_electrical_dxf_can_be_polled_without_500(client, tmp_path):
    r = client.post(
        "/api/drawing-recognition",
        files={"file": ("electrical-http.dxf", BytesIO(_electrical_dxf_bytes(tmp_path)), "application/dxf")},
    )

    assert r.status_code == 200
    task_id = r.json()["taskId"]
    result = None
    for _ in range(20):
        poll = client.get(f"/api/drawing-recognition/{task_id}")
        assert poll.status_code == 200
        result = poll.json()
        if result["status"] != "processing":
            break
        time.sleep(0.1)

    assert result is not None
    assert result["status"] == "done"
    component_types = {item["type"] for item in result["components"]}
    assert "电气配管" in component_types
    for _ in range(30):
        poll = client.get(f"/api/drawing-recognition/{task_id}")
        assert poll.status_code == 200
        result = poll.json()
        if result["valuation_status"] != "processing":
            break
        time.sleep(0.1)

    assert result["valuation"] is not None


def test_json_safe_sanitizes_non_finite_recognition_payload():
    """识别 payload 中的 NaN/Inf 必须被 _json_safe 清洗为 0.0，否则 JSON 序列化失败。"""
    from app.api.routes import drawing_recognition as route
    import json

    payload = {
        "components": [{
            "id": "component-1",
            "confidence": float("nan"),
            "quantity_estimate": float("inf"),
            "length_m": float("nan"),
            "nested": {"x": float("inf"), "y": 1.0},
            "lst": [float("nan"), float("inf"), 2.0],
        }],
        "boq_suggestions": [{
            "suggested_quantity": float("nan"),
            "confidence": float("inf"),
        }],
    }
    cleaned = route._json_safe(payload)
    # 必须能被 JSON 序列化（原样含 NaN/Inf 会抛 ValueError）
    dumped = json.dumps(cleaned)
    assert "NaN" not in dumped and "Infinity" not in dumped
    assert cleaned["components"][0]["confidence"] == 0.0
    assert cleaned["boq_suggestions"][0]["suggested_quantity"] == 0.0
    assert cleaned["components"][0]["lst"][2] == 2.0


def test_drawing_upload_returns_recognition_before_slow_valuation(client, monkeypatch):
    """识别结果应先于慢计价完成：计价超时时前端仍能拿到 done 状态。"""
    import queue as _queue
    from types import SimpleNamespace

    from app.api.routes import drawing_recognition as route

    valuation_started = {"value": False}

    canned_result = {
        "drawing_type": "电气平面图",
        "summary": "mock electrical drawing",
        "components": [{
            "id": "component-1",
            "type": "电气配管",
            "count": 1,
            "spec": "SC20",
            "confidence": 92.0,
            "material": "",
            "unit": "m",
            "quantity_estimate": 12.0,
            "length_m": 12.0,
            "area_m2": 0,
            "layers": ["ELEC"],
            "calc_note": "mock",
        }],
        "boq_suggestions": [{
            "source_component_id": "component-1",
            "suggested_code": "030411001",
            "suggested_name": "配管",
            "suggested_unit": "m",
            "suggested_quantity": 12.0,
            "characteristics": "SC20",
            "confidence": 92.0,
            "material": "",
            "component_count": 1,
        }],
        "diagnostics": [],
        "layer_summary": [],
        "preview_svg": "<svg />",
        "preview_svg_hd": "<svg />",
        "error": None,
    }

    fake_queue = _queue.Queue()
    fake_queue.put(("result", canned_result))

    class _FakeProcess:
        exitcode = 0
        def is_alive(self):
            return False
        def join(self, timeout=None):
            pass

    def fake_start(_file_bytes, _filename):
        return _FakeProcess(), fake_queue

    def fake_auto_valuate(_task_id, _suggestions, progress_callback=None):
        valuation_started["value"] = True
        if progress_callback:
            progress_callback("正在匹配定额 1/1...")
        time.sleep(0.5)
        return {
            "project_id": 123,
            "project_name": "mock project",
            "boq_items_created": 1,
            "matched": 1,
            "skipped": 0,
            "grand_total": 100.0,
            "total_direct": 100.0,
            "items": [],
            "calc_summary": None,
            "error": None,
        }

    monkeypatch.setattr(route, "_start_cad_analysis", fake_start)
    monkeypatch.setattr(route, "_auto_valuate_suggestions", fake_auto_valuate)

    r = client.post(
        "/api/drawing-recognition",
        files={"file": ("slow-valuation.dxf", BytesIO(b"0\nSECTION\n2\nEOF\n"), "application/dxf")},
    )

    assert r.status_code == 200
    task_id = r.json()["taskId"]
    result = None
    for _ in range(20):
        poll = client.get(f"/api/drawing-recognition/{task_id}")
        assert poll.status_code == 200
        result = poll.json()
        if result["status"] == "done":
            break
        time.sleep(0.05)

    assert result is not None
    assert result["status"] == "done"
    assert result["components"][0]["type"] == "电气配管"
    assert result["valuation"] is None or valuation_started["value"]
    assert result["valuation_status"] in {"idle", "processing", "done"}

    for _ in range(20):
        poll = client.get(f"/api/drawing-recognition/{task_id}")
        assert poll.status_code == 200
        result = poll.json()
        if result["valuation_status"] == "done":
            break
        time.sleep(0.1)

    assert result["valuation_status"] == "done"
    assert result["valuation"]["grand_total"] == 100.0
