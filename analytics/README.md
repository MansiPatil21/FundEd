# FundEd analytics: Airflow, dbt and a PostgreSQL warehouse

A daily ELT pipeline that turns FundEd's operational data and the exchange rates it depends on into
a tested star schema for analysis.

```
                  Airflow DAG: funded_elt (@daily, retries 2)
  ┌──────────────────────────────┬──────────────────────────────────────────────────────────┐
  │ extract_load_fx_rates        │ Frankfurter (ECB rates) ──> raw.fx_rates                │
  │ extract_load_app_data        │ MongoDB (allowlisted fields) ──> raw.app_*  (JSONB)     │
  ├──────────────────────────────┴──────────────────────────────────────────────────────────┤
  │ dbt_source_freshness         fail the run if a source has stopped arriving            │
  │ dbt_build                    raw ──> staging views ──> marts tables, testing each model │
  └─────────────────────────────────────────────────────────────────────────────────────────┘
```

| Layer | Schema | What it holds |
| --- | --- | --- |
| Raw | `raw` | Data as it arrived: rates keyed by date and pair, app documents as JSONB |
| Staging | `staging` | One typed, renamed view per raw table, no business logic |
| Marts | `marts` | Star schema: `dim_date`, `dim_currency`, `fct_fx_rates`, `fct_fx_alerts`, `fct_work_shifts`, plus reporting tables |

The reporting tables answer questions the app itself cannot:

- `mart_rate_volatility`: monthly range and daily-move spread per currency pair
- `mart_weekly_alert_activity`: alerts created and fired each week, and how long firing took
- `mart_weekly_work_hours`: off-campus hours per student per week against their permit's cap

## Why ELT, and the decisions behind it

**Load raw, transform in SQL.** Application documents land as JSONB close to their source shape.
Every reshaping happens in dbt, where it is versioned, reviewed, tested and re-runnable. When a
definition changes, `dbt build` rebuilds history from raw instead of needing a re-extract.

**Idempotent loads.** Rates upsert on `(rate_date, base, quote)`, so re-running a day, or the
seven-day lookback every run re-reads to catch late ECB publications, changes nothing unless the
source corrected a value. Application collections are full snapshots applied in one transaction,
which also removes rows deleted in the app: a rate alert a student deleted does not live on in
the warehouse.

**Privacy by allowlist, enforced twice.** The MongoDB query projects only allowlisted fields, so
emails, names, password hashes, permit numbers and free-text labels never leave the database.
The extractor filters again, so a projection mistake still cannot leak a field.

**Fail loud on bad money data.** A non-positive or non-finite rate stops the load; the warehouse
also rejects it with a `CHECK` constraint. A missing day is a visible gap, but a wrong rate would
flow silently into every figure built on it. An empty extract for a table that already has rows
is refused too, since it is far likelier to be a wrong connection string than every student
deleting everything.

**Freshness before build.** A stalled source fails the run instead of dbt rebuilding yesterday's
numbers and passing every test.

**dbt in its own virtual environment.** Airflow pins its dependencies through a constraints file
and dbt pins overlapping ones. Separating them keeps both correct.

## What the first run on real data found

The first run against FundEd's own database failed one data test. Three alerts had apparently
fired about 30 hours before they were created. The data was right and the test was wrong.

FundEd stores `triggeredAt` as the observation time of the rate that satisfied an alert, and ECB
rates are stamped 15:00 UTC on their publication day. An alert created in the evening, and
already met by the newest rate, fires on its first check carrying that earlier timestamp. The
model now separates `trigger_rate_observed_at` from `fired_at`, flags `fired_on_first_check`, and
the test checks the real rule: a trigger can precede creation by no more than the age of the
newest published rate, and can never follow extraction. The sample data includes such an alert,
so CI covers the case.

The same run showed that retrying a failed data test only postpones the failure, by ten minutes
of retries in that case. Extraction keeps its retries for network blips; the dbt tasks have none.

## Running it

```bash
# From the repository root. MongoDB comes from the default profile.
docker compose up -d mongo
docker compose --profile analytics up -d --build warehouse airflow

# Airflow UI: http://localhost:8090 (local only: every visitor is an admin)
docker exec funded-airflow airflow dags test funded_elt       # one full run, in the foreground

# Backfill a longer rate history, then rebuild the models
docker exec funded-airflow python -m funded_elt fx --start 2026-01-01 --end 2026-09-14
docker exec funded-airflow sh -c 'cd /opt/airflow/dbt && /opt/airflow/dbt-venv/bin/dbt build --profiles-dir .'

# Query the marts
docker exec -it funded-warehouse psql -U funded -d warehouse -c 'select * from marts.mart_rate_volatility'
```

## Tests

```bash
cd analytics
uv venv .venv --python 3.13 && VIRTUAL_ENV=.venv uv pip install -r requirements-dev.txt
WAREHOUSE_PORT=5434 WAREHOUSE_TEST_DB=warehouse_test .venv/bin/python -m pytest
```

- **pytest** covers rate parsing and validation, the privacy allowlist, and, against a real
  PostgreSQL, idempotent reloads, snapshot deletes, the empty-snapshot guard, and rollback of a
  snapshot that fails partway.
- **dbt** tests every model: uniqueness and not-null keys, relationships between facts and
  dimensions, accepted values, and singular tests (one rate per pair per day, positive rates,
  shifts that end after they start, alerts that fire after creation).
- **CI** runs both on every push, building every dbt model and running its tests on sample data.

## Deliberate limits

- **Runs locally.** Airflow is too heavy for Render's free plan, so the pipeline runs through
  Docker Compose rather than alongside the deployed app.
- **Standalone Airflow.** One container with a SQLite metadata database. Production would run
  the scheduler, API server and workers separately on PostgreSQL with a Celery or Kubernetes
  executor.
- **Full snapshots for app data.** Right at this size. Larger collections would extract
  incrementally on an `updatedAt` watermark, which FundEd's models do not yet carry.
- **PostgreSQL, not Snowflake.** The SQL is standard enough to port, but it has only run on
  PostgreSQL.

## The same data on the Microsoft stack

[`infra/data`](../infra/data/README.md) carries the exchange-rate half of this pipeline on Azure:
Data Factory lands the ECB rates in a Data Lake Storage Gen2 raw zone, [an Apache Spark
job](spark/flatten_fx.py) explodes the nested payload into a curated table, Data Factory loads that
into Azure SQL, and Power BI reads the views. Airflow and dbt stay the pipeline of record here. The
Azure build does the same work with the tools a Microsoft shop uses, and the Spark job's tests run
in CI alongside these ones.
