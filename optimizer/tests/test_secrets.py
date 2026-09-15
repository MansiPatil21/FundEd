"""Reading the API key from Azure Key Vault through the container's managed identity."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main
from app.secrets import CACHE_SECONDS, ApiKeySource, KeyUnavailable
from tests.test_api import body

VAULT = "https://kv-funded-dev-abcde.vault.azure.net/"


@pytest.fixture
def azure_env(monkeypatch):
    monkeypatch.delenv("OPTIMIZER_API_KEY", raising=False)
    monkeypatch.setenv("KEY_VAULT_URL", VAULT)
    monkeypatch.setenv("IDENTITY_ENDPOINT", "http://localhost:42356/msi/token")
    monkeypatch.setenv("IDENTITY_HEADER", "header-secret")
    monkeypatch.setenv("AZURE_CLIENT_ID", "client-123")
    monkeypatch.setenv("OPTIMIZER_API_KEY_SECRET", "optimizer-api-key")


def fake_azure(calls, value="vault-key-" + "v" * 30):
    def fetch(url, headers):
        calls.append((url, headers))
        if "/msi/token" in url:
            return {"access_token": "token-abc"}
        return {"value": value}

    return fetch


def test_no_vault_and_no_key_means_no_key(monkeypatch):
    monkeypatch.delenv("OPTIMIZER_API_KEY", raising=False)
    monkeypatch.delenv("KEY_VAULT_URL", raising=False)
    assert ApiKeySource(fetch=lambda *_: pytest.fail("must not call Azure")).get() is None


def test_a_direct_key_wins_over_the_vault(azure_env, monkeypatch):
    monkeypatch.setenv("OPTIMIZER_API_KEY", "direct-key-" + "d" * 30)
    assert ApiKeySource(fetch=lambda *_: pytest.fail("must not call Azure")).get() == "direct-key-" + "d" * 30


def test_reads_the_secret_with_a_managed_identity_token(azure_env):
    calls = []

    key = ApiKeySource(fetch=fake_azure(calls)).get()

    assert key == "vault-key-" + "v" * 30
    token_url, token_headers = calls[0]
    assert "resource=https%3A%2F%2Fvault.azure.net" in token_url
    assert "client_id=client-123" in token_url
    assert token_headers == {"X-IDENTITY-HEADER": "header-secret"}
    secret_url, secret_headers = calls[1]
    assert secret_url == VAULT + "secrets/optimizer-api-key?api-version=7.4"
    assert secret_headers == {"Authorization": "Bearer token-abc"}


def test_caches_the_key_then_refreshes_it_after_five_minutes(azure_env):
    calls, now = [], [1000.0]
    source = ApiKeySource(fetch=fake_azure(calls), clock=lambda: now[0])

    source.get()
    now[0] += CACHE_SECONDS - 1
    source.get()
    assert len(calls) == 2, "a second read inside the window must come from cache"

    now[0] += 2
    source.get()
    assert len(calls) == 4, "an expired entry must be re-read so rotation takes effect"


def test_an_unreachable_vault_raises_instead_of_returning_nothing(azure_env):
    def broken(url, headers):
        raise OSError("connection refused")

    with pytest.raises(KeyUnavailable):
        ApiKeySource(fetch=broken).get()


def test_the_api_fails_closed_with_503_when_the_vault_cannot_be_read(azure_env, monkeypatch):
    def broken(url, headers):
        raise OSError("connection refused")

    monkeypatch.setattr(main, "api_keys", ApiKeySource(fetch=broken))
    client = TestClient(main.app)

    assert client.post("/plan", json=body(), headers={"x-api-key": "anything"}).status_code == 503
    assert client.get("/health").status_code == 200


def test_the_api_accepts_the_key_read_from_the_vault(azure_env, monkeypatch):
    monkeypatch.setattr(main, "api_keys", ApiKeySource(fetch=fake_azure([])))
    client = TestClient(main.app)

    assert client.post("/plan", json=body()).status_code == 401
    assert client.post("/plan", json=body(), headers={"x-api-key": "vault-key-" + "v" * 30}).status_code == 200
