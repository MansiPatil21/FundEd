"""Tests for the bootstrap saving estimate."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pytest

from app.inference import bootstrap_rate_paths, estimate_saving
from app.models import FeeStructure, Obligation, PlanRequest, Period

START = date(2027, 1, 1)


def build_request(days: int = 60) -> PlanRequest:
    """A horizon of `days` daily decision points with one obligation per 30 days.

    Obligations are derived from the horizon rather than hard-coded, so shortening
    the horizon in a test cannot leave a bill falling after the last period.
    """
    periods = [
        Period(on=START + timedelta(days=d), rate=60.0, income_minor=5_000)
        for d in range(days)
    ]
    obligations = [
        Obligation(
            label=f"month-{month + 1}",
            due_on=START + timedelta(days=min(30 * (month + 1) - 1, days - 1)),
            amount_minor=1_800_000,
        )
        for month in range(max(1, days // 30))
    ]
    return PlanRequest(
        periods=periods,
        obligations=obligations,
        fees=FeeStructure(fixed_minor=500, variable_bps=50),
        opening_balance_minor=200_000,
        minimum_balance_minor=5_000,
        time_limit_seconds=2.0,
    )


class TestBootstrapRatePaths:
    def test_produces_the_requested_shape(self):
        rng = np.random.default_rng(1)
        history = np.array([60.0, 60.5, 59.8, 61.2, 60.9])
        paths = bootstrap_rate_paths(history, horizon=10, paths=25, rng=rng)
        assert paths.shape == (25, 10)

    def test_paths_start_near_the_last_observed_rate(self):
        """A synthetic path must begin where reality left off, not somewhere else."""
        rng = np.random.default_rng(2)
        history = np.array([60.0, 60.1, 59.9, 60.2])
        paths = bootstrap_rate_paths(history, horizon=5, paths=200, rng=rng)
        assert abs(paths[:, 0].mean() - 60.2) < 0.5

    def test_rates_stay_positive(self):
        """Exponentiating log returns guarantees this; asserting it guards against
        someone later 'simplifying' to additive returns, which does not."""
        rng = np.random.default_rng(3)
        history = np.array([60.0, 55.0, 66.0, 58.0, 63.0])
        paths = bootstrap_rate_paths(history, horizon=50, paths=100, rng=rng)
        assert (paths > 0).all()

    def test_rejects_a_history_too_short_to_bootstrap(self):
        rng = np.random.default_rng(4)
        with pytest.raises(ValueError, match="at least 3"):
            bootstrap_rate_paths(np.array([60.0, 61.0]), horizon=5, paths=10, rng=rng)


class TestEstimateSaving:
    @pytest.fixture(scope="class")
    @staticmethod
    def volatile_estimate():
        history = 60.0 * np.exp(np.cumsum(np.random.default_rng(7).normal(0, 0.01, 250)))
        return estimate_saving(build_request(), history, paths=40, resamples=500)

    def test_reports_a_confidence_interval_around_the_mean(self, volatile_estimate):
        assert volatile_estimate.ci_low_minor <= volatile_estimate.mean_saving_minor
        assert volatile_estimate.mean_saving_minor <= volatile_estimate.ci_high_minor

    def test_counts_only_paths_that_produced_a_plan(self, volatile_estimate):
        assert 0 < volatile_estimate.feasible_paths <= volatile_estimate.paths

    def test_significance_is_exactly_whether_the_interval_clears_zero(self, volatile_estimate):
        assert volatile_estimate.significant == (volatile_estimate.ci_low_minor > 0)

    def test_timing_is_worth_nothing_when_the_rate_never_moves(self):
        """The honest negative case: with a flat rate there is no timing advantage,
        so any saving must come from bundling fees alone and must not be dressed up
        as rate skill."""
        flat = np.full(100, 60.0)
        estimate = estimate_saving(build_request(30), flat, paths=10, resamples=300)
        assert estimate.ci_low_minor == estimate.ci_high_minor == estimate.mean_saving_minor

    def test_is_reproducible_for_a_fixed_seed(self):
        history = 60.0 * np.exp(np.cumsum(np.random.default_rng(11).normal(0, 0.008, 200)))
        first = estimate_saving(build_request(30), history, paths=12, resamples=300, seed=42)
        second = estimate_saving(build_request(30), history, paths=12, resamples=300, seed=42)
        assert first.mean_saving_minor == second.mean_saving_minor
        assert first.ci_low_minor == second.ci_low_minor
