from __future__ import annotations

import os
import multiprocessing
import json
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path

_INSTANCE_LOCK_HANDLE = None
_SERVER = None
FRONTEND_PATH = "/zjcost/dashboard"
DETACHED_BROWSER_EXIT_SECONDS = 8.0
DELEGATED_DUPLICATE_SUPPRESS_SECONDS = 15.0


def _app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def _resource_root(app_dir: Path) -> Path:
    internal = app_dir / "_internal"
    return internal if internal.exists() else app_dir


def _find_free_port(start: int = 8000, attempts: int = 50) -> int:
    for port in range(start, start + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _env_enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _frontend_window_state_path(app_dir: Path) -> Path:
    return app_dir / "data" / "frontend-window.json"


def _write_frontend_window_state(app_dir: Path, **payload: object) -> None:
    try:
        data_dir = app_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        current = {}
        state_path = _frontend_window_state_path(app_dir)
        if state_path.exists():
            current = json.loads(state_path.read_text(encoding="utf-8-sig"))
        current.update({
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            **payload,
        })
        state_path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def _frontend_window_likely_open(app_dir: Path) -> bool:
    try:
        state_path = _frontend_window_state_path(app_dir)
        if not state_path.exists():
            return False
        state = json.loads(state_path.read_text(encoding="utf-8-sig"))
        if state.get("status") == "delegated":
            age_seconds = max(0.0, time.time() - state_path.stat().st_mtime)
            return (
                age_seconds <= DELEGATED_DUPLICATE_SUPPRESS_SECONDS
                and _launcher_status_backend_is_alive(app_dir)
            )
        if state.get("status") != "open":
            return False
        pid = state.get("pid")
        if not isinstance(pid, int) or pid <= 0:
            return False
        try:
            os.kill(pid, 0)
            return True
        except PermissionError:
            return True
        except OSError:
            return False
    except Exception:
        return False


def _launcher_status_backend_is_alive(app_dir: Path) -> bool:
    try:
        status_path = app_dir / "data" / "launcher-status.json"
        if not status_path.exists():
            return False
        status = json.loads(status_path.read_text(encoding="utf-8-sig"))
        if status.get("status") not in {"starting", "running", "reused_existing"}:
            return False
        port = status.get("port")
        if not isinstance(port, int):
            return False
        health = _read_local_url(f"http://127.0.0.1:{port}/healthz", timeout=0.2, limit=200)
        return '"ok"' in health or "ok" in health.lower()
    except Exception:
        return False


def _launched_as_multiprocessing_child() -> bool:
    return any(
        arg == "--multiprocessing-fork"
        or arg.startswith("--multiprocessing-")
        or "multiprocessing.spawn" in arg
        or "spawn_main" in arg
        for arg in sys.argv[1:]
    )


def _parent_process_info(pid: int | None = None) -> dict:
    if os.name != "nt":
        return {}
    try:
        import ctypes
        from ctypes import wintypes

        class PROCESSENTRY32W(ctypes.Structure):
            _fields_ = [
                ("dwSize", wintypes.DWORD),
                ("cntUsage", wintypes.DWORD),
                ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t),
                ("th32ModuleID", wintypes.DWORD),
                ("cntThreads", wintypes.DWORD),
                ("th32ParentProcessID", wintypes.DWORD),
                ("pcPriClassBase", ctypes.c_long),
                ("dwFlags", wintypes.DWORD),
                ("szExeFile", wintypes.WCHAR * 260),
            ]

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
        kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
        kernel32.Process32FirstW.restype = wintypes.BOOL
        kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
        kernel32.Process32NextW.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL

        snapshot = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
        if snapshot == wintypes.HANDLE(-1).value:
            return {}
        processes: dict[int, tuple[int, str]] = {}
        try:
            entry = PROCESSENTRY32W()
            entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
            ok = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
            while ok:
                processes[int(entry.th32ProcessID)] = (
                    int(entry.th32ParentProcessID),
                    str(entry.szExeFile),
                )
                ok = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
        finally:
            kernel32.CloseHandle(snapshot)

        current_pid = int(pid or os.getpid())
        current = processes.get(current_pid)
        if not current:
            return {}
        parent_pid, _ = current
        return {
            "parent_pid": parent_pid,
            "parent_exe": processes.get(parent_pid, (0, ""))[1],
        }
    except Exception:
        return {}


