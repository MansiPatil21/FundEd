output "resource_group" {
  description = "Resource group holding the analytics platform."
  value       = azurerm_resource_group.data.name
}

output "lake_account_name" {
  description = "Data Lake Storage Gen2 account. The Spark job reads raw and writes curated here."
  value       = azurerm_storage_account.lake.name
}

output "lake_dfs_endpoint" {
  description = "Data Lake filesystem endpoint."
  value       = azurerm_storage_account.lake.primary_dfs_endpoint
}

output "data_factory_name" {
  description = "Azure Data Factory instance."
  value       = azurerm_data_factory.main.name
}

output "data_factory_principal_id" {
  description = "Data Factory's managed identity, which needs a contained user in the SQL database."
  value       = azurerm_data_factory.main.identity[0].principal_id
}

output "sql_server_fqdn" {
  description = "Azure SQL server address, for sqlcmd and Power BI."
  value       = azurerm_mssql_server.main.fully_qualified_domain_name
}

output "sql_database_name" {
  description = "Azure SQL database the pipeline loads and Power BI reads."
  value       = azurerm_mssql_database.warehouse.name
}
