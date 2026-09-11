"""Is the optimiser's saving real, or did it get lucky on one exchange-rate path?

A single run produces a single number: "this plan costs 4,200 less than sending
monthly." That number is worthless on its own, because it depends entirely on the
particular sequence of rates it was handed. Run it against a different month and the
saving might vanish.

This module answers the harder question. It resamples many plausible rate paths from
historical daily returns, solves both strategies on each, and reports the
distribution of the difference with a bootstrap confidence interval. If the interval
excludes zero, the saving survives the variation in the data rather than resting on
one path.

What this does NOT claim
------------------------
The optimiser is given the whole rate path up front, so it has perfect foresight.
A real student does not. The saving reported here is therefore an UPPER BOUND on
what is achievable, not a forecast of what a user would get. It answers "how much is
timing worth if you timed it perfectly", which is the right first question, and the
honest framing is that it bounds the opportunity rather than delivering it.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .baseline import monthly_baseline
from .models import PlanRequest
from .solver import solve


@dataclass(frozen=True)
class SavingEstimate:
    """Paired comparison of the two strategies across resampled rate paths."""

    paths: int
    mean_saving_minor: float
    median_saving_minor: float
    ci_low_minor: float
    ci_high_minor: float
    confidence: float
    significant: bool
    """True when the interval excludes zero, i.e. the saving is not attributable to
    path variation alone."""
    feasible_paths: int
    """Paths on which both strategies produced a plan. Infeasible ones are excluded
    and counted rather than silently treated as zero saving."""


def bootstrap_rate_paths(
    historical_rates: np.ndarray,
    horizon: int,
    paths: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Resample daily log returns with replacement to build synthetic rate paths.

    Log returns rather than levels, because levels are not exchangeable: an FX series
    wanders, so resampling levels would produce paths that jump implausibly. Returns
    are far closer to independent and identically distributed, which is what the
    bootstrap assumes.
    """
    if historical_rates.ndim != 1 or historical_rates.size < 3:
        raise ValueError("need at least 3 historical observations to bootstrap returns")

    log_returns = np.diff(np.log(historical_rates))
    start = float(historical_rates[-1])

    drawn = rng.choice(log_returns, size=(paths, horizon), replace=True)
    return start * np.exp(np.cumsum(drawn, axis=1))


def estimate_saving(
    request: PlanRequest,
    historical_rates: np.ndarray,
    paths: int = 200,
    confidence: float = 0.95,
    resamples: int = 2_000,
    seed: int = 20260911,
) -> SavingEstimate:
    """Run both strategies over resampled paths and bootstrap the mean difference."""
    rng = np.random.default_rng(seed)
    simulated = bootstrap_rate_paths(historical_rates, len(request.periods), paths, rng)

    differences: list[float] = []

    for path in simulated:
        scenario = request.model_copy(deep=True)
        for period, rate in zip(scenario.periods, path):
            period.rate = float(rate)

        optimised = solve(scenario)
        if not optimised.transfers:
            continue  # infeasible on this path; counted by exclusion, not as a zero

        naive = monthly_baseline(scenario)
        differences.append(float(naive.total_cost_minor - optimised.total_cost_minor))

    if not differences:
        raise ValueError("no path produced a feasible plan; the request may be over-constrained")

    observed = np.array(differences)

    # Percentile bootstrap on the mean of the paired differences. Percentile rather
    # than a normal approximation because the saving distribution is skewed: it is
    # bounded below by roughly zero and has a long right tail.
    means = rng.choice(observed, size=(resamples, observed.size), replace=True).mean(axis=1)
    alpha = 1.0 - confidence
    low, high = np.quantile(means, [alpha / 2, 1 - alpha / 2])

    return SavingEstimate(
        paths=paths,
        mean_saving_minor=float(observed.mean()),
        median_saving_minor=float(np.median(observed)),
        ci_low_minor=float(low),
        ci_high_minor=float(high),
        confidence=confidence,
        significant=bool(low > 0),
        feasible_paths=int(observed.size),
    )
