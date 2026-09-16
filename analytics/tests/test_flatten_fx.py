"""Tests for the Spark flattening job.

A local Spark session is slow to start, so the module builds one and shares it. These run in CI
alongside the Airflow and dbt tests.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

pyspark = pytest.importorskip("pyspark", reason="Spark tests need pyspark installed")

from pyspark.sql import SparkSession  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from spark.flatten_fx import RAW_SCHEMA, flatten  # noqa: E402


@pytest.fixture(scope="module")
def spark() -> SparkSession:
    session = (
        SparkSession.builder.master("local[2]")
        .appName("funded-flatten-fx-tests")
        .config("spark.ui.enabled", "false")
        .config("spark.driver.bindAddress", "127.0.0.1")
        .config("spark.driver.host", "127.0.0.1")
        .config("spark.sql.shuffle.partitions", "2")
        .getOrCreate()
    )
    session.sparkContext.setLogLevel("ERROR")
    yield session
    session.stop()


def raw_frame(spark: SparkSession, rates: dict[str, dict[str, float]], base: str = "EUR"):
    return spark.createDataFrame([{"base": base, "start_date": None, "end_date": None, "rates": rates}], RAW_SCHEMA)


def test_explodes_both_levels_into_one_row_each(spark: SparkSession) -> None:
    raw = raw_frame(spark, {"2026-09-01": {"CAD": 1.58, "INR": 98.1}, "2026-09-02": {"CAD": 1.59, "INR": 98.4}})

    rows = flatten(raw).collect()

    assert len(rows) == 4
    assert [r.rate_date for r in rows] == [date(2026, 9, 1), date(2026, 9, 1), date(2026, 9, 2), date(2026, 9, 2)]
    assert {r.quote_currency for r in rows} == {"CAD", "INR"}
    assert all(r.base_currency == "EUR" for r in rows)


def test_currencies_are_upper_cased(spark: SparkSession) -> None:
    raw = raw_frame(spark, {"2026-09-01": {"cad": 1.58}}, base="eur")

    row = flatten(raw).collect()[0]

    assert (row.base_currency, row.quote_currency) == ("EUR", "CAD")


def test_duplicate_date_and_pair_collapses_to_one_row(spark: SparkSession) -> None:
    first = raw_frame(spark, {"2026-09-01": {"CAD": 1.58}})
    second = raw_frame(spark, {"2026-09-01": {"CAD": 1.58}})

    assert flatten(first.union(second)).count() == 1


@pytest.mark.parametrize("bad_rate", [0.0, -1.5, float("nan")])
def test_invalid_rate_stops_the_job(spark: SparkSession, bad_rate: float) -> None:
    raw = raw_frame(spark, {"2026-09-01": {"CAD": bad_rate}})

    with pytest.raises(ValueError, match="invalid rate rows"):
        flatten(raw)


def test_rows_come_back_oldest_first(spark: SparkSession) -> None:
    raw = raw_frame(spark, {"2026-09-03": {"CAD": 1.60}, "2026-09-01": {"CAD": 1.58}, "2026-09-02": {"CAD": 1.59}})

    dates = [r.rate_date for r in flatten(raw).collect()]

    assert dates == sorted(dates)
