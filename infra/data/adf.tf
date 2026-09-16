// Azure Data Factory: the orchestration layer.
//
//   pl_land_raw_rates      ECB reference rates (REST)  ->  raw zone, exactly as sent
//   [ Spark job ]          raw JSON  ->  curated CSV   (analytics/spark/flatten_fx.py)
//   pl_load_curated_to_sql curated zone  ->  Azure SQL, the table Power BI reads
//
// Two pipelines rather than one, because the Spark step runs between them. Data Factory reaches
// the lake and the database with its own managed identity, so no key or password exists anywhere.

resource "azurerm_data_factory" "main" {
  name                = "adf-${local.name}-${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.data.name
  location            = azurerm_resource_group.data.location
  tags                = local.tags

  identity {
    type = "SystemAssigned"
  }
}

resource "azurerm_role_assignment" "adf_lake_contributor" {
  scope                = azurerm_storage_account.lake.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_data_factory.main.identity[0].principal_id
}

# ---------------------------------------------------------------------------
# Linked services: where data comes from and goes to
# ---------------------------------------------------------------------------

resource "azurerm_data_factory_linked_custom_service" "ecb_rates" {
  name            = "ls_ecb_rates"
  data_factory_id = azurerm_data_factory.main.id
  type            = "RestService"
  description     = "Frankfurter, which republishes the European Central Bank's daily reference rates. Public data, so anonymous."

  type_properties_json = jsonencode({
    url                               = "https://api.frankfurter.dev/"
    enableServerCertificateValidation = true
    authenticationType                = "Anonymous"
  })
}

resource "azurerm_data_factory_linked_service_data_lake_storage_gen2" "lake" {
  name                 = "ls_data_lake"
  data_factory_id      = azurerm_data_factory.main.id
  url                  = azurerm_storage_account.lake.primary_dfs_endpoint
  use_managed_identity = true
}

resource "azurerm_data_factory_linked_service_azure_sql_database" "warehouse" {
  name                 = "ls_sql_warehouse"
  data_factory_id      = azurerm_data_factory.main.id
  use_managed_identity = true

  connection_string = join(";", [
    "Server=tcp:${azurerm_mssql_server.main.fully_qualified_domain_name},1433",
    "Initial Catalog=${azurerm_mssql_database.warehouse.name}",
    "Encrypt=True",
    "TrustServerCertificate=False",
    "Connection Timeout=60",
  ])
}

# ---------------------------------------------------------------------------
# Datasets: the shape of the data at each hop
# ---------------------------------------------------------------------------

resource "azurerm_data_factory_custom_dataset" "rest_rates" {
  name            = "ds_ecb_rates_rest"
  data_factory_id = azurerm_data_factory.main.id
  type            = "RestResource"

  linked_service {
    name = azurerm_data_factory_linked_custom_service.ecb_rates.name
  }

  # The pipeline supplies the date window, so one dataset serves a daily run and a backfill.
  parameters = {
    relativeUrl = ""
  }

  type_properties_json = jsonencode({
    relativeUrl = "@dataset().relativeUrl"
  })
}

resource "azurerm_data_factory_custom_dataset" "raw_rates" {
  name            = "ds_raw_rates_json"
  data_factory_id = azurerm_data_factory.main.id
  type            = "Json"

  linked_service {
    name = azurerm_data_factory_linked_service_data_lake_storage_gen2.lake.name
  }

  parameters = {
    fileName = ""
  }

  type_properties_json = jsonencode({
    location = {
      type       = "AzureBlobFSLocation"
      fileSystem = azurerm_storage_data_lake_gen2_filesystem.raw.name
      folderPath = "fx_rates"
      fileName   = "@dataset().fileName"
    }
  })
}

resource "azurerm_data_factory_custom_dataset" "curated_rates" {
  name            = "ds_curated_rates_csv"
  data_factory_id = azurerm_data_factory.main.id
  type            = "DelimitedText"

  linked_service {
    name = azurerm_data_factory_linked_service_data_lake_storage_gen2.lake.name
  }

  # Spark writes a directory of part files, so the dataset points at the folder, not one file.
  type_properties_json = jsonencode({
    location = {
      type       = "AzureBlobFSLocation"
      fileSystem = azurerm_storage_data_lake_gen2_filesystem.curated.name
      folderPath = "fx_rates"
    }
    columnDelimiter  = ","
    escapeChar       = "\\"
    quoteChar        = "\""
    firstRowAsHeader = true
  })
}

