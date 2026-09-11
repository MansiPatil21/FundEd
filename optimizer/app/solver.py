"""Remittance timing as a mixed-integer program, solved with CP-SAT.

The question
------------
A student owes fixed amounts back home on fixed dates. They can send money on any
day, paying a flat fee plus a percentage, at whatever the exchange rate is that day.
Sending early means paying today's rate and holding less local cash; sending late
means fewer, larger transfers and fewer flat fees, but risks a worse rate. Sending
often smooths rate risk but multiplies the flat fee.

Deciding this by feel is what most people do. It is a scheduling problem with a
genuine optimum.

The model
---------
For each period t:

    x[t]  integer, local minor units sent on day t
    y[t]  boolean, whether a transfer happens on day t

Minimise      sum_t  x[t] * (1 + variable_bps/10_000)  +  fixed_fee * y[t]

subject to
    (1) every obligation is covered by its due date, in home currency
    (2) the running local balance never falls below the minimum buffer
    (3) x[t] > 0 implies y[t] = 1, and x[t] >= min_transfer when y[t] = 1

Why the objective is not simply "sum of x"
------------------------------------------
Because the exchange rate varies by day, sending on a good day means a smaller x
covers the same home-currency obligation. Minimising local outlay therefore pushes
transfers toward favourable rates on its own: the rate does not appear in the
objective at all, only in constraint (1). That is the part worth explaining.

Integer arithmetic
------------------
CP-SAT is an integer solver. Rates are scaled to integers by RATE_SCALE and the
objective by BPS_SCALE so every coefficient is exact. Nothing is rounded except the
rates themselves, once, at a known precision.
"""

from __future__ import annotations

from ortools.sat.python import cp_model

from .models import PlanRequest, PlanResponse, PlannedTransfer

RATE_SCALE = 1_000_000
BPS_SCALE = 10_000


def solve(request: PlanRequest) -> PlanResponse:
    periods = sorted(request.periods, key=lambda p: p.on)
    obligations = sorted(request.obligations, key=lambda o: o.due_on)

    model = cp_model.CpModel()

    ceiling = request.max_transfer_minor or _natural_ceiling(request, periods)

    sent = [model.new_int_var(0, ceiling, f"sent_{i}") for i in range(len(periods))]
    sends = [model.new_bool_var(f"sends_{i}") for i in range(len(periods))]

    # (3) linking. Without the lower half, the solver could set y[t] = 1 while
    # sending nothing, which costs a fee for no reason, so it never would; the upper
    # half is the one that actually binds.
    for amount, flag in zip(sent, sends):
        model.add(amount <= ceiling * flag)
        if request.min_transfer_minor:
            model.add(amount >= request.min_transfer_minor).only_enforce_if(flag)
        model.add(amount == 0).only_enforce_if(~flag)

    # (1) coverage. Cumulative home-currency received by each due date must meet
    # cumulative obligations due by then. Stated cumulatively rather than per
    # obligation so that sending early for a later bill also helps an earlier one.
    cumulative_due = 0
    for obligation in obligations:
        cumulative_due += obligation.amount_minor
        eligible = [
            sent[i] * _scaled_rate(periods[i].rate)
            for i in range(len(periods))
            if periods[i].on <= obligation.due_on
        ]
        if not eligible:
            raise ValueError(
                f"no period on or before {obligation.due_on} can fund '{obligation.label}'"
            )
        model.add(sum(eligible) >= cumulative_due * RATE_SCALE)

    # (2) the balance never dips below the buffer, checked after every period.
    running = request.opening_balance_minor
    for i, period in enumerate(periods):
        running_expr = (
            running
            + sum(periods[j].income_minor for j in range(i + 1))
            - sum(periods[j].spending_minor for j in range(i + 1))
            - sum(sent[j] for j in range(i + 1))
        )
        model.add(running_expr >= request.minimum_balance_minor)

    # Objective, scaled so the basis-point term stays integral.
    unit_cost = BPS_SCALE + request.fees.variable_bps
    model.minimize(
        sum(amount * unit_cost for amount in sent)
        + sum(flag * request.fees.fixed_minor * BPS_SCALE for flag in sends)
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = request.time_limit_seconds
    solver.parameters.num_workers = 8
    status = solver.solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return PlanResponse(
            status=solver.status_name(status),
            transfers=[],
            total_sent_minor=0,
            total_fees_minor=0,
            total_cost_minor=0,
            closing_balance_minor=request.opening_balance_minor,
        )

    transfers: list[PlannedTransfer] = []
    total_sent = 0
    total_fees = 0

    for i, period in enumerate(periods):
        amount = solver.value(sent[i])
        if amount <= 0:
            continue
        fee = request.fees.fixed_minor + (amount * request.fees.variable_bps) // BPS_SCALE
        total_sent += amount
        total_fees += fee
        transfers.append(
            PlannedTransfer(
                send_on=period.on,
                amount_minor=amount,
                fee_minor=fee,
                rate=period.rate,
                received_home_minor=(amount * _scaled_rate(period.rate)) // RATE_SCALE,
            )
        )

    closing = (
        request.opening_balance_minor
        + sum(p.income_minor for p in periods)
        - sum(p.spending_minor for p in periods)
        - total_sent
    )

    return PlanResponse(
        status=solver.status_name(status),
        transfers=transfers,
        total_sent_minor=total_sent,
        total_fees_minor=total_fees,
        total_cost_minor=total_sent + total_fees,
        closing_balance_minor=closing,
    )


def _scaled_rate(rate: float) -> int:
    return round(rate * RATE_SCALE)


def _natural_ceiling(request: PlanRequest, periods: list) -> int:
    """An upper bound on any single transfer.

    Everything the student could ever have available: opening balance plus all
    income. A tighter bound than an arbitrary large number, which keeps the solver's
    search space honest.
    """
    return request.opening_balance_minor + sum(p.income_minor for p in periods)
