terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  # The same state storage account as infra/azure, under its own key, so the cluster can be
  # created and destroyed without touching the Container Apps stack. deploy-aks.sh passes
  # ../azure/backend.hcl plus key=funded-aks.tfstate.
  backend "azurerm" {}
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}
