from datetime import date

import httpx
import pytest

from funded_elt.fx import FxRate, RateSourceError, fetch_rates, parse_range

RANGE = {
    "amount": 1.0,
    "base": "CAD",
    "start_date": "2026-09-01",
    "end_date": "2026-09-02",
    "rates": {
        "2026-09-02": {"INR": 68.205, "USD": 0.71815, "EUR": 0.62},
        "2026-09-01": {"INR": 68.371, "USD": 0.72005, "EUR": 0.61},
    },
}


def test_keeps_requested_currencies_oldest_first():
    rows = parse_range(RANGE, ["inr", "usd"])

    assert rows == [
        FxRate(date(2026, 9, 1), "CAD", "INR", 68.371),
        FxRate(date(2026, 9, 1), "CAD", "USD", 0.72005),
        FxRate(date(2026, 9, 2), "CAD", "INR", 68.205),
        FxRate(date(2026, 9, 2), "CAD", "USD", 0.71815),
    ]


def test_a_window_with_no_publications_is_empty_not_an_error():
    # A weekend or a holiday: the ECB publishes nothing and the response has no dates.
    assert parse_range({**RANGE, "rates": {}}, ["INR"]) == []


@pytest.mark.parametrize("bad_rate", [0, -68.2, float("inf"), float("nan")])
def test_stops_on_a_rate_that_cannot_be_right(bad_rate):
    payload = {**RANGE, "rates": {"2026-09-01": {"INR": bad_rate}}}

    with pytest.raises(RateSourceError, match="invalid rate"):
        parse_range(payload, ["INR"])


@pytest.mark.parametrize(
    "payload",
    [None, {"base": "CAD"}, {"base": "CAD", "rates": {"not-a-date": {"INR": 1}}}, {"base": "CANADA", "rates": {}}],
)
def test_rejects_a_response_of_the_wrong_shape(payload):
    with pytest.raises(RateSourceError, match="unrecognised"):
        parse_range(payload, ["INR"])


def test_fetches_the_whole_window_in_one_request():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        return httpx.Response(200, json=RANGE)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        rows = fetch_rates("https://rates.test/v1/", "cad", ["INR"], date(2026, 9, 1), date(2026, 9, 2), client=client)

    assert len(seen) == 1
    assert seen[0].path == "/v1/2026-09-01..2026-09-02"
    assert seen[0].params["base"] == "CAD"
    assert seen[0].params["symbols"] == "INR"
    assert [row.rate for row in rows] == [68.371, 68.205]


def test_an_http_error_fails_the_load():
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(503))) as client:
        with pytest.raises(httpx.HTTPStatusError):
            fetch_rates("https://rates.test/v1", "CAD", ["INR"], date(2026, 9, 1), date(2026, 9, 2), client=client)


def test_refuses_a_backwards_window():
    with pytest.raises(ValueError, match="after it ends"):
        fetch_rates("https://rates.test/v1", "CAD", ["INR"], date(2026, 9, 3), date(2026, 9, 1))
