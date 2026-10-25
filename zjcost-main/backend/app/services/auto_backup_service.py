"""Auto-backup service for SQLite database.

Creates timestamped backups on startup and at configurable intervals.
Backups are stored in <ZJCOST_DATA_DIR>/backups/ with rotation.
"""

import os
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from logging import getLogger

logger = getLogger(__name__)

_DATA_DIR = Path(os.getenv("ZJCOST_DATA_DIR", str(Path(__file__).resolve().parents[2]))).resolve()
_BACKUP_DIR = _DATA_DIR / "backups"
# 运行库可能达数百 MB，默认只保留 3 份，避免副本把磁盘占满
_MAX_BACKUPS = int(os.getenv("ZJCOST_MAX_BACKUPS", "3"))
_BACKUP_INTERVAL_HOURS = float(os.getenv("ZJCOST_BACKUP_INTERVAL_HOURS", "0"))  # 0 = startup only


def _db_path() -> Path | None:
    """Resolve the SQLite database file path from DATABASE_URL."""
    db_url = os.getenv("DATABASE_URL", f"sqlite:///{(_DATA_DIR / 'valuation.db').as_posix()}")
    if not db_url.startswith("sqlite:///"):
        return None  # Non-SQLite — skip auto-backup
    # sqlite:///./valuation.db or sqlite:///absolute/path.db
    path_str = db_url[len("sqlite:///"):]
    db_file = Path(path_str)
    if not db_file.is_absolute():
        db_file = _DATA_DIR / db_file
    return db_file if db_file.exists() else None


def create_backup() -> Path | None:
    """Create a timestamped backup of the SQLite database.

    Returns the backup file path, or None if no database found.
    使用 SQLite 在线备份 API：先做 WAL 检查点再由引擎自身拷贝，
    避免直接复制 db/wal/shm 得到不一致或损坏的备份。
    """
    db_file = _db_path()
    if db_file is None:
        logger.debug("No SQLite database found for backup")
        return None

    _BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = _BACKUP_DIR / f"valuation_{timestamp}.db"

    src = dst = None
    try:
        src = sqlite3.connect(f"file:{db_file.as_posix()}?mode=ro", uri=True, timeout=30)
        dst = sqlite3.connect(backup_file)
        with dst:
            src.backup(dst)
        logger.info("Database backup created: %s", backup_file)
        _rotate_backups()
        return backup_file
    except Exception as exc:
        logger.error("Backup failed: %s", exc)
        try:
            backup_file.unlink(missing_ok=True)
        except Exception:
            pass
        return None
    finally:
        if dst is not None:
            dst.close()
        if src is not None:
            src.close()


def _rotate_backups() -> None:
    """Remove oldest backups if count exceeds _MAX_BACKUPS."""
    backups = sorted(_BACKUP_DIR.glob("valuation_*.db"))
    while len(backups) > _MAX_BACKUPS:
        old = backups.pop(0)
        old.unlink(missing_ok=True)
        for ext in (".db-wal", ".db-shm"):
            (_BACKUP_DIR / (old.name + ext)).unlink(missing_ok=True)
        logger.debug("Rotated away old backup: %s", old)


def start_backup_timer() -> None:
    """Start periodic backup timer (if configured).
    
    Set ZJCOST_BACKUP_INTERVAL_HOURS > 0 to enable periodic backups.
    Default is 0 (backup on startup only).
    """
    if _BACKUP_INTERVAL_HOURS <= 0:
        return

    def _timer():
        create_backup()
        # Reschedule
        t = threading.Timer(_BACKUP_INTERVAL_HOURS * 3600, _timer)
        t.daemon = True
        t.start()

    t = threading.Timer(_BACKUP_INTERVAL_HOURS * 3600, _timer)
    t.daemon = True
    t.start()
    logger.info("Periodic backup enabled: every %.1f hours", _BACKUP_INTERVAL_HOURS)