def _launched_by_existing_app_instance(app_dir: Path) -> bool:
    status = _read_launcher_status(app_dir)
    existing_pid = status.get("pid")
    if not isinstance(existing_pid, int) or existing_pid <= 0:
        return False
    return _parent_process_info().get("parent_pid") == existing_pid


def _duplicate_launch_is_user_reopen(parent_info: dict | None = None) -> bool:
    if _env_enabled("ZJCOST_REOPEN_EXISTING_WINDOW"):
        return True
    parent_info = parent_info or _parent_process_info()
    parent_exe = str(parent_info.get("parent_exe") or "").strip().lower()
    return parent_exe in {"explorer.exe"}


def _reopen_existing_window_on_duplicate(app_dir: Path) -> bool:
    if _env_enabled("ZJCOST_REOPEN_EXISTING_WINDOW"):
        return True
    if _env_enabled("ZJCOST_DISABLE_DUPLICATE_REOPEN"):
        return False
    return not _frontend_window_likely_open(app_dir)


def _acquire_single_instance_lock(app_dir: Path) -> bool:
    """Hold a process-level lock so a second packaged app cannot open another port."""

    global _INSTANCE_LOCK_HANDLE
    if _env_enabled("ZJCOST_ALLOW_MULTIPLE"):
        return True

    data_dir = app_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    lock_path = data_dir / "zjcost-app.lock"
    handle = lock_path.open("a+", encoding="utf-8")
    try:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return False

    try:
        handle.seek(0)
        handle.truncate()
        handle.write(f"pid={os.getpid()}\nstarted_at={datetime.now().isoformat(timespec='seconds')}\n")
        handle.flush()
    except OSError:
        pass
    _INSTANCE_LOCK_HANDLE = handle
    return True


def _read_local_url(url: str, timeout: float = 0.25, limit: int = 200000) -> str:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.read(limit).decode("utf-8", errors="ignore")


def _read_launcher_status(app_dir: Path) -> dict:
    try:
        status_path = app_dir / "data" / "launcher-status.json"
        if not status_path.exists():
            return {}
        status = json.loads(status_path.read_text(encoding="utf-8-sig"))
        return status if isinstance(status, dict) else {}
    except Exception:
        return {}


def _find_existing_app_port(start: int = 8000, attempts: int = 50) -> int | None:
    for port in range(start, start + attempts):
        try:
            health = _read_local_url(f"http://127.0.0.1:{port}/healthz", timeout=0.2, limit=200)
            if '"ok"' not in health and "ok" not in health.lower():
                continue
            openapi = _read_local_url(f"http://127.0.0.1:{port}/openapi.json", timeout=0.5)
            if all(path in openapi for path in ("/api/projects", "/api/ifc-parse", "/api/drawing-recognition")):
                return port
        except Exception:
            continue
    return None


def _existing_frontend_url_from_status(app_dir: Path) -> str | None:
    try:
        status = _read_launcher_status(app_dir)
        port = status.get("port")
        if isinstance(port, int):
            return f"http://127.0.0.1:{port}{FRONTEND_PATH}"
        url = status.get("frontend_url")
        if isinstance(url, str) and url.startswith("http://127.0.0.1:"):
            prefix = "http://127.0.0.1:"
            port_text = url[len(prefix):].split("/", 1)[0]
            if port_text.isdigit():
                return f"http://127.0.0.1:{port_text}{FRONTEND_PATH}"
    except Exception:
        return None
    return None


