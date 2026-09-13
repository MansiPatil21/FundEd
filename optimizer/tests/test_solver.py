"""Tests for the remittance optimiser.

The valuable tests here are the ones with a hand-computable optimum. A solver that
returns *an* answer is easy; a solver that returns *the* answer on a case you worked
out by hand is the thing worth trusting.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.models import FeeStructure, Obligation, PlanRequest, Period
from app.solver import solve

START = date(2027, 1, 1)


def period(day: int, rate: float, income: int = 0, spending: int = 0) -> Period:
    return Period(
        on=START + timedelta(days=day),
        rate=rate,
        income_minor=income,
        spending_minor=spending,
    )


def test_sends_on_the_best_rate_day_when_nothing_forces_otherwise():
    """The rate never appears in the objective, only in the coverage constraint.

    Minimising local outlay therefore prefers the favourable day on its own, which is
    the behaviour worth asserting.
    """
    request = PlanRequest(
        periods=[period(0, 60.0), period(1, 62.0), period(2, 61.0)],
        obligations=[Obligation(label="tuition", due_on=START + timedelta(days=2), amount_minor=620_000)],
        fees=FeeStructure(fixed_minor=0, variable_bps=0),
        opening_balance_minor=1_000_000,
    )

    plan = solve(request)

    assert plan.status == "OPTIMAL"
    assert len(plan.transfers) == 1
    assert plan.transfers[0].send_on == START + timedelta(days=1)  # rate 62 is best
    assert plan.transfers[0].amount_minor == 10_000  # 620_000 / 62


def test_a_flat_fee_pushes_the_plan_toward_fewer_transfers():
    """With two obligations and a large flat fee, one early transfer beats two."""
    request = PlanRequest(
        periods=[period(0, 60.0), period(1, 60.0), period(2, 60.0)],
        obligations=[
            Obligation(label="rent", due_on=START + timedelta(days=1), amount_minor=60_000),
            Obligation(label="loan", due_on=START + timedelta(days=2), amount_minor=60_000),
        ],
        fees=FeeStructure(fixed_minor=50_000, variable_bps=0),
        opening_balance_minor=1_000_000,
    )

    plan = solve(request)

    assert plan.status == "OPTIMAL"
    assert len(plan.transfers) == 1
    assert plan.transfers[0].amount_minor == 2_000  # both obligations, one fee
    assert plan.total_fees_minor == 50_000


def test_no_fee_lets_the_plan_wait_for_a_better_rate_on_each_obligation():
    """Without a flat fee there is no reason to bundle, so each bill waits for its
    own best available day."""
    request = PlanRequest(
        periods=[period(0, 50.0), period(1, 70.0), period(2, 55.0)],
        obligations=[
            Obligation(label="rent", due_on=START + timedelta(days=1), amount_minor=70_000),
            Obligation(label="loan", due_on=START + timedelta(days=2), amount_minor=70_000),
        ],
        fees=FeeStructure(fixed_minor=0, variable_bps=0),
        opening_balance_minor=1_000_000,
    )

    plan = solve(request)

    assert plan.status == "OPTIMAL"
    # Day 1 at rate 70 is the best day available to both obligations, so everything
    # goes there: 140_000 / 70 = 2_000.
    assert len(plan.transfers) == 1
    assert plan.transfers[0].send_on == START + timedelta(days=1)
    assert plan.transfers[0].amount_minor == 2_000


def test_minimum_balance_forces_a_split_across_periods():
    """The buffer makes one big early transfer infeasible, so the plan must split."""
    request = PlanRequest(
        periods=[
            period(0, 60.0, income=0),
            period(1, 60.0, income=60_000),
        ],
        obligations=[Obligation(label="fees", due_on=START + timedelta(days=1), amount_minor=6_000_000)],
        fees=FeeStructure(fixed_minor=0, variable_bps=0),
        opening_balance_minor=60_000,
        minimum_balance_minor=10_000,
    )

    plan = solve(request)

    assert plan.status == "OPTIMAL"
    # 6_000_000 home / 60 = 100_000 local needed. Available: 60_000 + 60_000 income
    # = 120_000, less a 10_000 buffer = 110_000. Feasible, and it must use both days
    # because only 50_000 is free on day 0.
    assert plan.total_sent_minor == 100_000
    assert plan.closing_balance_minor >= 10_000
    assert len(plan.transfers) == 2


def test_reports_infeasible_rather_than_inventing_a_plan():
    """An obligation larger than everything available must not silently return a
    partial plan."""
    request = PlanRequest(
        periods=[period(0, 60.0)],
        obligations=[Obligation(label="impossible", due_on=START, amount_minor=999_999_999)],
        fees=FeeStructure(fixed_minor=0, variable_bps=0),
        opening_balance_minor=1_000,
    )

    plan = solve(request)

    assert plan.status == "INFEASIBLE"
    assert plan.transfers == []


def test_variable_fee_is_charged_on_what_was_actually_sent():
    request = PlanRequest(
        periods=[period(0, 60.0)],
        obligations=[Obligation(label="rent", due_on=START, amount_minor=600_000)],
        fees=FeeStructure(fixed_minor=100, variable_bps=150),  # 1.5%
        opening_balance_minor=1_000_000,
    )

    plan = solve(request)

    assert plan.transfers[0].amount_minor == 10_000
    assert plan.transfers[0].fee_minor == 100 + 150  # 100 flat + 1.5% of 10_000
    assert plan.total_cost_minor == 10_000 + 250


def test_minimum_transfer_floor_is_respected():
    """Providers impose a floor. A plan that ignores it is not executable."""
    request = PlanRequest(
        periods=[period(0, 60.0), period(1, 60.0)],
        obligations=[
            Obligation(label="a", due_on=START, amount_minor=60_000),
            Obligation(label="b", due_on=START + timedelta(days=1), amount_minor=60_000),
        ],
        fees=FeeStructure(fixed_minor=0, variable_bps=0),
        opening_balance_minor=1_000_000,
        min_transfer_minor=5_000,
    )

    plan = solve(request)

    assert plan.status == "OPTIMAL"
    assert all(t.amount_minor >= 5_000 for t in plan.transfers)


def test_rejects_an_obligation_that_falls_outside_the_horizon():
    """Caught at validation, not by the solver returning something confusing."""
    with pytest.raises(ValueError, match="outside|never be met"):
        PlanRequest(
            periods=[period(0, 60.0)],
            obligations=[Obligation(label="late", due_on=START + timedelta(days=30), amount_minor=1_000)],
            fees=FeeStructure(fixed_minor=0, variable_bps=0),
            opening_balance_minor=1_000,
        )


def test_fees_count_against_the_minimum_balance():
    """A transfer that fits the buffer on its own but not once its fee is paid must not be planned.

    Before fees were counted, this plan was accepted and left the account 500 below the buffer.
    """
    request = PlanRequest(
        periods=[period(0, 1.0)],
        obligations=[Obligation(label="rent", due_on=START, amount_minor=90_000)],
        fees=FeeStructure(fixed_minor=500, variable_bps=0),
        opening_balance_minor=100_000,
        minimum_balance_minor=10_000,
    )

    assert solve(request).status == "INFEASIBLE"


def test_closing_balance_is_net_of_fees():
    request = PlanRequest(
        periods=[period(0, 1.0)],
        obligations=[Obligation(label="rent", due_on=START, amount_minor=90_000)],
        fees=FeeStructure(fixed_minor=500, variable_bps=100),  # 5.00 flat plus 1%
        opening_balance_minor=100_000,
        minimum_balance_minor=5_000,
    )

    plan = solve(request)

    assert plan.status == "OPTIMAL"
    assert plan.total_fees_minor == 500 + 900
    assert plan.closing_balance_minor == 100_000 - 90_000 - 1_400
    assert plan.closing_balance_minor >= 5_000


def test_baseline_closing_balance_is_net_of_fees():
    from app.baseline import monthly_baseline

    request = PlanRequest(
        periods=[period(0, 1.0)],
        obligations=[Obligation(label="rent", due_on=START, amount_minor=90_000)],
        fees=FeeStructure(fixed_minor=500, variable_bps=0),
        opening_balance_minor=100_000,
    )

    assert monthly_baseline(request).closing_balance_minor == 100_000 - 90_000 - 500
