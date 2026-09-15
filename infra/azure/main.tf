data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

locals {
  suffix = random_string.suffix.result
  tags = {
    project     = "funded"
    environment = var.environment
    managed_by  = "terraform"
    # Where the configuration lives, so anyone who finds a resource in the portal can trace it back.
    repository = var.github_repository
  }
}

resource "azurerm_resource_group" "main" {
  name     = "rg-funded-${var.environment}"
  location = var.location
  tags     = local.tags
}

# ---- Observability ---------------------------------------------------------------------------

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-funded-${var.environment}-${local.suffix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  # A hard daily cap, so a noisy revision cannot run up a bill on a student subscription.
  daily_quota_gb = 0.5
  tags           = local.tags
}

# ---- Registry and runtime identity -----------------------------------------------------------

resource "azurerm_container_registry" "main" {
  name                = "acrfunded${var.environment}${local.suffix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "Basic"
  # No admin user: images are pulled with a managed identity and pushed with OIDC, so there is
  # no registry password to leak.
  admin_enabled = false
  tags          = local.tags
}

resource "azurerm_user_assigned_identity" "app" {
  name                = "id-funded-optimizer-${var.environment}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_role_assignment" "app_acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# ---- Secrets ---------------------------------------------------------------------------------

resource "azurerm_key_vault" "main" {
  name                = "kv-funded-${var.environment}-${local.suffix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"
  # Azure RBAC rather than access policies, so vault permissions live in the same role
  # assignments as everything else and show up in one audit.
  rbac_authorization_enabled = true
  soft_delete_retention_days = 7
  purge_protection_enabled   = false
  tags                       = local.tags
}

resource "azurerm_role_assignment" "deployer_kv_officer" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  # A fixed person, not data.azurerm_client_config.current: in CI the caller is a pipeline identity,
  # and every plan then showed this assignment being replaced.
  principal_id = var.key_vault_admin_object_id
}

resource "azurerm_role_assignment" "app_kv_reader" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# Role assignments take effect eventually, not immediately. Writing the secret straight after
# granting the role fails with a 403 on the first apply roughly half the time.
resource "time_sleep" "rbac_propagation" {
  create_duration = "60s"
  depends_on      = [azurerm_role_assignment.deployer_kv_officer, azurerm_role_assignment.app_kv_reader, azurerm_role_assignment.app_acr_pull]
}

resource "random_password" "optimizer_api_key" {
  length  = 40
  special = false
}

resource "azurerm_key_vault_secret" "optimizer_api_key" {
  name         = "optimizer-api-key"
  value        = random_password.optimizer_api_key.result
  key_vault_id = azurerm_key_vault.main.id
  content_type = "API key required by the optimizer on every planning request"
  depends_on   = [time_sleep.rbac_propagation]
}

resource "azurerm_monitor_diagnostic_setting" "key_vault_audit" {
  name                       = "kv-audit-to-log-analytics"
  target_resource_id         = azurerm_key_vault.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category_group = "audit"
  }
}

# ---- Runtime ---------------------------------------------------------------------------------

resource "azurerm_container_app_environment" "main" {
  name                       = "cae-funded-${var.environment}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  tags                       = local.tags

  # Declared because Azure creates the environment with it anyway. Leaving it out made every plan
  # try to remove it.
  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

resource "azurerm_container_app" "optimizer" {
  name                         = "ca-funded-optimizer"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.app.id
  }

  # No `secret` block pointing at Key Vault: Azure provisions this subscription's environment in
  # express mode, which rejects Key Vault references in app secrets (ExpressEnvironmentFeatureNotSupported,
  # found on the first deploy). The optimizer instead reads the key from the vault itself at runtime,
  # through the same managed identity, so the value still lives only in Key Vault.

  ingress {
    external_enabled = true
    target_port      = 8000
    transport        = "http"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    # Scale to zero between requests: the consumption plan's free grant covers idle time entirely.
    min_replicas = 0
    max_replicas = 1

    http_scale_rule {
      name                = "http-scaler"
      concurrent_requests = "10"
    }

    container {
      name   = "optimizer"
      image  = "${azurerm_container_registry.main.login_server}/funded-optimizer:${var.image_tag}"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "PORT"
        value = "8000"
      }

      env {
        name  = "KEY_VAULT_URL"
        value = azurerm_key_vault.main.vault_uri
      }

      env {
        name  = "OPTIMIZER_API_KEY_SECRET"
        value = azurerm_key_vault_secret.optimizer_api_key.name
      }

      # Which user-assigned identity to request tokens for, since an app can hold several.
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.app.client_id
      }

      liveness_probe {
        transport = "HTTP"
        port      = 8000
        path      = "/health"
      }

      readiness_probe {
        transport = "HTTP"
        port      = 8000
        path      = "/health"
      }
    }
  }

  lifecycle {
    # After the first apply the pipeline deploys new images. Without this, every terraform apply
    # would roll the app back to the tag Terraform knows about.
    # Also ignored: values Azure manages on this express environment and does not report back the way
    # the provider expects, which otherwise appear as a change in every plan.
    ignore_changes = [
      template[0].container[0].image,
      template[0].container[0].liveness_probe,
      template[0].container[0].readiness_probe,
      template[0].cooldown_period_in_seconds,
      template[0].polling_interval_in_seconds,
      ingress[0].traffic_weight,
    ]
  }

  depends_on = [time_sleep.rbac_propagation]
}
