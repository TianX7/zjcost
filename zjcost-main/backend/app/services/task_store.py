from __future__ import annotations

import atexit
import gzip
import hashlib
import json
import logging
import os
import queue
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.db.session import session_scope
from app.models.background_task import BackgroundTask
from sqlalchemy import func, or_

logger = logging.getLogger(__name__)
_store_lock = threading.Lock()
_write_queue: queue.Queue[tuple[str, str, dict[str, Any]]] = queue.Queue(maxsize=1000)
_worker_started = False
_worker_lock = threading.Lock()
_worker_thread: threading.Thread | None = None

# 图纸解析的重字段（SVG/高清渲染 base64/几何坐标）单张可达数 MB。
# 全部塞进 background_tasks.payload_json 会让 SQLite 库膨胀到数百 MB，
# 每次启动备份再复制 10 份；这里改为压缩后落盘，库里只留轻量状态。
_HEAVY_PAYLOAD_KEYS = ("preview_svg", "preview_svg_hd", "cad_raster", "cad_geometry")
_DATA_DIR = Path(os.getenv("ZJCOST_DATA_DIR", str(Path(__file__).resolve().parents[2]))).resolve()
_ARTIFACT_DIR = _DATA_DIR / "task_artifacts"
_ARTIFACT_HASHES: dict[str, str] = {}


def _shutdown_worker() -> None:
    """进程退出时等待队列消费完成，避免守护线程丢失任务。"""
    global _worker_thread
    try:
        # 非阻塞地标记队列结束，给 worker 一次最后处理机会
        _write_queue.join()
    except Exception:
        pass
    if _worker_thread is not None and _worker_thread.is_alive():
        _worker_thread.join(timeout=5)


# 注册 atexit 钩子，确保进程退出前尽力消费完队列
atexit.register(_shutdown_worker)


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _public_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if not key.startswith("_")}


def _artifact_file(task_id: str) -> Path:
    safe = "".join(ch for ch in task_id if ch.isalnum() or ch in "-_")[:80] or "task"
    return _ARTIFACT_DIR / f"{safe}.json.gz"


def _split_heavy(payload: dict[str, Any]) -> dict[str, Any]:
    """摘出重字段，只返回非空的那些。"""
    heavy = {key: payload.pop(key) for key in _HEAVY_PAYLOAD_KEYS if payload.get(key)}
    return heavy


def _save_artifacts(task_id: str, heavy: dict[str, Any]) -> None:
    """把重字段压缩落盘；内容未变化时跳过，避免进度刷新反复写大文件。

    与已有文件合并而不是覆盖：渲染图/几何是分通道异步到达的，
    覆盖会让先到的数据丢失。
    """
    if not heavy:
        return
    path = _artifact_file(task_id)
    merged: dict[str, Any] = {}
    if path.exists():
        try:
            with gzip.open(path, "rt", encoding="utf-8") as fh:
                merged = json.load(fh)
        except Exception:
            merged = {}
    merged.update(heavy)
    raw = json.dumps(merged, ensure_ascii=False, default=_json_default).encode("utf-8")
    digest = hashlib.sha1(raw).hexdigest()
    if _ARTIFACT_HASHES.get(task_id) == digest:
        return
    try:
        _ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
        target = path
        tmp = target.with_suffix(".json.gz.tmp")
        with gzip.open(tmp, "wb", compresslevel=6) as fh:
            fh.write(raw)
        os.replace(tmp, target)
        _ARTIFACT_HASHES[task_id] = digest
    except Exception as exc:  # pragma: no cover - 落盘失败不应影响任务查询
        logger.warning("Failed to persist task artifacts %s: %s", task_id, exc)


def load_task_artifact(task_id: str, key: str) -> Any:
    """读取外置重字段，用于服务重启后仍能查看渲染图/几何数据。"""
    path = _artifact_file(task_id)
    if not path.exists():
        return None
    try:
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            return json.load(fh).get(key)
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to load task artifact %s: %s", task_id, exc)
        return None


