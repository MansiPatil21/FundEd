"""Command line for running a load outside Airflow.

    python -m funded_elt fx --start 2026-01-01 --end 2026-09-14   # backfill rates
    python -m funded_elt app                                      # snapshot app data
    python -m funded_elt fixtures tests/fixtures/sample_raw.json  # sample data, for CI and demos
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path

import psycopg

from .config import Settings
from .fx import FxRate
from .pipeline import load_app_data, load_fx_rates, rate_window
from .warehouse import ensure_raw_schema, replace_snapshot, upsert_fx_rates


def load_fixtures(settings: Settings, path: Path) -> dict[str, int]:
    data = json.loads(path.read_text())
    counts: dict[str, int] = {}
    with psycopg.connect(settings.warehouse_conninfo) as conn:
        ensure_raw_schema(conn)
        rates = [FxRate(date.fromisoformat(r["rate_date"]), r["base"], r["quote"], r["rate"]) for r in data["fx_rates"]]
        counts["fx_rates"] = upsert_fx_rates(conn, rates)
        stamp = datetime.now(timezone.utc)
        for collection, documents in data["app"].items():
            records = [(document["id"], {k: v for k, v in document.items() if k != "id"}) for document in documents]
            counts[collection] = replace_snapshot(conn, collection, records, stamp).upserted
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(prog="funded_elt")
    commands = parser.add_subparsers(dest="command", required=True)
    fx = commands.add_parser("fx", help="load exchange rates for a date window")
    fx.add_argument("--start", type=date.fromisoformat)
    fx.add_argument("--end", type=date.fromisoformat)
    commands.add_parser("app", help="snapshot FundEd's application data from MongoDB")
    fixtures = commands.add_parser("fixtures", help="load a sample raw data file")
    fixtures.add_argument("path", type=Path)
    args = parser.parse_args()

    settings = Settings.from_env()
    if args.command == "fx":
        default_start, default_end = rate_window(None, settings.fx_lookback_days)
        start, end = args.start or default_start, args.end or default_end
        print(f"loaded {load_fx_rates(settings, start, end)} rates for {start}..{end}")
    elif args.command == "app":
        for result in load_app_data(settings).values():
            print(f"{result.collection}: {result.upserted} upserted, {result.deleted} deleted")
    else:
        print(json.dumps(load_fixtures(settings, args.path)))


if __name__ == "__main__":
    main()
