terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  # Same state storage account as infra/azure, under its own key, so the analytics platform can be
  # created and destroyed without touching the application stack. deploy.sh passes
  # ../azure/backend.hcl plus key=funded-data.tfstate.
  backend "azurerm" {}
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}
