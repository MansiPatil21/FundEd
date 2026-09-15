output "resource_group" {
  value = azurerm_resource_group.main.name
}

output "container_app_name" {
  value = azurerm_container_app.optimizer.name
}

output "optimizer_url" {
  value = "https://${azurerm_container_app.optimizer.ingress[0].fqdn}"
}

output "acr_login_server" {
  value = azurerm_container_registry.main.login_server
}

output "acr_name" {
  value = azurerm_container_registry.main.name
}

output "key_vault_name" {
  value = azurerm_key_vault.main.name
}

# The three values GitHub Actions needs to sign in with OIDC. None of them is a secret.
output "github_azure_client_id" {
  value = azurerm_user_assigned_identity.deploy.client_id
}

output "github_azure_tenant_id" {
  value = data.azurerm_client_config.current.tenant_id
}

output "github_azure_subscription_id" {
  value = var.subscription_id
}

output "github_terraform_plan_client_id" {
  value = azurerm_user_assigned_identity.terraform_plan.client_id
}

output "github_terraform_apply_client_id" {
  value = azurerm_user_assigned_identity.terraform_apply.client_id
}
