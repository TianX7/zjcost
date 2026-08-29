"""Tests for 辅助 settings management routes and multi-provider config."""

import os


def test_get_zh_settings_returns_defaults(client, monkeypatch):
    """GET /api/assistant/settings should return default disabled state."""
    # Ensure env is clean
    for key in list(os.environ):
        if key.startswith("ZH_"):
            monkeypatch.delenv(key, raising=False)

    r = client.get("/api/assistant/settings")
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "disabled"
    assert body["timeout_seconds"] == 20.0
    assert body["enable_audit_logs"] is False
    # All providers should be present
    for p in ["provider_a", "provider_b", "provider_c", "provider_d", "compatible"]:
        assert p in body["providers"]
        assert "api_key" in body["providers"][p]
        assert "base_url" in body["providers"][p]
        assert "model" in body["providers"][p]


def test_put_zh_settings_persists_and_returns(client, monkeypatch):
    """PUT /api/assistant/settings should persist config and return updated state."""
    for key in list(os.environ):
        if key.startswith("ZH_"):
            monkeypatch.delenv(key, raising=False)

    payload = {
        "provider": "provider_a",
        "timeout_seconds": 30,
        "enable_audit_logs": True,
        "providers": {
            "provider_a": {
                "api_key": "sk-test-provider-a",
                "base_url": "https://api.provider-a.example.com",
                "model": "model-a",
            },
            "provider_b": {
                "api_key": "sk-test-provider-b",
                "base_url": "https://api.provider-b.example.com/v1",
                "model": "model-b",
            },
            "provider_c": {"api_key": "", "base_url": "", "model": ""},
            "provider_d": {"api_key": "", "base_url": "", "model": ""},
            "compatible": {"api_key": "", "base_url": "", "model": ""},
        },
    }
    r = client.put("/api/assistant/settings", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "provider_a"
    assert body["timeout_seconds"] == 30.0
    assert body["enable_audit_logs"] is True
    assert body["providers"]["provider_a"]["api_key"] == ""
    assert body["providers"]["provider_a"]["api_key_set"] is True
    assert body["providers"]["provider_b"]["api_key"] == ""
    assert body["providers"]["provider_b"]["api_key_set"] is True

    # Subsequent GET should reflect persisted state
    r2 = client.get("/api/assistant/settings")
    assert r2.json()["provider"] == "provider_a"
    assert r2.json()["providers"]["provider_a"]["api_key"] == ""
    assert r2.json()["providers"]["provider_a"]["api_key_set"] is True

    # Saving the masked response should keep stored API keys instead of clearing them.
    body["providers"]["provider_a"]["model"] = "model-e-reasoner"
    r3 = client.put("/api/assistant/settings", json=body)
    assert r3.status_code == 200
    assert r3.json()["providers"]["provider_a"]["model"] == "model-e-reasoner"
    assert os.environ["ZH_PROVIDER_A_API_KEY"] == "sk-test-provider-a"


def test_put_zh_settings_rejects_invalid_provider(client):
    """PUT with unknown provider should return 400."""
    payload = {
        "provider": "nonexistent",
        "timeout_seconds": 20,
        "enable_audit_logs": False,
        "providers": {
            "provider_a": {"api_key": "", "base_url": "", "model": ""},
            "provider_b": {"api_key": "", "base_url": "", "model": ""},
            "provider_c": {"api_key": "", "base_url": "", "model": ""},
            "provider_d": {"api_key": "", "base_url": "", "model": ""},
            "compatible": {"api_key": "", "base_url": "", "model": ""},
        },
    }
    r = client.put("/api/assistant/settings", json=payload)
    assert r.status_code == 400


def test_put_zh_settings_switch_provider(client, monkeypatch):
    """Switching active provider should reflect in GET."""
    for key in list(os.environ):
        if key.startswith("ZH_"):
            monkeypatch.delenv(key, raising=False)

    base = {
        "timeout_seconds": 20,
        "enable_audit_logs": False,
        "providers": {
            "provider_a": {"api_key": "sk-pa", "base_url": "", "model": ""},
            "provider_b": {"api_key": "sk-pb", "base_url": "", "model": ""},
            "provider_c": {"api_key": "", "base_url": "", "model": ""},
            "provider_d": {"api_key": "", "base_url": "", "model": ""},
            "compatible": {"api_key": "", "base_url": "", "model": ""},
        },
    }

    # Set provider_a first
    client.put("/api/assistant/settings", json={**base, "provider": "provider_a"})
    assert client.get("/api/assistant/settings").json()["provider"] == "provider_a"

    # Switch to provider_b
    client.put("/api/assistant/settings", json={**base, "provider": "provider_b"})
    assert client.get("/api/assistant/settings").json()["provider"] == "provider_b"
