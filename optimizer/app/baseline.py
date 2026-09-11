"""The naive strategy the optimiser is measured against.

Claiming a plan is good is meaningless without a baseline, and the baseline has to
be what a person would actually do rather than a strawman. Most students send a
fixed amount on a fixed day each month, sized to cover what is coming up. That is
what this models.
"""

from __future__ import annotations

from datetime import date

from .models import PlanRequest, PlanResponse, PlannedTransfer
from .solver import BPS_SCALE, RATE_SCALE, _scaled_rate


def monthly_baseline(request: PlanRequest) -> PlanResponse:
    """Send, on the first available period of each month, exactly enough to cover
    every obligation falling due before the next month's send.

    No rate shopping and no bundling: the strategy ignores the rate entirely, which
    is precisely the behaviour the optimiser is claiming to beat.
    """
    periods = sorted(request.periods, key=lambda p: p.on)
    obligations = sorted(request.obligations, key=lambda o: o.due_on)

    first_of_month: dict[tuple[int, int], int] = {}
    for index, period in enumerate(periods):
        key = (period.on.year, period.on.month)
        first_of_month.setdefault(key, index)

    send_indices = sorted(first_of_month.values())
    send_dates = [periods[i].on for i in send_indices]

    # Each obligation is funded by the last send date on or before its due date.
    funded_by: dict[int, int] = {i: 0 for i in send_indices}
    for obligation in obligations:
        eligible = [i for i in send_indices if periods[i].on <= obligation.due_on]
        if not eligible:
            # Nothing can fund it under this strategy; fall back to the first send so
            # the comparison stays honest rather than silently dropping the bill.
            eligible = [send_indices[0]]
        funded_by[eligible[-1]] += obligation.amount_minor

    transfers: list[PlannedTransfer] = []
    total_sent = 0
    total_fees = 0

    for index in send_indices:
        home_needed = funded_by[index]
        if home_needed == 0:
            continue
        period = periods[index]
        scaled = _scaled_rate(period.rate)
        # Ceiling division: sending a hair short would leave the bill unpaid.
        amount = -(-home_needed * RATE_SCALE // scaled)
        fee = request.fees.fixed_minor + (amount * request.fees.variable_bps) // BPS_SCALE
        total_sent += amount
        total_fees += fee
        transfers.append(
            PlannedTransfer(
                send_on=period.on,
                amount_minor=amount,
                fee_minor=fee,
                rate=period.rate,
                received_home_minor=(amount * scaled) // RATE_SCALE,
            )
        )

    closing = (
        request.opening_balance_minor
        + sum(p.income_minor for p in periods)
        - sum(p.spending_minor for p in periods)
        - total_sent
    )

    return PlanResponse(
        status="BASELINE",
        transfers=transfers,
        total_sent_minor=total_sent,
        total_fees_minor=total_fees,
        total_cost_minor=total_sent + total_fees,
        closing_balance_minor=closing,
    )
