"""Settings read from the environment, so the same code runs under Airflow, in CI and from a terminal.

The warehouse is described by WAREHOUSE_* variables rather than one URL because dbt's profile
reads the same variables. One set of names means the loader and the transformations can never
point at different databases.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _symbols(raw: str) -> tuple[str, ...]:
    return tuple(code.strip().upper() for code in raw.split(",") if code.strip())


@dataclass(frozen=True)
class Settings:
    warehouse_host: str
    warehouse_port: int
    warehouse_user: str
    warehouse_password: str
    warehouse_db: str
    mongo_url: str
    fx_source_url: str
    fx_base: str
    fx_symbols: tuple[str, ...]
    fx_lookback_days: int

    @classmethod
    def from_env(cls) -> Settings:
        env = os.environ
        return cls(
            warehouse_host=env.get("WAREHOUSE_HOST", "localhost"),
            warehouse_port=int(env.get("WAREHOUSE_PORT", "5433")),
            warehouse_user=env.get("WAREHOUSE_USER", "funded"),
            warehouse_password=env.get("WAREHOUSE_PASSWORD", "funded"),
            warehouse_db=env.get("WAREHOUSE_DB", "warehouse"),
            mongo_url=env.get("MONGO_URL", "mongodb://localhost:27017/funded?replicaSet=rs0&directConnection=true"),
            fx_source_url=env.get("FX_SOURCE_URL", "https://api.frankfurter.dev/v1").rstrip("/"),
            fx_base=env.get("FX_BASE", "CAD").strip().upper(),
            # Home currencies of the largest groups of international students in Canada that the
            # ECB publishes. Nigeria's naira and Iran's rial are not in the ECB set.
            fx_symbols=_symbols(env.get("FX_SYMBOLS", "INR,CNY,PHP,KRW,USD")),
            # Re-read a week back on every run: the ECB occasionally publishes late, and an
            # idempotent load makes the overlap free.
            fx_lookback_days=int(env.get("FX_LOOKBACK_DAYS", "7")),
        )

    @property
    def warehouse_conninfo(self) -> str:
        from psycopg.conninfo import make_conninfo

        return make_conninfo(
            host=self.warehouse_host,
            port=self.warehouse_port,
            user=self.warehouse_user,
            password=self.warehouse_password,
            dbname=self.warehouse_db,
        )
