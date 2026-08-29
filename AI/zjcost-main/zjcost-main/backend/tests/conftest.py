"""Shared test fixtures: in-memory SQLite DB + FastAPI TestClient."""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# 测试环境默认关闭鉴权，保持业务测试与改造前行为一致；生产默认仍由 .env 控制（true）
os.environ.setdefault("ZJCOST_AUTH_REQUIRED", "false")
# 测试用 JWT 密钥：仅用于单测，不应用于生产
os.environ.setdefault("JWT_SECRET_KEY", "test-only-jwt-secret-key-do-not-use-in-production")

import app.models  # noqa: F401 – register all ORM models
from app.db.base import Base
from app.db.session import get_db
from app.main import app

engine = create_engine(
    "sqlite:///file:testdb?mode=memory&cache=shared&uri=true",
    connect_args={"check_same_thread": False},
)
TestSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def _override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture(autouse=True)
def setup_db():
    """Create all tables before each test, drop after."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client(setup_db):
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def db(setup_db):
    """Yield a raw DB session for seeding test data."""
    session = TestSession()
    yield session
    session.close()
