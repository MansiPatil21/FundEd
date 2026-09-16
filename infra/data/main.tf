locals {
  name = "funded-${var.environment}"

  tags = {
    project     = "funded"
    environment = var.environment
    managed_by  = "terraform"
    repository  = var.github_repository
  }
}

data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 6
  lower   = true
  numeric = true
  special = false
  upper   = false
}

resource "azurerm_resource_group" "data" {
  name     = "rg-${local.name}-data"
  location = var.location
  tags     = local.tags
}

# ---------------------------------------------------------------------------
# Azure Data Lake Storage Gen2: raw as it arrived, curated after Spark
# ---------------------------------------------------------------------------

resource "azurerm_storage_account" "lake" {
  name                            = "stfundedlake${random_string.suffix.result}"
  resource_group_name             = azurerm_resource_group.data.name
  location                        = azurerm_resource_group.data.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  account_kind                    = "StorageV2"
  is_hns_enabled                  = true # what makes it Data Lake Storage Gen2 rather than blob
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  tags                            = local.tags

  blob_properties {
    delete_retention_policy {
      days = 7
    }
  }
}

# Two zones, because raw and curated have different contracts: raw is whatever the source sent and
# is never edited, curated is the shape the warehouse and reports depend on.
resource "azurerm_storage_data_lake_gen2_filesystem" "raw" {
  name               = "raw"
  storage_account_id = azurerm_storage_account.lake.id
}

resource "azurerm_storage_data_lake_gen2_filesystem" "curated" {
  name               = "curated"
  storage_account_id = azurerm_storage_account.lake.id
}

# The deploying user reads and writes the lake directly, which the Spark job needs.
resource "azurerm_role_assignment" "admin_lake_contributor" {
  scope                = azurerm_storage_account.lake.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.sql_admin_object_id
}

# ---------------------------------------------------------------------------
# Azure SQL Database: the serving layer Power BI reads
# ---------------------------------------------------------------------------

resource "azurerm_mssql_server" "main" {
  name                          = "sql-${local.name}-${random_string.suffix.result}"
  resource_group_name           = azurerm_resource_group.data.name
  location                      = azurerm_resource_group.data.location
  version                       = "12.0"
  minimum_tls_version           = "1.2"
  public_network_access_enabled = true
  tags                          = local.tags

  # No SQL logins at all: every connection authenticates with Microsoft Entra ID, so there is no
  # password to store, rotate or leak.
  azuread_administrator {
    login_username              = var.sql_admin_login
    object_id                   = var.sql_admin_object_id
    tenant_id                   = data.azurerm_client_config.current.tenant_id
    azuread_authentication_only = true
  }
}

resource "azurerm_mssql_database" "warehouse" {
  name      = "sqldb-funded-analytics"
  server_id = azurerm_mssql_server.main.id

  # Serverless: bills per second while awake and pauses after an hour idle, which suits a pipeline
  # that runs daily and a report opened now and then.
  sku_name                    = "GP_S_Gen5_1"
  min_capacity                = 0.5
  auto_pause_delay_in_minutes = 60
  max_size_gb                 = 2
  storage_account_type        = "Local"
  zone_redundant              = false
  collation                   = "SQL_Latin1_General_CP1_CI_AS"
  tags                        = local.tags
}

# Azure services, which is how Data Factory reaches the database.
resource "azurerm_mssql_firewall_rule" "azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_mssql_firewall_rule" "client" {
  count            = var.client_ip == "" ? 0 : 1
  name             = "AllowDeployerMachine"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = var.client_ip
  end_ip_address   = var.client_ip
}