resource "azurerm_data_factory_dataset_azure_sql_table" "fx_rates" {
  name              = "ds_sql_fx_rates"
  data_factory_id   = azurerm_data_factory.main.id
  linked_service_id = azurerm_data_factory_linked_service_azure_sql_database.warehouse.id
  schema            = "dbo"
  table             = "fx_rates"
}

# ---------------------------------------------------------------------------
# Pipelines
# ---------------------------------------------------------------------------

resource "azurerm_data_factory_pipeline" "land_raw_rates" {
  name            = "pl_land_raw_rates"
  data_factory_id = azurerm_data_factory.main.id
  description     = "Copies a window of ECB reference rates into the raw zone, unchanged."

  parameters = {
    start   = "2026-08-17"
    end     = "2026-09-16"
    base    = var.fx_base
    symbols = var.fx_symbols
  }

  activities_json = jsonencode([
    {
      name = "CopyRatesToRawZone"
      type = "Copy"
      policy = {
        timeout = "00:20:00"
        retry   = 2
      }
      inputs = [{
        referenceName = azurerm_data_factory_custom_dataset.rest_rates.name
        type          = "DatasetReference"
        parameters = {
          relativeUrl = "@concat('v1/', pipeline().parameters.start, '..', pipeline().parameters.end, '?base=', pipeline().parameters.base, '&symbols=', pipeline().parameters.symbols)"
        }
      }]
      outputs = [{
        referenceName = azurerm_data_factory_custom_dataset.raw_rates.name
        type          = "DatasetReference"
        parameters = {
          fileName = "@concat('rates_', pipeline().parameters.start, '_', pipeline().parameters.end, '.json')"
        }
      }]
      typeProperties = {
        source = {
          type               = "RestSource"
          requestMethod      = "GET"
          httpRequestTimeout = "00:01:40"
          requestInterval    = "00.00:00:00.010"
        }
        sink = {
          type = "JsonSink"
          storeSettings = {
            type = "AzureBlobFSWriteSettings"
          }
          formatSettings = {
            type        = "JsonWriteSettings"
            filePattern = "setOfObjects"
          }
        }
      }
    }
  ])
}

resource "azurerm_data_factory_pipeline" "load_curated_to_sql" {
  name            = "pl_load_curated_to_sql"
  data_factory_id = azurerm_data_factory.main.id
  description     = "Loads the curated rates Spark produced into Azure SQL, replacing the table contents."

  activities_json = jsonencode([
    {
      name = "CopyCuratedToSql"
      type = "Copy"
      policy = {
        timeout = "00:20:00"
        retry   = 2
      }
      inputs = [{
        referenceName = azurerm_data_factory_custom_dataset.curated_rates.name
        type          = "DatasetReference"
      }]
      outputs = [{
        referenceName = azurerm_data_factory_dataset_azure_sql_table.fx_rates.name
        type          = "DatasetReference"
      }]
      typeProperties = {
        source = {
          type = "DelimitedTextSource"
          storeSettings = {
            type      = "AzureBlobFSReadSettings"
            recursive = true
            # Spark also writes _SUCCESS and checksum files, which are not data.
            wildcardFolderPath = "fx_rates"
            wildcardFileName   = "*.csv"
          }
          formatSettings = {
            type = "DelimitedTextReadSettings"
          }
        }
        sink = {
          type          = "AzureSqlSink"
          writeBehavior = "insert"
          # The curated zone is the whole picture each run, so the table is replaced rather than
          # appended to. Re-running the pipeline twice leaves the same rows.
          preCopyScript = "DELETE FROM dbo.fx_rates"
          tableOption   = "none"
        }
        translator = {
          type = "TabularTranslator"
          mappings = [
            { source = { name = "rate_date", type = "String" }, sink = { name = "rate_date", type = "DateTime" } },
            { source = { name = "base_currency", type = "String" }, sink = { name = "base_currency", type = "String" } },
            { source = { name = "quote_currency", type = "String" }, sink = { name = "quote_currency", type = "String" } },
            { source = { name = "rate", type = "String" }, sink = { name = "rate", type = "Decimal" } },
          ]
        }
      }
    }
  ])
}

# Daily at 06:00, but left switched off: this subscription is a student one, and an unattended
# schedule is how a free credit disappears. Switch it on in the portal or set activated = true.
resource "azurerm_data_factory_trigger_schedule" "daily_rates" {
  name            = "tr_daily_rates"
  data_factory_id = azurerm_data_factory.main.id
  pipeline_name   = azurerm_data_factory_pipeline.land_raw_rates.name
  frequency       = "Day"
  interval        = 1
  time_zone       = "Atlantic Standard Time"
  activated       = false
}
