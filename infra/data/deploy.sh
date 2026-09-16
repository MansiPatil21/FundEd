#!/usr/bin/env bash
# Builds and runs the whole analytics platform, end to end:
#
#   1. Terraform    Data Lake Storage Gen2, Azure SQL Database, Azure Data Factory
#   2. sqlcmd       table, reporting views, and a contained user for Data Factory's identity
#   3. ADF run      ECB reference rates (REST)  ->  raw zone
#   4. Spark        raw JSON  ->  curated CSV   (analytics/spark/flatten_fx.py)
#   5. ADF run      curated zone  ->  Azure SQL
#   6. Verify       row count and date span straight out of the database
#
# Usage: infra/data/deploy.sh [--skip-infra] [--start YYYY-MM-DD] [--end YYYY-MM-DD]
#
# Needs: az (signed in), terraform, sqlcmd, and a Python with pyspark on PATH as $PYSPARK_PYTHON
# or a local .venv. Costs: serverless SQL pauses after an hour idle, the lake holds a few hundred
# kilobytes, and Data Factory charges per activity run. Destroy with `terraform -chdir=infra/data destroy`.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
here="$root/infra/data"

skip_infra=false
start_date="$(date -u -v-30d +%F 2>/dev/null || date -u -d '30 days ago' +%F)"
end_date="$(date -u +%F)"

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-infra) skip_infra=true; shift ;;
    --start) start_date="$2"; shift 2 ;;
    --end) end_date="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

TF_VAR_subscription_id="${TF_VAR_subscription_id:-$(az account show --query id -o tsv)}"
TF_VAR_client_ip="${TF_VAR_client_ip:-$(curl -sS -4 --max-time 15 https://api.ipify.org)}"
export TF_VAR_subscription_id TF_VAR_client_ip

echo "== 1/6 Infrastructure"
terraform -chdir="$here" init -input=false -reconfigure \
  -backend-config="$root/infra/azure/backend.hcl" -backend-config="key=funded-data.tfstate" >/dev/null
if [ "$skip_infra" = false ]; then
  terraform -chdir="$here" apply -input=false -auto-approve
fi

lake="$(terraform -chdir="$here" output -raw lake_account_name)"
adf="$(terraform -chdir="$here" output -raw data_factory_name)"
rg="$(terraform -chdir="$here" output -raw resource_group)"
sql_server="$(terraform -chdir="$here" output -raw sql_server_fqdn)"
sql_db="$(terraform -chdir="$here" output -raw sql_database_name)"

echo "== 2/6 Database schema and Data Factory's contained user"
sqlcmd -S "$sql_server" -d "$sql_db" --authentication-method ActiveDirectoryDefault \
  -v adf_name="$adf" -i "$here/sql/schema.sql"

echo "== 3/6 Data Factory: ECB rates $start_date to $end_date into the raw zone"
run_pipeline() {
  local pipeline="$1" params="${2:-}"
  local run_id args=(--resource-group "$rg" --factory-name "$adf" --name "$pipeline")
  # Only pass --parameters when there are some: the CLI rejects an empty JSON object.
  [ -n "$params" ] && args+=(--parameters "$params")
  run_id="$(az datafactory pipeline create-run "${args[@]}" --query runId -o tsv)"
  for _ in $(seq 1 60); do
    local status
    status="$(az datafactory pipeline-run show --resource-group "$rg" --factory-name "$adf" \
      --run-id "$run_id" --query status -o tsv)"
    case "$status" in
      Succeeded) echo "   $pipeline succeeded ($run_id)"; return 0 ;;
      Failed|Cancelled)
        echo "   $pipeline $status" >&2
        az datafactory activity-run query-by-pipeline-run --resource-group "$rg" --factory-name "$adf" \
          --run-id "$run_id" --last-updated-after "1970-01-01" --last-updated-before "2100-01-01" \
          --query "value[].{activity:activityName,status:status,error:error.message}" -o tsv >&2
        return 1 ;;
    esac
    sleep 10
  done
  echo "   $pipeline did not finish in 10 minutes" >&2
  return 1
}

run_pipeline pl_land_raw_rates "{\"start\":\"$start_date\",\"end\":\"$end_date\"}"

echo "== 4/6 Spark: flatten the raw zone into curated"
LAKE_ACCOUNT="$lake"
LAKE_KEY="$(az storage account keys list --account-name "$lake" --resource-group "$rg" --query '[0].value' -o tsv)"
export LAKE_ACCOUNT LAKE_KEY
python="${PYSPARK_PYTHON:-$root/.venv/bin/python}"
PYSPARK_DRIVER_PYTHON="$python" PYSPARK_PYTHON="$python" SPARK_LOCAL_IP=127.0.0.1 \
  "$python" "$root/analytics/spark/flatten_fx.py"
unset LAKE_KEY

echo "== 5/6 Data Factory: curated zone into Azure SQL"
run_pipeline pl_load_curated_to_sql

echo "== 6/6 What landed in the database"
sqlcmd -S "$sql_server" -d "$sql_db" --authentication-method ActiveDirectoryDefault -Q \
  "SET NOCOUNT ON;
   SELECT COUNT(*) AS rows_loaded, COUNT(DISTINCT quote_currency) AS pairs,
          MIN(rate_date) AS first_date, MAX(rate_date) AS last_date FROM dbo.fx_rates;
   SELECT TOP 3 currency_pair, rate_month, observations, rate_range FROM dbo.vw_rate_volatility_monthly
   ORDER BY rate_month DESC, currency_pair;"

echo
echo "Power BI: connect to $sql_server, database $sql_db, view dbo.vw_fx_rates_daily, Microsoft account sign-in."
