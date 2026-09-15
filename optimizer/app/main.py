"""FastAPI surface for the optimiser.

This service exists separately from the Node API for one reason: OR-Tools is a
Python library with no equivalent in the Node ecosystem, and a constraint solver is
CPU-bound work that has no business sharing an event loop with an I/O-bound API.
The split is justified by the workload, not by a preference for microservices.
"""

from __future__ import annotations

import hmac

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .baseline import monthly_baseline
from .inference import estimate_saving
from .models import PlanRequest, PlanResponse
from .secrets import KeyUnavailable, api_keys
from .solver import solve

def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Rejects planning requests without the shared key, when one is configured.

    Unset locally, on Render and in the test suite, where the optimiser is reachable only by
    the API or is fine to be open. Required on Azure, where the key comes from Key Vault,
    because a Container Apps URL is public and every solve is CPU the subscription pays for.
    If the vault is configured but cannot be read, requests are refused with 503: failing
    open would silently remove the protection. Compared in constant time so response timing
    does not leak how much of a guess was right.
    """
    try:
        expected = api_keys.get()
    except KeyUnavailable as error:
        raise HTTPException(status_code=503, detail="API key temporarily unavailable") from error
    if not expected:
        return
    if x_api_key is None or not hmac.compare_digest(x_api_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="invalid or missing API key")


app = FastAPI(
    title="FundEd optimiser",
    version="0.1.0",
    summary="Remittance timing as a mixed-integer program",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/plan", response_model=PlanResponse, dependencies=[Depends(require_api_key)])
def plan(request: PlanRequest) -> PlanResponse:
    """The optimal transfer schedule for one set of obligations and rates."""
    try:
        return solve(request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/baseline", response_model=PlanResponse, dependencies=[Depends(require_api_key)])
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


@app.post("/saving", response_model=SavingResponse, dependencies=[Depends(require_api_key)])
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
