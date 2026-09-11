"""HTTP-level tests for the optimiser service."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
START = date(2027, 1, 1)


def body(**overrides):
    payload = {
        "periods": [
            {"on": str(START), "rate": 60.0},
            {"on": str(START + timedelta(days=1)), "rate": 62.0},
        ],
        "obligations": [
            {"label": "rent", "due_on": str(START + timedelta(days=1)), "amount_minor": 620_000}
        ],
        "fees": {"fixed_minor": 0, "variable_bps": 0},
        "opening_balance_minor": 1_000_000,
    }
    payload.update(overrides)
    return payload


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_plan_returns_the_optimal_schedule():
    response = client.post("/plan", json=body())
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "OPTIMAL"
    assert len(data["transfers"]) == 1
    assert data["transfers"][0]["rate"] == 62.0


def test_plan_rejects_an_obligation_outside_the_horizon_with_422():
    payload = body(
        obligations=[
            {"label": "late", "due_on": str(START + timedelta(days=90)), "amount_minor": 1_000}
        ]
    )
    assert client.post("/plan", json=payload).status_code == 422


def test_baseline_ignores_the_rate_and_sends_on_the_first_day_of_the_month():
    response = client.post("/baseline", json=body())
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "BASELINE"
    assert data["transfers"][0]["rate"] == 60.0  # day 0, the worse rate


def test_saving_reports_an_interval_and_a_caveat():
    response = client.post(
        "/saving",
        json={
            "plan": body(),
            "historical_rates": [60.0, 60.4, 59.7, 61.1, 60.2, 60.8],
            "paths": 15,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ci_low_minor"] <= data["mean_saving_minor"] <= data["ci_high_minor"]
    assert "upper bound" in data["caveat"]


def test_saving_rejects_a_history_too_short_to_bootstrap():
    response = client.post(
        "/saving", json={"plan": body(), "historical_rates": [60.0, 61.0]}
    )
    assert response.status_code == 422
