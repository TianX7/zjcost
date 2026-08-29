import importlib

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.session import get_db
from app.models.user import User
from app.services.auth_service import create_access_token, hash_password


def test_projects_are_public_by_default(client):
    r = client.get("/api/projects")

    assert r.status_code == 200


def test_auth_required_toggle_protects_project_routes(monkeypatch):
    monkeypatch.setenv("ZJCOST_AUTH_REQUIRED", "true")
    monkeypatch.setenv("ZJCOST_DEV_AUTH", "true")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")

    import app.main as main_module

    reloaded = importlib.reload(main_module)
    try:
        with TestClient(reloaded.app) as client:
            r = client.get("/api/projects")
            assert r.status_code == 401

            health = client.get("/healthz")
            assert health.status_code == 200
    finally:
        monkeypatch.setenv("ZJCOST_AUTH_REQUIRED", "false")
        importlib.reload(main_module)


def test_auth_required_enforces_write_and_zh_settings_roles(monkeypatch, tmp_path):
    monkeypatch.setenv("ZJCOST_AUTH_REQUIRED", "true")
    monkeypatch.setenv("ZJCOST_DEV_AUTH", "true")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")

    engine = create_engine(
        f"sqlite:///{tmp_path / 'auth-rbac.db'}",
        connect_args={"check_same_thread": False},
    )
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    def add_user(username: str, role: str) -> str:
        db = SessionLocal()
        try:
            user = User(
                username=username,
                hashed_password=hash_password("pw"),
                display_name=username,
                role=role,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            return create_access_token(user.id, user.username, user.role)
        finally:
            db.close()

    viewer_token = add_user("viewer", "viewer")
    editor_token = add_user("editor", "editor")
    owner_token = add_user("owner", "owner")

    project_payload = {"name": "RBAC smoke", "region": "CN"}

    import app.main as main_module

    reloaded = importlib.reload(main_module)
    reloaded.app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(reloaded.app) as client:
            viewer_headers = {"Authorization": f"Bearer {viewer_token}"}
            editor_headers = {"Authorization": f"Bearer {editor_token}"}
            owner_headers = {"Authorization": f"Bearer {owner_token}"}

            assert client.get("/api/projects", headers=viewer_headers).status_code == 200
            assert client.post("/api/projects", json=project_payload, headers=viewer_headers).status_code == 403
            assert client.post("/api/projects", json=project_payload, headers=editor_headers).status_code == 200
            assert client.get("/api/assistant/settings", headers=editor_headers).status_code == 403
            assert client.get("/api/assistant/settings", headers=owner_headers).status_code == 200
    finally:
        reloaded.app.dependency_overrides.pop(get_db, None)
        Base.metadata.drop_all(bind=engine)
        monkeypatch.setenv("ZJCOST_AUTH_REQUIRED", "false")
        importlib.reload(main_module)
