"""The optional shared API key that guards the planning endpoints on Azure."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.test_api import body

client = TestClient(app)
KEY = "k" * 40


@pytest.fixture
def key_required(monkeypatch):
    monkeypatch.setenv("OPTIMIZER_API_KEY", KEY)


def test_planning_is_open_when_no_key_is_configured(monkeypatch):
    monkeypatch.delenv("OPTIMIZER_API_KEY", raising=False)
    assert client.post("/plan", json=body()).status_code == 200


@pytest.mark.parametrize("path", ["/plan", "/baseline"])
def test_a_missing_key_is_rejected(key_required, path):
    response = client.post(path, json=body())
    assert response.status_code == 401
    assert response.json() == {"detail": "invalid or missing API key"}


def test_a_wrong_key_is_rejected(key_required):
    assert client.post("/plan", json=body(), headers={"x-api-key": "k" * 39 + "x"}).status_code == 401


def test_the_right_key_is_accepted(key_required):
    assert client.post("/plan", json=body(), headers={"x-api-key": KEY}).status_code == 200


def test_saving_is_guarded_too(key_required):
    payload = {"plan": body(), "historical_rates": [60.0, 61.0, 62.0]}
    assert client.post("/saving", json=payload).status_code == 401


def test_health_stays_open_so_platform_probes_work(key_required):
    assert client.get("/health").status_code == 200
