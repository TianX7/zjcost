from __future__ import annotations

import atexit
import json
import logging
import queue
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db.session import session_scope
from app.models.background_task import BackgroundTask

logger = logging.getLogger(__name__)
_store_lock = threading.Lock()
_write_queue: queue.Queue[tuple[str, str, dict[str, Any]]] = queue.Queue(maxsize=1000)
_worker_started = False
_worker_lock = threading.Lock()
_worker_thread: threading.Thread | None = None


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


def save_background_task(task_id: str, task_type: str, payload: dict[str, Any]) -> None:
    _ensure_worker_started()
    try:
        _write_queue.put_nowait((task_id, task_type, dict(payload)))
    except queue.Full:  # pragma: no cover - live task state is still kept in memory
        logger.warning("Background task persistence queue is full; dropping snapshot %s", task_id)


def _save_background_task_sync(task_id: str, task_type: str, payload: dict[str, Any]) -> None:
    safe_payload = _public_payload(payload)
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


def delete_expired_background_tasks(task_type: str, ttl_seconds: int) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=max(1, ttl_seconds))
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
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to delete expired background tasks: %s", exc)


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
