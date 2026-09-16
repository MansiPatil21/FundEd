"""Flatten the raw ECB rate documents in the lake into a curated table, with Apache Spark.

The raw zone holds the API's own shape, which is nested and awkward to query:

    {"base": "EUR", "rates": {"2026-09-01": {"CAD": 1.58, "INR": 98.1}, ...}}

One row per date and currency is what everything downstream wants, so this job explodes the two
levels of map, validates the rates, and writes CSV to the curated zone for Data Factory to load
into Azure SQL.

Spark rather than pandas because the transformation is the same code whether the lake holds one
month or ten years of rates, and because the explode happens across the cluster rather than in
one process.

Run it (reads ADLS Gen2 directly over abfss):

    export LAKE_ACCOUNT=stfundedlakeXXXXX
    export LAKE_KEY="$(az storage account keys list -n $LAKE_ACCOUNT --query '[0].value' -o tsv)"
    python analytics/spark/flatten_fx.py

The account key is read from the environment and never stored. A production job would use a
managed identity instead, the way Data Factory does here.
"""

from __future__ import annotations

import os
import sys
import urllib.request
from pathlib import Path

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import DoubleType, MapType, StringType, StructField, StructType

RAW_CONTAINER = "raw"
CURATED_CONTAINER = "curated"
RATES_PATH = "fx_rates"

# Spark ships every dependency the ADLS driver needs except these two. Their versions match the
# Hadoop build PySpark 3.5 bundles, so mixing versions cannot happen.
JAR_CACHE = Path(os.environ.get("SPARK_JAR_CACHE", Path.home() / ".cache" / "funded-spark-jars"))
ADLS_JARS = (
    (
        "hadoop-azure-3.3.4.jar",
        "https://repo1.maven.org/maven2/org/apache/hadoop/hadoop-azure/3.3.4/hadoop-azure-3.3.4.jar",
    ),
    (
        "wildfly-openssl-1.0.7.Final.jar",
        "https://repo1.maven.org/maven2/org/wildfly/openssl/wildfly-openssl/1.0.7.Final/wildfly-openssl-1.0.7.Final.jar",
    ),
)


def adls_jars() -> str:
    """Local paths to the jars that teach Spark the abfss filesystem, fetched once and reused.

    Spark can resolve Maven coordinates itself, but that runs on every start and a single failed
    download stops the job before it reads a byte. Caching the jars makes a rerun offline-safe.
    """
    JAR_CACHE.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, url in ADLS_JARS:
        jar = JAR_CACHE / name
        if not jar.exists():
            print(f"fetching {name}")
            urllib.request.urlretrieve(url, jar)  # noqa: S310 - a pinned Maven Central URL
        paths.append(str(jar))
    return ",".join(paths)

# The API sends {"base": ..., "rates": {date: {currency: rate}}}. Declaring the schema rather than
# inferring it means a changed payload fails loudly instead of quietly producing null columns.
RAW_SCHEMA = StructType(
    [
        StructField("base", StringType(), nullable=False),
        StructField("start_date", StringType(), nullable=True),
        StructField("end_date", StringType(), nullable=True),
        StructField("rates", MapType(StringType(), MapType(StringType(), DoubleType())), nullable=False),
    ]
)


def build_session(account: str, key: str) -> SparkSession:
    """A local Spark session that can read and write ADLS Gen2 over abfss."""
    return (
        SparkSession.builder.appName("funded-flatten-fx")
        .master(os.environ.get("SPARK_MASTER", "local[*]"))
        .config("spark.jars", adls_jars())
        .config(f"fs.azure.account.auth.type.{account}.dfs.core.windows.net", "SharedKey")
        .config(f"fs.azure.account.key.{account}.dfs.core.windows.net", key)
        .config("spark.driver.bindAddress", "127.0.0.1")
        .config("spark.driver.host", "127.0.0.1")
        .config("spark.ui.enabled", "false")
        .getOrCreate()
    )


def flatten(raw: DataFrame) -> DataFrame:
    """One row per (date, base, quote), oldest first, with invalid rates rejected."""
    exploded = (
        raw.select("base", F.explode("rates").alias("rate_date", "by_currency"))
        .select("base", "rate_date", F.explode("by_currency").alias("quote_currency", "rate"))
        .select(
            F.to_date("rate_date").alias("rate_date"),
            F.upper("base").alias("base_currency"),
            F.upper("quote_currency").alias("quote_currency"),
            F.col("rate").cast("double").alias("rate"),
        )
    )

    # Money data: a wrong rate flows silently into every figure built on it, so a bad row stops the
    # job rather than being dropped quietly. Same rule the Airflow loader applies.
    invalid = exploded.filter(
        F.col("rate_date").isNull()
        | F.col("rate").isNull()
        | F.isnan("rate")
        | (F.col("rate") <= 0)
    )
    bad_rows = invalid.count()
    if bad_rows:
        sample = invalid.limit(3).collect()
        raise ValueError(f"{bad_rows} invalid rate rows in the raw zone, for example {sample}")

    return exploded.dropDuplicates(["rate_date", "base_currency", "quote_currency"]).orderBy(
        "rate_date", "quote_currency"
    )


def main() -> int:
    account = os.environ.get("LAKE_ACCOUNT")
    key = os.environ.get("LAKE_KEY")
    if not account or not key:
        print("set LAKE_ACCOUNT and LAKE_KEY first, see the docstring", file=sys.stderr)
        return 2

    spark = build_session(account, key)
    try:
        base = f"abfss://{{container}}@{account}.dfs.core.windows.net/{RATES_PATH}"
        raw = spark.read.schema(RAW_SCHEMA).json(base.format(container=RAW_CONTAINER))
        curated = flatten(raw)

        rows = curated.count()
        if rows == 0:
            print("the raw zone produced no rates, refusing to publish an empty table", file=sys.stderr)
            return 1

        # One file, because this is a small daily table and Data Factory reads a folder of parts
        # just as happily as one. Overwrite: the curated zone is derived, never the source of truth.
        (
            curated.coalesce(1)
            .write.mode("overwrite")
            .option("header", True)
            .csv(base.format(container=CURATED_CONTAINER))
        )

        span = curated.agg(F.min("rate_date"), F.max("rate_date")).collect()[0]
        pairs = curated.select("quote_currency").distinct().count()
        print(f"curated {rows} rates across {pairs} currency pairs, {span[0]} to {span[1]}")
        return 0
    finally:
        spark.stop()


if __name__ == "__main__":
    raise SystemExit(main())