def _candidate_app_browsers() -> list[Path | str]:
    env_browser = os.getenv("ZJCOST_APP_BROWSER", "").strip()
    candidates: list[Path | str] = []
    if env_browser:
        candidates.append(Path(env_browser))

    program_files = [
        os.getenv("PROGRAMFILES(X86)", ""),
        os.getenv("PROGRAMFILES", ""),
        os.getenv("LOCALAPPDATA", ""),
    ]
    for root in program_files:
        if not root:
            continue
        base = Path(root)
        candidates.extend([
            base / "Microsoft" / "Edge" / "Application" / "msedge.exe",
            base / "Google" / "Chrome" / "Application" / "chrome.exe",
        ])

    for name in ("msedge.exe", "chrome.exe", "msedge", "chrome"):
        resolved = shutil.which(name)
        if resolved:
            candidates.append(Path(resolved))

    unique: list[Path | str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate).lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def _monitor_frontend_process(app_dir: Path, process: subprocess.Popen) -> None:
    started_at = time.monotonic()
    try:
        return_code = process.wait()
    except Exception:
        return
    elapsed = time.monotonic() - started_at

    if (
        return_code == 0
        and elapsed < DETACHED_BROWSER_EXIT_SECONDS
        and not _env_enabled("ZJCOST_STRICT_BROWSER_MONITOR")
    ):
        _write_frontend_window_state(
            app_dir,
            status="delegated",
            pid=process.pid,
            return_code=return_code,
            elapsed_seconds=round(elapsed, 2),
        )
        _write_launcher_event(
            app_dir,
            "frontend_window_delegated",
            pid=process.pid,
            return_code=return_code,
            elapsed_seconds=round(elapsed, 2),
        )
        return

    _write_frontend_window_state(
        app_dir,
        status="closed",
        pid=process.pid,
        return_code=return_code,
    )
    _write_launcher_event(
        app_dir,
        "frontend_window_closed",
        pid=process.pid,
        return_code=return_code,
    )
    if _env_enabled("ZJCOST_KEEP_SERVER_ON_WINDOW_CLOSE"):
        return

    server = globals().get("_SERVER")
    if server is not None:
        try:
            server.should_exit = True
            return
        except Exception:
            pass
    os._exit(0)


