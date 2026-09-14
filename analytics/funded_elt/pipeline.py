"""The two load steps, callable from the Airflow DAG, the command line and tests alike."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import psycopg

from .app_data import ALLOWED_FIELDS, extract
from .config import Settings
from .fx import fetch_rates
from .warehouse import SnapshotResult, ensure_raw_schema, replace_snapshot, upsert_fx_rates


def rate_window(window_end: datetime | None, lookback_days: int) -> tuple[date, date]:
    """The inclusive date range a run should (re)load.

    Scheduled runs end at the run's data interval. Manual runs in Airflow 3 have no data
    interval, so they end today, in UTC, which is how the ECB dates its rates.
    """
    if lookback_days < 0:
        raise ValueError("lookback_days cannot be negative")
    end_day = (window_end or datetime.now(timezone.utc)).astimezone(timezone.utc).date()
    return end_day - timedelta(days=lookback_days), end_day


def load_fx_rates(settings: Settings, start: date, end: date) -> int:
    rows = fetch_rates(settings.fx_source_url, settings.fx_base, settings.fx_symbols, start, end)
    with psycopg.connect(settings.warehouse_conninfo) as conn:
        ensure_raw_schema(conn)
        return upsert_fx_rates(conn, rows)


def load_app_data(settings: Settings, extracted_at: datetime | None = None) -> dict[str, SnapshotResult]:
    from pymongo import MongoClient

    stamp = extracted_at or datetime.now(timezone.utc)
    client: MongoClient = MongoClient(settings.mongo_url, serverSelectionTimeoutMS=10_000)
    try:
        database = client.get_default_database()
        with psycopg.connect(settings.warehouse_conninfo) as conn:
            ensure_raw_schema(conn)
            return {
                collection: replace_snapshot(conn, collection, extract(database, collection), stamp)
                for collection in ALLOWED_FIELDS
            }
    finally:
        client.close()
