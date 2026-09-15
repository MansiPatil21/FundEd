terraform {
  required_version = ">= 1.9"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }

  # Remote state in an ADLS Gen2 storage account that bootstrap.ps1 creates. Kept out of this
  # configuration on purpose: Terraform cannot store its state in something it has not created yet.
  # Values come from backend.hcl, written by the bootstrap script.
  backend "azurerm" {}
}

provider "azurerm" {
  subscription_id = var.subscription_id

  features {
    key_vault {
      # A student subscription is torn down and rebuilt often. Purging on destroy frees the vault
      # name at once instead of holding it for the 7-day soft-delete window.
      purge_soft_delete_on_destroy    = true
      recover_soft_deleted_key_vaults = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
}
