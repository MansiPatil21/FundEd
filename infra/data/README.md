# FundEd analytics platform on Azure

The Microsoft data stack, end to end, for the exchange-rate data FundEd already depends on.

```
  ECB reference rates (REST)
            │  Azure Data Factory  ·  pl_land_raw_rates
            ▼
  ADLS Gen2  raw/fx_rates/*.json          exactly as the API sent it
            │  Apache Spark  ·  analytics/spark/flatten_fx.py
            ▼
  ADLS Gen2  curated/fx_rates/*.csv       one row per date and currency pair
            │  Azure Data Factory  ·  pl_load_curated_to_sql
            ▼
  Azure SQL  dbo.fx_rates                 serving layer
            │
            ▼
  Power BI   dbo.vw_fx_rates_daily, dbo.vw_rate_volatility_monthly
```

| Piece | What it does | Why it is here and not somewhere else |
| --- | --- | --- |
| **Azure Data Factory** | Two pipelines: REST to the lake, curated to SQL. A daily trigger, left switched off. | Copy work with retries, monitoring and a schedule, without code to maintain. |
| **ADLS Gen2** | `raw` holds what arrived, `curated` holds what downstream depends on. | Hierarchical namespace, so folders behave like folders. Raw is never edited, so a definition change replays from it. |
| **Apache Spark** | Explodes the API's nested `{date: {currency: rate}}` into rows, validates, writes CSV. | The same code whether the lake holds one month or ten years, and the explode runs across the cluster. |
| **Azure SQL Database** | Serverless, the table and views a report reads. | Pauses after an hour idle, so a student subscription is not billed for a database nobody is querying. |
| **Power BI** | Connects to the views, not the table. | The report stays valid when the table's shape changes. |

## Security

- **No passwords anywhere.** The SQL server allows Microsoft Entra ID authentication only
  (`azuread_authentication_only = true`). Data Factory reaches the lake and the database with its
  own managed identity, and gets a contained SQL user with `db_datareader` and `db_datawriter`, so
  the pipeline can move rows but cannot change the schema.
- **Firewall.** Azure services, plus the deploying machine's own IP, and nothing else.
- The Spark job is the one exception: running locally, it reads the lake with an account key taken
  from the environment at run time. In a cluster it would use a managed identity like everything else.

## Run it

```bash
infra/data/deploy.sh                      # infrastructure, schema, both pipelines, Spark, verification
infra/data/deploy.sh --skip-infra         # same without Terraform
infra/data/deploy.sh --start 2026-01-01 --end 2026-09-16   # backfill a wider window
```

Costs: serverless SQL bills per second while awake and pauses after an hour, the lake holds a few
hundred kilobytes, and Data Factory charges per activity run. To stop all of it:

```bash
terraform -chdir=infra/data destroy
```

## Power BI

1. Power BI Desktop (Windows) or the service at app.powerbi.com.
2. Get data, Azure SQL Database. Server and database come from `terraform -chdir=infra/data output`.
3. Sign in with a Microsoft account, the same one that administers the server.
4. Import `dbo.vw_fx_rates_daily` and `dbo.vw_rate_volatility_monthly`. Both already carry the
   derived columns a report needs, so no DAX is required for a first chart.

## Tests

`analytics/tests/test_flatten_fx.py` covers the Spark transformation: both levels of the nested
payload exploded, currencies upper-cased, duplicates collapsed, ordering, and a rate that cannot be
true stopping the job instead of being dropped.
