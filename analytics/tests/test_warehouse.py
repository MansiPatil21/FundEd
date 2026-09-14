"""Loads against a real PostgreSQL. Skipped when WAREHOUSE_TEST_DB is not set, as in a plain `pytest` run."""

import os
from datetime import date, datetime, timezone

import psycopg
import pytest
from psycopg.conninfo import make_conninfo

from funded_elt.fx import FxRate
from funded_elt.pipeline import rate_window
from funded_elt.warehouse import EmptySnapshotError, ensure_raw_schema, replace_snapshot, upsert_fx_rates

TEST_DB = os.environ.get("WAREHOUSE_TEST_DB")
needs_postgres = pytest.mark.skipif(not TEST_DB, reason="set WAREHOUSE_TEST_DB to run warehouse tests")
STAMP = datetime(2026, 9, 14, tzinfo=timezone.utc)


@pytest.fixture
def conn():
    conninfo = make_conninfo(
        host=os.environ.get("WAREHOUSE_HOST", "localhost"),
        port=int(os.environ.get("WAREHOUSE_PORT", "5433")),
        user=os.environ.get("WAREHOUSE_USER", "funded"),
        password=os.environ.get("WAREHOUSE_PASSWORD", "funded"),
        dbname=TEST_DB,
    )
    with psycopg.connect(conninfo) as connection:
        connection.execute("drop schema if exists raw cascade")
        connection.commit()
        ensure_raw_schema(connection)
        yield connection


def _count(conn, table):
    return conn.execute(f"select count(*) from raw.{table}").fetchone()[0]


@needs_postgres
def test_reloading_the_same_rates_does_not_duplicate_them(conn):
    rows = [FxRate(date(2026, 9, 1), "CAD", "INR", 68.371), FxRate(date(2026, 9, 2), "CAD", "INR", 68.205)]

    upsert_fx_rates(conn, rows)
    upsert_fx_rates(conn, rows)

    assert _count(conn, "fx_rates") == 2


@needs_postgres
def test_a_corrected_rate_replaces_the_old_value(conn):
    upsert_fx_rates(conn, [FxRate(date(2026, 9, 1), "CAD", "INR", 68.0)])
    upsert_fx_rates(conn, [FxRate(date(2026, 9, 1), "CAD", "INR", 68.371)])

    assert float(conn.execute("select rate from raw.fx_rates").fetchone()[0]) == 68.371
    assert _count(conn, "fx_rates") == 1


@needs_postgres
def test_the_database_itself_refuses_a_non_positive_rate(conn):
    with pytest.raises(psycopg.errors.CheckViolation):
        upsert_fx_rates(conn, [FxRate(date(2026, 9, 1), "CAD", "INR", 0)])


@needs_postgres
def test_a_snapshot_mirrors_inserts_updates_and_deletes(conn):
    first = [("a1", {"direction": "AT_OR_ABOVE"}), ("a2", {"direction": "AT_OR_BELOW"}), ("a3", {"direction": "AT_OR_ABOVE"})]
    replace_snapshot(conn, "fx_alerts", first, STAMP)

    # a2 was deleted in the app, a3 changed, a4 is new.
    second = [("a1", {"direction": "AT_OR_ABOVE"}), ("a3", {"direction": "AT_OR_BELOW"}), ("a4", {"direction": "AT_OR_ABOVE"})]
    result = replace_snapshot(conn, "fx_alerts", second, STAMP)

    ids = [row[0] for row in conn.execute("select id from raw.app_fx_alerts order by id")]
    assert ids == ["a1", "a3", "a4"]
    assert conn.execute("select doc->>'direction' from raw.app_fx_alerts where id = 'a3'").fetchone()[0] == "AT_OR_BELOW"
    assert (result.upserted, result.deleted) == (3, 1)


@needs_postgres
def test_refuses_an_empty_snapshot_that_would_wipe_the_table(conn):
    replace_snapshot(conn, "users", [("u1", {"homeCurrency": "INR"})], STAMP)

    with pytest.raises(EmptySnapshotError):
        replace_snapshot(conn, "users", [], STAMP)

    assert _count(conn, "app_users") == 1
    replace_snapshot(conn, "users", [], STAMP, allow_empty=True)
    assert _count(conn, "app_users") == 0


@needs_postgres
def test_a_failed_snapshot_changes_nothing(conn):
    replace_snapshot(conn, "users", [("u1", {"homeCurrency": "INR"})], STAMP)

    def broken():
        yield ("u2", {"homeCurrency": "CNY"})
        raise RuntimeError("MongoDB connection dropped mid-extract")

    with pytest.raises(RuntimeError):
        replace_snapshot(conn, "users", broken(), STAMP)

    assert [row[0] for row in conn.execute("select id from raw.app_users")] == ["u1"]


def test_scheduled_runs_reload_a_lookback_window_ending_at_the_interval():
    assert rate_window(datetime(2026, 9, 14, 0, 0, tzinfo=timezone.utc), 7) == (date(2026, 9, 7), date(2026, 9, 14))


def test_manual_runs_without_an_interval_end_today():
    start, end = rate_window(None, 3)
    assert end == datetime.now(timezone.utc).date()
    assert (end - start).days == 3
