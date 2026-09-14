"""Loads raw data into the PostgreSQL warehouse's `raw` schema. dbt reads from there.

This is the L of ELT: data lands close to its source shape, with application documents kept as
JSONB, and every reshaping happens later in SQL where it is versioned, tested and re-runnable.

Both loads are idempotent. Rates upsert on their natural key, so re-running a day or a week
changes nothing unless the source corrected a value. Application collections are loaded as full
snapshots that also remove rows deleted in the app, so a rate alert a student deleted does not
live on in the warehouse.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg
from psycopg import sql

from .app_data import ALLOWED_FIELDS
from .fx import FxRate

_RAW_DDL = """
create schema if not exists raw;

create table if not exists raw.fx_rates (
    rate_date      date           not null,
    base_currency  char(3)        not null,
    quote_currency char(3)        not null,
    rate           numeric(20, 8) not null check (rate > 0),
    loaded_at      timestamptz    not null default now(),
    primary key (rate_date, base_currency, quote_currency)
);
"""


class EmptySnapshotError(RuntimeError):
    """An extract returned nothing for a table that already has rows."""


@dataclass(frozen=True)
class SnapshotResult:
    collection: str
    upserted: int
    deleted: int


def app_table(collection: str) -> sql.Identifier:
    # Table names come only from the allowlist, never from input, and are quoted regardless.
    if collection not in ALLOWED_FIELDS:
        raise KeyError(f"no warehouse table for collection {collection!r}")
    return sql.Identifier("raw", f"app_{collection}")


def ensure_raw_schema(conn: psycopg.Connection[Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(_RAW_DDL)
        for collection in ALLOWED_FIELDS:
            cur.execute(
                sql.SQL(
                    "create table if not exists {} ("
                    " id text primary key,"
                    " doc jsonb not null,"
                    " extracted_at timestamptz not null)"
                ).format(app_table(collection))
            )
    conn.commit()


def upsert_fx_rates(conn: psycopg.Connection[Any], rows: Sequence[FxRate]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into raw.fx_rates (rate_date, base_currency, quote_currency, rate, loaded_at)
            values (%s, %s, %s, %s, now())
            on conflict (rate_date, base_currency, quote_currency)
            do update set rate = excluded.rate, loaded_at = excluded.loaded_at
            """,
            [(row.rate_date, row.base_currency, row.quote_currency, row.rate) for row in rows],
        )
    conn.commit()
    return len(rows)


def replace_snapshot(
    conn: psycopg.Connection[Any],
    collection: str,
    records: Iterable[tuple[str, dict[str, Any]]],
    extracted_at: datetime,
    allow_empty: bool = False,
) -> SnapshotResult:
    """Makes the raw table match `records` exactly, in one transaction.

    An empty extract for a table that already holds rows is refused unless `allow_empty`: it is
    far more likely to be a wrong connection string or an outage than every student deleting
    everything, and applying it would wipe the table.
    """
    table = app_table(collection)
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("create temp table incoming (id text primary key, doc jsonb not null) on commit drop")
        with cur.copy("copy incoming (id, doc) from stdin") as copy:
            for identifier, record in records:
                copy.write_row((identifier, json.dumps(record, separators=(",", ":"))))

        cur.execute("select count(*) from incoming")
        incoming = cur.fetchone()[0]
        if incoming == 0 and not allow_empty:
            cur.execute(sql.SQL("select exists (select 1 from {})").format(table))
            if cur.fetchone()[0]:
                raise EmptySnapshotError(f"extract of {collection} returned no documents but the warehouse holds some")

        cur.execute(
            sql.SQL(
                "insert into {table} (id, doc, extracted_at) select id, doc, %s from incoming "
                "on conflict (id) do update set doc = excluded.doc, extracted_at = excluded.extracted_at"
            ).format(table=table),
            (extracted_at,),
        )
        upserted = cur.rowcount
        cur.execute(
            sql.SQL("delete from {table} t where not exists (select 1 from incoming i where i.id = t.id)").format(table=table)
        )
        deleted = cur.rowcount
    return SnapshotResult(collection, upserted, deleted)
