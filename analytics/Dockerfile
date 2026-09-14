# Airflow with FundEd's extract-load package, the DAG and the dbt project.
#
# dbt lives in its own virtual environment. Airflow pins hundreds of packages through its
# constraints file and dbt pins overlapping ones, so installing both into one environment either
# breaks Airflow or quietly swaps dbt's dependencies. The DAG calls the venv's dbt binary.
FROM apache/airflow:3.3.1-python3.12

ARG AIRFLOW_VERSION=3.3.1
ARG PYTHON_VERSION=3.12

# Listing apache-airflow with its exact version stops pip from upgrading or downgrading Airflow
# while it resolves the extra packages, which is what Airflow's image docs recommend.
RUN pip install --no-cache-dir \
      "apache-airflow==${AIRFLOW_VERSION}" pymongo "psycopg[binary]" \
      --constraint "https://raw.githubusercontent.com/apache/airflow/constraints-${AIRFLOW_VERSION}/constraints-${PYTHON_VERSION}.txt"

COPY requirements-dbt.txt /tmp/requirements-dbt.txt
RUN python -m venv /opt/airflow/dbt-venv \
 && /opt/airflow/dbt-venv/bin/pip install --no-cache-dir -r /tmp/requirements-dbt.txt

ENV PYTHONPATH=/opt/airflow/lib \
    AIRFLOW__CORE__LOAD_EXAMPLES=False

COPY --chown=airflow:root funded_elt /opt/airflow/lib/funded_elt
COPY --chown=airflow:root dags /opt/airflow/dags
COPY --chown=airflow:root dbt /opt/airflow/dbt
