"""Extract daily reference rates from Frankfurter, which republishes the European Central Bank's rates.

One request covers a whole date window (`/v1/2026-09-01..2026-09-07`), so a backfill of a year
is a single call rather than one per day.

A rate that fails validation stops the load instead of being skipped. This is money data: a
missing day shows up as a gap anyone can see, but a wrong rate flows silently into every
transfer plan and volatility figure built on it.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

import httpx
from pydantic import BaseModel, Field, ValidationError


class RateSourceError(RuntimeError):
    """The rate source answered, but not with rates this pipeline can trust."""


@dataclass(frozen=True)
class FxRate:
    rate_date: date
    base_currency: str
    quote_currency: str
    rate: float


class _RangeResponse(BaseModel):
    base: str = Field(min_length=3, max_length=3)
    rates: dict[date, dict[str, float]]


def parse_range(payload: object, symbols: Sequence[str]) -> list[FxRate]:
    """Validates a range response and keeps only the requested quote currencies, oldest first."""
    try:
        parsed = _RangeResponse.model_validate(payload)
    except ValidationError as error:
        raise RateSourceError(f"unrecognised rate response: {error.error_count()} validation problems") from error

    wanted = {symbol.upper() for symbol in symbols}
    base = parsed.base.upper()
    rows: list[FxRate] = []
    for day in sorted(parsed.rates):
        for quote, rate in sorted(parsed.rates[day].items()):
            quote = quote.upper()
            if quote not in wanted:
                continue
            if not math.isfinite(rate) or rate <= 0:
                raise RateSourceError(f"invalid rate {rate!r} for {base}/{quote} on {day.isoformat()}")
            rows.append(FxRate(day, base, quote, rate))
    return rows


def fetch_rates(
    base_url: str,
    base: str,
    symbols: Sequence[str],
    start: date,
    end: date,
    client: httpx.Client | None = None,
    timeout_seconds: float = 20.0,
) -> list[FxRate]:
    """Fetches every published rate from `start` to `end` inclusive. Weekends and holidays have none."""
    if start > end:
        raise ValueError(f"window starts {start} after it ends {end}")
    if not symbols:
        raise ValueError("no quote currencies requested")

    owns_client = client is None
    http = client or httpx.Client(timeout=timeout_seconds)
    try:
        response = http.get(
            f"{base_url.rstrip('/')}/{start.isoformat()}..{end.isoformat()}",
            params={"base": base.upper(), "symbols": ",".join(symbol.upper() for symbol in symbols)},
        )
        response.raise_for_status()
        try:
            payload = response.json()
        except ValueError as error:
            raise RateSourceError("rate source returned a body that is not JSON") from error
        return parse_range(payload, symbols)
    finally:
        if owns_client:
            http.close()
