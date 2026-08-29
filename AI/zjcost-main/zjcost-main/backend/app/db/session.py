"""Database engine and session configuration.

Uses SQLite for local development. Switch DATABASE_URL env var
for PostgreSQL in production.
"""

import os
from contextlib import contextmanager
from pathlib import Path
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

_DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2]
_DATA_DIR = Path(os.getenv("ZJCOST_DATA_DIR", str(_DEFAULT_DATA_DIR))).resolve()
_DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(_DATA_DIR / 'valuation.db').as_posix()}")

_connect_args = {"check_same_thread": False, "timeout": 30} if "sqlite" in DATABASE_URL else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=_connect_args,
    echo=False,
    pool_pre_ping=True,
)

# Enable WAL mode for SQLite to allow concurrent reads while writing
if "sqlite" in DATABASE_URL:
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """Context manager for non-HTTP contexts (background threads, startup, scripts).

    Usage:
        with session_scope() as db:
            ...
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