def _open_desktop_window(url: str, app_dir: Path, *, track: bool = True) -> subprocess.Popen | None:
    if _env_enabled("ZJCOST_USE_SYSTEM_BROWSER"):
        return None

    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    profile_dir = app_dir / "data" / "browser-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)

    for browser in _candidate_app_browsers():
        browser_path = Path(browser)
        if not browser_path.exists():
            continue
        try:
            process = subprocess.Popen(
                [
                    str(browser_path),
                    f"--app={url}",
                    f"--user-data-dir={profile_dir}",
                    "--new-window",
                    "--disable-background-mode",
                    "--no-first-run",
                    "--no-default-browser-check",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                creationflags=creationflags,
            )
            if track:
                _write_frontend_window_state(
                    app_dir,
                    status="open",
                    pid=process.pid,
                    browser=str(browser_path),
                    url=url,
                )
                threading.Thread(
                    target=_monitor_frontend_process,
                    args=(app_dir, process),
                    daemon=True,
                ).start()
            return process
        except OSError:
            continue
    return None


def _open_frontend(url: str, app_dir: Path | None = None, *, track: bool = True) -> None:
    app_dir = app_dir or _app_dir()
    if _open_desktop_window(url, app_dir, track=track):
        return
    _write_frontend_window_state(app_dir, status="external_browser", url=url)
    webbrowser.open(url)


def _ensure_standard_streams(app_dir: Path) -> None:
    log_dir = app_dir / "data"
    log_dir.mkdir(parents=True, exist_ok=True)
    if sys.stdout is None:
        sys.stdout = (log_dir / "launcher-stdout.log").open("a", encoding="utf-8", buffering=1)
    if sys.stderr is None:
        sys.stderr = (log_dir / "launcher-stderr.log").open("a", encoding="utf-8", buffering=1)


def _prepare_environment() -> tuple[Path, int]:
    app_dir = _app_dir()
    resource_root = _resource_root(app_dir)
    python_root = Path(getattr(sys, "_MEIPASS", str(resource_root))).resolve()
    _ensure_libredwg_python_alias(resource_root)
    os.environ["PATH"] = os.pathsep.join([
        str(resource_root / "backend" / "tools" / "cad-converters" / "libredwg"),
        str(app_dir / "backend" / "tools" / "cad-converters" / "libredwg"),
        str(python_root),
        os.environ.get("PATH", ""),
    ])
    data_dir = app_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    runtime_db = data_dir / "valuation.db"
    seed_root = resource_root / "data" / "valuation.seed.db"
    seed_db = seed_root / "valuation.seed.db" if seed_root.is_dir() else seed_root
    if seed_db.exists() and not runtime_db.exists():
        runtime_db.write_bytes(seed_db.read_bytes())

    # Auto-backup: copy valuation.db to a timestamped backup on each launch
    _backup_database(runtime_db, data_dir)

    frontend_dist = resource_root / "frontend" / "dist"
    converter_dir = resource_root / "backend" / "tools" / "cad-converters" / "libredwg"
    if not converter_dir.exists():
        converter_dir = app_dir / "backend" / "tools" / "cad-converters" / "libredwg"

    # Do not force offline mode. When the user configures an 辅助 provider/API key
    # in System Settings, the packaged app should use it; without credentials the
    # backend falls back to deterministic local/demo behavior.
    os.environ.setdefault("SMART_PROVIDER", "disabled")
    os.environ.setdefault("EMBEDDING_BACKEND", "hash")
    os.environ.setdefault("SMART_AUTO_SAVE_MEMORY", "false")
    os.environ.setdefault("EZDXF_DISABLE_C_EXT", "1")
    os.environ["ZJCOST_PORTABLE"] = "1"
    os.environ.setdefault("ZJCOST_DATA_DIR", str(data_dir))
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{(data_dir / 'valuation.db').as_posix()}")
    os.environ.setdefault("ZJCOST_CAD_CONVERTER_DIR", str(converter_dir))
    os.environ.setdefault("ZJCOST_CAD_CONVERTER_TIMEOUT", "600")
    os.environ.setdefault("ZJCOST_FRONTEND_DIST", str(frontend_dist))
    os.environ["ZJCOST_IFC_PARSE_MODE"] = "thread"
    os.environ.setdefault("IFC_MAX_ELEMENTS", "20000")
    os.environ.setdefault("IFC_PREVIEW_ELEMENTS", "20000")
    os.environ.setdefault("IFC_PREVIEW_MESH_ELEMENTS", "20000")
    os.environ.setdefault("IFC_PREVIEW_MESH_PER_CLASS", "20000")

    port = _find_free_port()
    return app_dir, port


def _ensure_libredwg_python_alias(resource_root: Path) -> None:
    """LibreDWG wheels may look for libpython3.12.dll while PyInstaller ships python312.dll."""

    source = resource_root / "python312.dll"
    if not source.exists():
        return
    targets = [
        resource_root / "libpython3.12.dll",
        resource_root / "backend" / "tools" / "cad-converters" / "libredwg" / "lib" / "python3.12" / "site-packages" / "libpython3.12.dll",
    ]
    for target in targets:
        if target.exists():
            continue
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        except OSError:
            pass


def _backup_database(db_path: Path, data_dir: Path) -> None:
    """Create a timestamped backup of the database on each launch. Keeps last 5."""
    if not db_path.exists():
        return
    backup_dir = data_dir / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"valuation_{ts}.db"
    try:
        shutil.copy2(db_path, backup_path)
    except OSError:
        return
    # Rotate: keep only the 5 most recent backups
    existing = sorted(backup_dir.glob("valuation_*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in existing[5:]:
        try:
            old.unlink()
        except OSError:
            pass


def _write_launcher_status(app_dir: Path, **payload: object) -> None:
    try:
        data_dir = app_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        current = {}
        status_path = data_dir / "launcher-status.json"
        if status_path.exists():
            current = json.loads(status_path.read_text(encoding="utf-8"))
        current.update({
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            **payload,
        })
        status_path.write_text(
            json.dumps(current, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        pass


def _write_launcher_event(app_dir: Path, event: str, **payload: object) -> None:
    try:
        data_dir = app_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        event_path = data_dir / "launcher-events.log"
        record = {
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            "event": event,
            **payload,
        }
        with event_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _mark_running_later(app_dir: Path, port: int) -> None:
    for _ in range(80):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                _write_launcher_status(
                    app_dir,
                    status="running",
                    port=port,
                    frontend_url=f"http://127.0.0.1:{port}{FRONTEND_PATH}",
                    pid=os.getpid(),
                )
                return
        except OSError:
            time.sleep(0.25)


def _open_frontend_later(app_dir: Path, port: int) -> None:
    url = f"http://127.0.0.1:{port}{FRONTEND_PATH}"
    for _ in range(80):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                _open_frontend(url, app_dir, track=True)
                return
        except OSError:
            time.sleep(0.25)
    _open_frontend(url, app_dir, track=True)


def main() -> None:
    try:
        lock_app_dir = _app_dir()
        if not _acquire_single_instance_lock(lock_app_dir):
            existing_url = _existing_frontend_url_from_status(lock_app_dir)
            existing_port = None
            if existing_url is None:
                existing_port = _find_existing_app_port()
                if existing_port is not None:
                    existing_url = f"http://127.0.0.1:{existing_port}{FRONTEND_PATH}"
            is_multiprocessing_child = _launched_as_multiprocessing_child()
            is_existing_app_child = _launched_by_existing_app_instance(lock_app_dir)
            parent_info = _parent_process_info()
            is_user_reopen = _duplicate_launch_is_user_reopen(parent_info)
            should_reopen = bool(
                existing_url
                and not is_multiprocessing_child
                and not is_existing_app_child
                and is_user_reopen
                and not _env_enabled("ZJCOST_NO_BROWSER")
                and _reopen_existing_window_on_duplicate(lock_app_dir)
            )
            _write_launcher_event(
                lock_app_dir,
                "duplicate_blocked",
                pid=os.getpid(),
                parent_pid=parent_info.get("parent_pid"),
                parent_exe=parent_info.get("parent_exe"),
                existing_port=existing_port,
                existing_url=existing_url,
                multiprocessing_child=is_multiprocessing_child,
                existing_app_child=is_existing_app_child,
                user_reopen=is_user_reopen,
                reopened=should_reopen,
            )
            if should_reopen:
                _write_launcher_event(lock_app_dir, "duplicate_reopen_requested", existing_url=existing_url)
                _open_frontend(existing_url, lock_app_dir, track=False)
            return

        if not _env_enabled("ZJCOST_NO_BROWSER") and not _env_enabled("ZJCOST_ALLOW_MULTIPLE"):
            existing_port = _find_existing_app_port()
            if existing_port is not None:
                parent_info = _parent_process_info()
                is_user_reopen = _duplicate_launch_is_user_reopen(parent_info)
                should_reopen_existing_port = bool(
                    is_user_reopen
                    and not _launched_as_multiprocessing_child()
                    and _reopen_existing_window_on_duplicate(_app_dir())
                )
                _write_launcher_status(
                    _app_dir(),
                    status="reused_existing",
                    port=existing_port,
                    frontend_url=f"http://127.0.0.1:{existing_port}{FRONTEND_PATH}",
                    pid=os.getpid(),
                )
                _write_launcher_event(
                    _app_dir(),
                    "existing_port_reused",
                    existing_port=existing_port,
                    multiprocessing_child=_launched_as_multiprocessing_child(),
                    parent_pid=parent_info.get("parent_pid"),
                    parent_exe=parent_info.get("parent_exe"),
                    user_reopen=is_user_reopen,
                    reopened=should_reopen_existing_port,
                )
                if should_reopen_existing_port:
                    _open_frontend(f"http://127.0.0.1:{existing_port}{FRONTEND_PATH}", _app_dir(), track=False)
                return

        app_dir, port = _prepare_environment()
        _ensure_standard_streams(app_dir)
        os.chdir(app_dir)
        _write_launcher_status(
            app_dir,
            status="starting",
            port=port,
            frontend_url=f"http://127.0.0.1:{port}{FRONTEND_PATH}",
            pid=os.getpid(),
        )

        import uvicorn
        from app.main import app as fastapi_app
        from app.db.session import engine

        # Graceful shutdown: flush SQLite WAL before exit
        _shutdown_flag = threading.Event()

        def _handle_exit(signum, frame):
            import logging
            logging.getLogger("portable_launcher").info("Shutting down gracefully...")
            _shutdown_flag.set()
            try:
                engine.dispose()
            except Exception:
                pass
            sys.exit(0)

        signal.signal(signal.SIGTERM, _handle_exit)
        signal.signal(signal.SIGINT, _handle_exit)

        if not _env_enabled("ZJCOST_NO_BROWSER"):
            threading.Thread(target=_open_frontend_later, args=(app_dir, port), daemon=True).start()
        threading.Thread(target=_mark_running_later, args=(app_dir, port), daemon=True).start()
        global _SERVER
        config = uvicorn.Config(
            fastapi_app,
            host="127.0.0.1",
            port=port,
            log_level="warning",
            access_log=False,
            log_config=None,
        )
        _SERVER = uvicorn.Server(config)
        _SERVER.run()
        _write_launcher_status(app_dir, status="stopped", port=port, pid=os.getpid())
    except Exception:
        log_dir = _app_dir() / "data"
        log_dir.mkdir(parents=True, exist_ok=True)
        (log_dir / "launcher-error.log").write_text(traceback.format_exc(), encoding="utf-8")
        _write_launcher_status(_app_dir(), status="error", pid=os.getpid())
        raise


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
