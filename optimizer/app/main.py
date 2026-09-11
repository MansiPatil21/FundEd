"""FastAPI surface for the optimiser.

This service exists separately from the Node API for one reason: OR-Tools is a
Python library with no equivalent in the Node ecosystem, and a constraint solver is
CPU-bound work that has no business sharing an event loop with an I/O-bound API.
The split is justified by the workload, not by a preference for microservices.
"""

from __future__ import annotations

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .baseline import monthly_baseline
from .inference import estimate_saving
from .models import PlanRequest, PlanResponse
from .solver import solve

app = FastAPI(
    title="FundEd optimiser",
    version="0.1.0",
    summary="Remittance timing as a mixed-integer program",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/plan", response_model=PlanResponse)
def plan(request: PlanRequest) -> PlanResponse:
    """The optimal transfer schedule for one set of obligations and rates."""
    try:
        return solve(request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/baseline", response_model=PlanResponse)
def baseline(request: PlanRequest) -> PlanResponse:
    """What fixed monthly transfers would have cost, for comparison."""
    return monthly_baseline(request)


class SavingRequest(BaseModel):
    plan: PlanRequest
    historical_rates: list[float] = Field(min_length=3, max_length=2_000)
    paths: int = Field(default=200, ge=10, le=1_000)
    confidence: float = Field(default=0.95, gt=0.5, lt=1.0)


class SavingResponse(BaseModel):
    paths: int
    feasible_paths: int
    mean_saving_minor: float
    median_saving_minor: float
    ci_low_minor: float
    ci_high_minor: float
    confidence: float
    significant: bool
    caveat: str


@app.post("/saving", response_model=SavingResponse)
def saving(request: SavingRequest) -> SavingResponse:
    """How much timing is worth, with a confidence interval rather than one number."""
    try:
        estimate = estimate_saving(
            request.plan,
            np.array(request.historical_rates, dtype=float),
            paths=request.paths,
            confidence=request.confidence,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return SavingResponse(
        paths=estimate.paths,
        feasible_paths=estimate.feasible_paths,
        mean_saving_minor=estimate.mean_saving_minor,
        median_saving_minor=estimate.median_saving_minor,
        ci_low_minor=estimate.ci_low_minor,
        ci_high_minor=estimate.ci_high_minor,
        confidence=estimate.confidence,
        significant=estimate.significant,
        caveat=(
            "The optimiser sees the whole rate path in advance, so this is an upper "
            "bound on what perfect timing is worth, not a forecast of user savings."
        ),
    )