def update_task_artifact(task_id: str, values: dict[str, Any]) -> None:
    """把通过进度通道到达的重数据并入外置文件（重启后仍可查看）。"""
    _save_artifacts(task_id, {key: value for key, value in values.items() if value})


def _delete_artifact(task_id: str) -> None:
    _ARTIFACT_HASHES.pop(task_id, None)
    try:
        _artifact_file(task_id).unlink(missing_ok=True)
    except Exception:
        pass


def save_background_task(task_id: str, task_type: str, payload: dict[str, Any]) -> None:
    _ensure_worker_started()
    try:
        _write_queue.put_nowait((task_id, task_type, dict(payload)))
    except queue.Full:  # pragma: no cover - live task state is still kept in memory
        logger.warning("Background task persistence queue is full; dropping snapshot %s", task_id)


def _save_background_task_sync(task_id: str, task_type: str, payload: dict[str, Any]) -> None:
    safe_payload = _public_payload(payload)
    # 重字段先摘除并落盘，库内只保留轻量快照
    _save_artifacts(task_id, _split_heavy(safe_payload))
    status = str(safe_payload.get("status") or "processing")
    payload_json = json.dumps(safe_payload, ensure_ascii=False, default=_json_default)
    now = datetime.now(timezone.utc)

    try:
        with _store_lock:
            with session_scope() as db:
                row = db.get(BackgroundTask, task_id)
                if row is None:
                    row = BackgroundTask(
                        id=task_id,
                        task_type=task_type,
                        status=status,
                        payload_json=payload_json,
                        created_at=_parse_dt(safe_payload.get("created_at")) or now,
                        updated_at=_parse_dt(safe_payload.get("updated_at")) or now,
                    )
                    db.add(row)
                else:
                    row.task_type = task_type
                    row.status = status
                    row.payload_json = payload_json
                    row.updated_at = _parse_dt(safe_payload.get("updated_at")) or now
    except Exception as exc:  # pragma: no cover - persistence must not break live tasks
        logger.warning("Failed to persist background task %s: %s", task_id, exc)


def _ensure_worker_started() -> None:
    global _worker_started, _worker_thread
    if _worker_started:
        return
    with _worker_lock:
        if _worker_started:
            return
        _worker_thread = threading.Thread(target=_task_store_worker, name="zjcost-task-store", daemon=True)
        _worker_thread.start()
        _worker_started = True


def _task_store_worker() -> None:
    while True:
        task_id, task_type, payload = _write_queue.get()
        try:
            _save_background_task_sync(task_id, task_type, payload)
        finally:
            _write_queue.task_done()


def load_background_task(task_id: str, task_type: str | None = None) -> dict[str, Any] | None:
    with session_scope() as db:
        row = db.get(BackgroundTask, task_id)
        if row is None or (task_type and row.task_type != task_type):
            return None
        try:
            payload = json.loads(row.payload_json or "{}")
        except json.JSONDecodeError:
            payload = {}
        payload.setdefault("created_at", row.created_at.isoformat() if row.created_at else None)
        payload.setdefault("updated_at", row.updated_at.isoformat() if row.updated_at else None)
        return payload


def delete_expired_background_tasks(task_type: str, ttl_seconds: int) -> int:
    """删除过期任务及其外置重数据文件，返回删除条数。"""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=max(1, ttl_seconds))
    deleted = 0
    try:
        with _store_lock:
            with session_scope() as db:
                rows = (
                    db.query(BackgroundTask)
                    .filter(BackgroundTask.task_type == task_type)
                    .filter(BackgroundTask.updated_at < cutoff)
                    .all()
                )
                for row in rows:
                    db.delete(row)
                    _delete_artifact(row.id)
                    deleted += 1
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to delete expired background tasks: %s", exc)
    return deleted


