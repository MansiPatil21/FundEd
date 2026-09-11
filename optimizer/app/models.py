"""Request and response shapes for the remittance optimiser.

Money is always an integer in minor units with an explicit currency (NFR-1). Rates
are the only floats, and they are converted to scaled integers before they reach the
solver, because CP-SAT works over integers and floating-point coefficients would make
the model's answer depend on rounding the author did not choose.
"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field, model_validator


class Obligation(BaseModel):
    """A commitment that must be met in the home currency by a given date."""

    label: str
    due_on: date
    amount_minor: int = Field(gt=0, description="home-currency minor units")


class Period(BaseModel):
    """One decision point: a day on which a transfer may be sent."""

    on: date
    rate: float = Field(gt=0, description="home-currency units per 1 unit of local currency")
    income_minor: int = Field(default=0, ge=0, description="local minor units arriving this period")
    spending_minor: int = Field(default=0, ge=0, description="local minor units leaving this period")


class FeeStructure(BaseModel):
    fixed_minor: int = Field(ge=0, description="flat fee per transfer, local minor units")
    variable_bps: int = Field(ge=0, le=10_000, description="basis points of the amount sent")


class PlanRequest(BaseModel):
    periods: list[Period] = Field(min_length=1, max_length=400)
    obligations: list[Obligation] = Field(min_length=1, max_length=200)
    fees: FeeStructure
    opening_balance_minor: int = Field(ge=0, description="local minor units on hand at the start")
    minimum_balance_minor: int = Field(default=0, ge=0, description="local buffer never to dip below")
    max_transfer_minor: int | None = Field(default=None, gt=0)
    min_transfer_minor: int = Field(default=0, ge=0, description="provider floor on a single transfer")
    time_limit_seconds: float = Field(default=10.0, gt=0, le=60)

    @model_validator(mode="after")
    def obligations_fall_inside_the_horizon(self) -> PlanRequest:
        last_period = max(period.on for period in self.periods)
        late = [o.label for o in self.obligations if o.due_on > last_period]
        if late:
            raise ValueError(
                "obligations fall after the last period and could never be met: "
                + ", ".join(late)
            )
        return self


class PlannedTransfer(BaseModel):
    send_on: date
    amount_minor: int
    fee_minor: int
    rate: float
    received_home_minor: int


class PlanResponse(BaseModel):
    status: str
    transfers: list[PlannedTransfer]
    total_sent_minor: int
    total_fees_minor: int
    total_cost_minor: int
    """Sent plus fees. The number the student actually parts with."""
    closing_balance_minor: int
