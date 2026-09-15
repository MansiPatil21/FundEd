# GitHub Actions signs in to Azure with OpenID Connect: GitHub issues a short-lived token for one
# workflow run, and Azure trusts it only for a named repository subject. There is no client secret
# stored anywhere, so there is nothing to rotate or leak.
#
# User-assigned managed identities rather than app registrations, because student and organisation
# tenants often forbid creating app registrations but allow managed identities.
#
# Three identities, each with only what its job needs:
#   deploy          pushes images and rolls the container app (azure-deploy.yml)
#   terraform_plan  reads everything to produce a plan, on pull requests and on main (azure-terraform.yml)
#   terraform_apply changes infrastructure, only from the azure-dev environment on main

locals {
  github_issuer   = "https://token.actions.githubusercontent.com"
  github_audience = ["api://AzureADTokenExchange"]
  # A job that declares `environment: azure-dev` presents this subject, not the branch ref, so any
  # identity used from such a job needs a credential for it.
  # Built from the subject prefix GitHub actually issues. The first pipeline run failed with
  # AADSTS700213 because the repository uses immutable-ID subjects, not repo:OWNER/REPO.
  github_environment_subject  = "${var.github_subject_prefix}:environment:azure-dev"
  github_main_subject         = "${var.github_subject_prefix}:ref:refs/heads/${var.github_branch}"
  github_pull_request_subject = "${var.github_subject_prefix}:pull_request"
  subscription_scope          = "/subscriptions/${var.subscription_id}"
}

# The state account's id, built rather than looked up: the azurerm_storage_account data source also
# reads the account's access keys, which the read-only plan identity must not be able to do.
locals {
  state_account_id = "/subscriptions/${var.subscription_id}/resourceGroups/${var.state_resource_group}/providers/Microsoft.Storage/storageAccounts/${var.state_storage_account}"
}

# ---- Image deployment ------------------------------------------------------------------------

resource "azurerm_user_assigned_identity" "deploy" {
  name                = "id-funded-github-deploy-${var.environment}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "github_main" {
  name                = "github-${replace(var.github_repository, "/", "-")}-${var.github_branch}"
  resource_group_name = azurerm_resource_group.main.name
  parent_id           = azurerm_user_assigned_identity.deploy.id
  issuer              = local.github_issuer
  audience            = local.github_audience
  subject             = local.github_main_subject
}

resource "azurerm_federated_identity_credential" "deploy_environment" {
  name                = "github-${replace(var.github_repository, "/", "-")}-env-azure-dev"
  resource_group_name = azurerm_resource_group.main.name
  parent_id           = azurerm_user_assigned_identity.deploy.id
  issuer              = local.github_issuer
  audience            = local.github_audience
  subject             = local.github_environment_subject
}

resource "azurerm_role_assignment" "deploy_acr_push" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPush"
  principal_id         = azurerm_user_assigned_identity.deploy.principal_id
}

resource "azurerm_role_assignment" "deploy_container_app" {
  scope                = azurerm_container_app.optimizer.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.deploy.principal_id
}

resource "azurerm_role_assignment" "deploy_rg_reader" {
  scope                = azurerm_resource_group.main.id
  role_definition_name = "Reader"
  principal_id         = azurerm_user_assigned_identity.deploy.principal_id
}

# ---- Terraform plan: read-only ---------------------------------------------------------------

resource "azurerm_user_assigned_identity" "terraform_plan" {
  name                = "id-funded-github-tfplan-${var.environment}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "plan_pull_request" {
  name                = "github-pull-request"
  resource_group_name = azurerm_resource_group.main.name
  parent_id           = azurerm_user_assigned_identity.terraform_plan.id
  issuer              = local.github_issuer
  audience            = local.github_audience
  subject             = local.github_pull_request_subject
}

resource "azurerm_federated_identity_credential" "plan_main" {
  name                = "github-main"
  resource_group_name = azurerm_resource_group.main.name
  parent_id           = azurerm_user_assigned_identity.terraform_plan.id
  issuer              = local.github_issuer
  audience            = local.github_audience
  subject             = local.github_main_subject
}

# Reader at the subscription, because the custom policy definition lives there, not in the group.
resource "azurerm_role_assignment" "plan_subscription_reader" {
  scope                = local.subscription_scope
  role_definition_name = "Reader"
  principal_id         = azurerm_user_assigned_identity.terraform_plan.principal_id
}

# Refreshing the secret resource reads its value, so the plan identity needs to read secrets.
resource "azurerm_role_assignment" "plan_kv_reader" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.terraform_plan.principal_id
}

# Blob write on the state account only to take and release the state lease (lock). A plan never
# writes state.
resource "azurerm_role_assignment" "plan_state_lock" {
  scope                = local.state_account_id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.terraform_plan.principal_id
}

# Refreshing state calls two actions Reader does not include: listing the container app's secrets
# and reading the Log Analytics workspace's shared key. A custom role grants exactly those two,
# rather than widening the plan identity to Contributor.
resource "azurerm_role_definition" "plan_refresh" {
  name        = "FundEd Terraform plan refresh (${var.environment})"
  scope       = azurerm_resource_group.main.id
  description = "Read-only extras Terraform needs to refresh the FundEd Azure resources."

  permissions {
    actions = [
      "Microsoft.App/containerApps/listSecrets/action",
      "Microsoft.OperationalInsights/workspaces/sharedKeys/action",
    ]
  }

  assignable_scopes = [azurerm_resource_group.main.id]
}

resource "azurerm_role_assignment" "plan_refresh" {
  scope              = azurerm_resource_group.main.id
  role_definition_id = azurerm_role_definition.plan_refresh.role_definition_resource_id
  principal_id       = azurerm_user_assigned_identity.terraform_plan.principal_id
}

# ---- Terraform apply: write access, environment-gated ----------------------------------------

resource "azurerm_user_assigned_identity" "terraform_apply" {
  name                = "id-funded-github-tfapply-${var.environment}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "apply_environment" {
  name                = "github-env-azure-dev"
  resource_group_name = azurerm_resource_group.main.name
  parent_id           = azurerm_user_assigned_identity.terraform_apply.id
  issuer              = local.github_issuer
  audience            = local.github_audience
  subject             = local.github_environment_subject
}

resource "azurerm_role_assignment" "apply_rg_contributor" {
  scope                = azurerm_resource_group.main.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.terraform_apply.principal_id
}

# The configuration creates role assignments, which Contributor cannot. Scoped to the resource
# group, so the pipeline can never grant itself rights over the rest of the subscription.
resource "azurerm_role_assignment" "apply_rg_rbac_admin" {
  scope                = azurerm_resource_group.main.id
  role_definition_name = "Role Based Access Control Administrator"
  principal_id         = azurerm_user_assigned_identity.terraform_apply.principal_id
}

resource "azurerm_role_assignment" "apply_policy_contributor" {
  scope                = local.subscription_scope
  role_definition_name = "Resource Policy Contributor"
  principal_id         = azurerm_user_assigned_identity.terraform_apply.principal_id
}

resource "azurerm_role_assignment" "apply_subscription_reader" {
  scope                = local.subscription_scope
  role_definition_name = "Reader"
  principal_id         = azurerm_user_assigned_identity.terraform_apply.principal_id
}

resource "azurerm_role_assignment" "apply_kv_officer" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = azurerm_user_assigned_identity.terraform_apply.principal_id
}

resource "azurerm_role_assignment" "apply_state" {
  scope                = local.state_account_id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.terraform_apply.principal_id
}
