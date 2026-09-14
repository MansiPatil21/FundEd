"""
### FundEd ELT

Daily: extract exchange rates and FundEd's application data, load both into the PostgreSQL
warehouse's `raw` schema, check the raw data is fresh, then let dbt build and test the staging
views and the star schema.

```
extract_load_fx_rates ─┐
                       ├─> dbt_source_freshness ─> dbt_build
extract_load_app_data ─┘
```

Freshness runs before the build so a stalled source fails the run loudly instead of dbt
rebuilding yesterday's numbers and passing every test. `dbt build` runs each model's tests right
after the model, so a failing test stops everything downstream of it.
"""

from __future__ import annotations

from datetime import timedelta

import pendulum
from airflow.providers.standard.operators.bash import BashOperator
from airflow.sdk import dag, task

DBT = "cd /opt/airflow/dbt && /opt/airflow/dbt-venv/bin/dbt"


@dag(
    dag_id="funded_elt",
    schedule="@daily",
    start_date=pendulum.datetime(2026, 9, 1, tz="UTC"),
    catchup=False,
    max_active_runs=1,
    default_args={"retries": 2, "retry_delay": timedelta(minutes=5)},
    tags=["funded", "elt"],
    doc_md=__doc__,
)
def funded_elt():
    @task
    def extract_load_fx_rates(**context) -> int:
        from funded_elt.config import Settings
        from funded_elt.pipeline import load_fx_rates, rate_window

        settings = Settings.from_env()
        start, end = rate_window(context.get("data_interval_end"), settings.fx_lookback_days)
        return load_fx_rates(settings, start, end)

    @task
    def extract_load_app_data() -> dict[str, dict[str, int]]:
        from funded_elt.config import Settings
        from funded_elt.pipeline import load_app_data

        results = load_app_data(Settings.from_env())
        return {name: {"upserted": r.upserted, "deleted": r.deleted} for name, r in results.items()}

    # No retries for dbt. Retries exist for transient failures, such as a network blip while
    # extracting. A failed data test or a stale source fails identically on every attempt, so
    # retrying only delays the alert: the first run on real data spent ten minutes retrying one.
    freshness = BashOperator(task_id="dbt_source_freshness", bash_command=f"{DBT} source freshness --profiles-dir .", retries=0)
    build = BashOperator(task_id="dbt_build", bash_command=f"{DBT} build --profiles-dir .", retries=0)

    [extract_load_fx_rates(), extract_load_app_data()] >> freshness >> build


funded_elt()