def offload_legacy_heavy_payloads(task_type: str, batch_size: int = 50) -> int:
    """一次性把历史任务里的 SVG/渲染图/几何数据迁到外置文件。

    旧版本把数 MB 的预览数据直接写进 payload_json，主库因此膨胀到数百 MB。
    迁移后库内只留轻量状态，历史任务仍可查看预览。
    """
    migrated = 0
    try:
        while True:
            with _store_lock:
                with session_scope() as db:
                    rows = (
                        db.query(BackgroundTask)
                        .filter(BackgroundTask.task_type == task_type)
                        .filter(func.length(BackgroundTask.payload_json) > 200_000)
                        .filter(or_(
                            BackgroundTask.payload_json.like('%"preview_svg": "<svg%'),
                            BackgroundTask.payload_json.like('%"preview_svg_hd": "<svg%'),
                            BackgroundTask.payload_json.like('%"cad_raster": {%'),
                            BackgroundTask.payload_json.like('%"cad_geometry": {%'),
                        ))
                        .limit(batch_size)
                        .all()
                    )
                    if not rows:
                        break
                    batch_migrated = 0
                    for row in rows:
                        try:
                            payload = json.loads(row.payload_json or "{}")
                        except json.JSONDecodeError:
                            payload = {}
                        heavy = _split_heavy(payload)
                        if heavy:
                            _save_artifacts(row.id, heavy)
                            batch_migrated += 1
                        row.payload_json = json.dumps(payload, ensure_ascii=False, default=_json_default)
                        migrated += 1
            if len(rows) < batch_size or batch_migrated == 0:
                break
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to offload heavy background task payloads: %s", exc)
    if migrated:
        logger.info("Offloaded heavy payloads for %d background task(s)", migrated)
    return migrated


def compact_sqlite_database() -> None:
    """重数据清理后回收空闲页（VACUUM），把库文件缩回正常大小。"""
    from app.db.session import engine

    if "sqlite" not in str(engine.url):
        return
    raw = None
    try:
        raw = engine.raw_connection()
        dbapi = getattr(raw, "driver_connection", None)
        if dbapi is None:
            dbapi = raw.connection
        dbapi.isolation_level = None  # VACUUM 必须在自动提交模式下执行
        cur = dbapi.cursor()
        cur.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        freelist = cur.execute("PRAGMA freelist_count").fetchone()[0] or 0
        page_size = cur.execute("PRAGMA page_size").fetchone()[0] or 4096
        if int(freelist) * int(page_size) < 20 * 1024 * 1024:
            return
        cur.execute("VACUUM")
        logger.info("SQLite VACUUM done, reclaimed ~%.1f MB", int(freelist) * int(page_size) / 1048576)
    except Exception as exc:  # pragma: no cover
        logger.warning("SQLite compaction failed: %s", exc)
    finally:
        if raw is not None:
            raw.close()


def mark_stale_processing_failed(task_type: str, message: str) -> int:
    """启动时调用：将上一进程遗留的"进行中"任务标记为失败。

    后台工作线程随进程终止，DB 中残留的 processing 任务若不处理，
    前端轮询将永远等不到终态。同时修正任务内嵌的 valuation 子状态。
    """
    now = datetime.now(timezone.utc)
    marked = 0
    try:
        with _store_lock:
            with session_scope() as db:
                rows = (
                    db.query(BackgroundTask)
                    .filter(BackgroundTask.task_type == task_type)
                    .filter(BackgroundTask.status == "processing")
                    .all()
                )
                for row in rows:
                    try:
                        payload = json.loads(row.payload_json or "{}")
                    except json.JSONDecodeError:
                        payload = {}
                    payload["status"] = "error"
                    payload["error"] = message
                    payload["updated_at"] = now.isoformat()
                    if payload.get("valuation_status") == "processing":
                        payload["valuation_status"] = "error"
                        payload["valuation_error"] = message
                        payload["valuation_progress"] = "服务重启，自动计价中断"
                        payload["valuation_progress_percent"] = 0
                    row.status = "error"
                    row.payload_json = json.dumps(payload, ensure_ascii=False, default=_json_default)
                    row.updated_at = now
                    marked += 1
    except Exception as exc:  # pragma: no cover - startup sweep must not break boot
        logger.warning("Failed to mark stale processing tasks for %s: %s", task_type, exc)
        return 0
    if marked:
        logger.info("Startup sweep: marked %d stale '%s' task(s) as failed", marked, task_type)
    return marked


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed
