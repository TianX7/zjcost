import portable_launcher
import json
import os
import time


def test_find_existing_app_port_requires_zjcost_routes(monkeypatch):
    def fake_read(url: str, timeout: float = 0.25, limit: int = 200000) -> str:
        if ":8000/healthz" in url:
            return '{"status":"ok"}'
        if ":8000/openapi.json" in url:
            return '{"paths":{"/api/other":{}}}'
        if ":8001/healthz" in url:
            return '{"status":"ok"}'
        if ":8001/openapi.json" in url:
            return '{"paths":{"/api/projects":{},"/api/ifc-parse":{},"/api/drawing-recognition":{}}}'
        raise OSError("closed")

    monkeypatch.setattr(portable_launcher, "_read_local_url", fake_read)

    assert portable_launcher._find_existing_app_port(start=8000, attempts=3) == 8001


def test_duplicate_launch_does_not_overwrite_running_status(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    status_path = data_dir / "launcher-status.json"
    status_path.write_text(
        json.dumps({"status": "running", "pid": 123, "port": 8000}),
        encoding="utf-8",
    )

    monkeypatch.setattr(portable_launcher, "_app_dir", lambda: tmp_path)
    monkeypatch.setattr(portable_launcher, "_acquire_single_instance_lock", lambda _app_dir: False)
    monkeypatch.setattr(portable_launcher, "_find_existing_app_port", lambda: 8000)
    monkeypatch.setenv("ZJCOST_NO_BROWSER", "1")

    portable_launcher.main()

    status = json.loads(status_path.read_text(encoding="utf-8"))
    assert status["status"] == "running"
    assert status["pid"] == 123
    event_log = (data_dir / "launcher-events.log").read_text(encoding="utf-8")
    assert "duplicate_blocked" in event_log


def test_duplicate_launch_opens_existing_url_by_default(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    status_path = data_dir / "launcher-status.json"
    status_path.write_text(
        json.dumps({
            "status": "running",
            "pid": 123,
            "port": 8000,
            "frontend_url": "http://127.0.0.1:8000/zjcost/",
        }),
        encoding="utf-8",
    )
    opened: list[str] = []

    monkeypatch.setattr(portable_launcher, "_app_dir", lambda: tmp_path)
    monkeypatch.setattr(portable_launcher, "_acquire_single_instance_lock", lambda _app_dir: False)

    def fail_if_slow_scan_runs():
        raise AssertionError("duplicate launch should use launcher-status.json before scanning ports")

    monkeypatch.setattr(portable_launcher, "_find_existing_app_port", fail_if_slow_scan_runs)
    monkeypatch.setattr(portable_launcher, "_parent_process_info", lambda: {
        "parent_pid": 456,
        "parent_exe": "explorer.exe",
    })
    monkeypatch.delenv("ZJCOST_NO_BROWSER", raising=False)
    monkeypatch.setattr(portable_launcher, "_open_desktop_window", lambda *args, **kwargs: None)
    monkeypatch.setattr(portable_launcher.webbrowser, "open", opened.append)

    portable_launcher.main()

    assert opened == ["http://127.0.0.1:8000/zjcost/dashboard"]
    status = json.loads(status_path.read_text(encoding="utf-8"))
    assert status["status"] == "running"


def test_duplicate_launch_from_non_user_parent_does_not_reopen_window(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "launcher-status.json").write_text(
        json.dumps({
            "status": "running",
            "pid": 123,
            "port": 8000,
            "frontend_url": "http://127.0.0.1:8000/zjcost/",
        }),
        encoding="utf-8",
    )
    opened: list[str] = []

    monkeypatch.setattr(portable_launcher, "_app_dir", lambda: tmp_path)
    monkeypatch.setattr(portable_launcher, "_acquire_single_instance_lock", lambda _app_dir: False)
    monkeypatch.setattr(portable_launcher, "_parent_process_info", lambda: {
        "parent_pid": 456,
        "parent_exe": "python.exe",
    })
    monkeypatch.setattr(portable_launcher, "_open_frontend", lambda *args, **kwargs: opened.append(args[0]))
    monkeypatch.delenv("ZJCOST_NO_BROWSER", raising=False)

    portable_launcher.main()

    assert opened == []
    event_log = (data_dir / "launcher-events.log").read_text(encoding="utf-8")
    assert '"user_reopen": false' in event_log
    assert '"reopened": false' in event_log


def test_duplicate_launch_from_running_app_child_does_not_reopen_window(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    status_path = data_dir / "launcher-status.json"
    status_path.write_text(
        json.dumps({
            "status": "running",
            "pid": 123,
            "port": 8000,
            "frontend_url": "http://127.0.0.1:8000/zjcost/",
        }),
        encoding="utf-8",
    )
    opened: list[str] = []

    monkeypatch.setattr(portable_launcher, "_app_dir", lambda: tmp_path)
    monkeypatch.setattr(portable_launcher, "_acquire_single_instance_lock", lambda _app_dir: False)
    monkeypatch.setattr(portable_launcher, "_parent_process_info", lambda: {
        "parent_pid": 123,
        "parent_exe": "筑衡.exe",
    })
    monkeypatch.setattr(portable_launcher, "_open_frontend", lambda *args, **kwargs: opened.append(args[0]))
    monkeypatch.delenv("ZJCOST_NO_BROWSER", raising=False)

    portable_launcher.main()

    assert opened == []
    event_log = (data_dir / "launcher-events.log").read_text(encoding="utf-8")
    assert '"existing_app_child": true' in event_log
    assert '"reopened": false' in event_log


def test_duplicate_launch_does_not_reopen_recent_delegated_window(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "launcher-status.json").write_text(
        json.dumps({
            "status": "running",
            "pid": 123,
            "port": 8000,
            "frontend_url": "http://127.0.0.1:8000/zjcost/",
        }),
        encoding="utf-8",
    )
    (data_dir / "frontend-window.json").write_text(
        json.dumps({"status": "delegated", "pid": 456}),
        encoding="utf-8",
    )
    opened: list[str] = []

    monkeypatch.setattr(portable_launcher, "_app_dir", lambda: tmp_path)
    monkeypatch.setattr(portable_launcher, "_acquire_single_instance_lock", lambda _app_dir: False)
    monkeypatch.setattr(portable_launcher, "_read_local_url", lambda *args, **kwargs: '{"status":"ok"}')
    monkeypatch.setattr(portable_launcher, "_parent_process_info", lambda: {
        "parent_pid": 456,
        "parent_exe": "explorer.exe",
    })
    monkeypatch.setattr(portable_launcher, "_open_frontend", lambda *args, **kwargs: opened.append(args[0]))
    monkeypatch.delenv("ZJCOST_NO_BROWSER", raising=False)

    portable_launcher.main()

    assert opened == []
    event_log = (data_dir / "launcher-events.log").read_text(encoding="utf-8")
    assert '"duplicate_blocked"' in event_log
    assert '"reopened": false' in event_log


def test_duplicate_launch_reopens_stale_delegated_window(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "launcher-status.json").write_text(
        json.dumps({
            "status": "running",
            "pid": 123,
            "port": 8000,
            "frontend_url": "http://127.0.0.1:8000/zjcost/",
        }),
        encoding="utf-8",
    )
    window_path = data_dir / "frontend-window.json"
    window_path.write_text(
        json.dumps({"status": "delegated", "pid": 456}),
        encoding="utf-8",
    )
    stale_time = time.time() - portable_launcher.DELEGATED_DUPLICATE_SUPPRESS_SECONDS - 5
    os.utime(window_path, (stale_time, stale_time))
    opened: list[str] = []

    monkeypatch.setattr(portable_launcher, "_app_dir", lambda: tmp_path)
    monkeypatch.setattr(portable_launcher, "_acquire_single_instance_lock", lambda _app_dir: False)
    monkeypatch.setattr(portable_launcher, "_read_local_url", lambda *args, **kwargs: '{"status":"ok"}')
    monkeypatch.setattr(portable_launcher, "_parent_process_info", lambda: {
        "parent_pid": 456,
        "parent_exe": "explorer.exe",
    })
    monkeypatch.setattr(portable_launcher, "_open_frontend", lambda *args, **kwargs: opened.append(args[0]))
    monkeypatch.delenv("ZJCOST_NO_BROWSER", raising=False)

    portable_launcher.main()

    assert opened == ["http://127.0.0.1:8000/zjcost/dashboard"]


def test_multiprocessing_child_duplicate_never_reopens_window(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "launcher-status.json").write_text(
        json.dumps({
            "status": "running",
            "pid": 123,
            "port": 8000,
            "frontend_url": "http://127.0.0.1:8000/zjcost/",
        }),
        encoding="utf-8",
    )
    opened: list[str] = []

    monkeypatch.setattr(portable_launcher, "_app_dir", lambda: tmp_path)
    monkeypatch.setattr(portable_launcher, "_acquire_single_instance_lock", lambda _app_dir: False)
    monkeypatch.setattr(portable_launcher, "_open_frontend", lambda *args, **kwargs: opened.append(args[0]))
    monkeypatch.setattr(portable_launcher.sys, "argv", ["筑衡.exe", "--multiprocessing-fork"])
    monkeypatch.delenv("ZJCOST_NO_BROWSER", raising=False)

    portable_launcher.main()

    assert opened == []
    event_log = (data_dir / "launcher-events.log").read_text(encoding="utf-8")
    assert '"multiprocessing_child": true' in event_log
    assert '"reopened": false' in event_log
