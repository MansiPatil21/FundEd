variable "subscription_id" {
  description = "Azure subscription to deploy into."
  type        = string
}

variable "location" {
  description = "Azure region. Also the only region the allowed-locations policy permits."
  type        = string
  default     = "canadacentral"
}

variable "environment" {
  description = "Environment name, used in resource names and tags."
  type        = string
  default     = "dev"

  validation {
    condition     = can(regex("^[a-z0-9]{2,8}$", var.environment))
    error_message = "environment must be 2 to 8 lowercase letters or digits."
  }
}

variable "image_tag" {
  description = "Tag of the optimizer image in the registry for the first deployment. The pipeline owns the image after that."
  type        = string
  default     = "initial"
}

variable "github_repository" {
  description = "owner/name of the GitHub repository allowed to deploy through OIDC."
  type        = string
  default     = "MansiPatil21/FundEd"
}

variable "github_branch" {
  description = "Branch whose workflow runs may deploy."
  type        = string
  default     = "main"
}

variable "state_resource_group" {
  description = "Resource group of the Terraform state account created by bootstrap.ps1. The pipeline identities are granted access to it."
  type        = string
}

variable "state_storage_account" {
  description = "Name of the Terraform state storage account created by bootstrap.ps1."
  type        = string
}

variable "github_subject_prefix" {
  description = <<-EOT
    Start of the OIDC subject GitHub issues for this repository. This repository uses GitHub's
    immutable-ID subject format (repo:OWNER@OWNER_ID/REPO@REPO_ID), which survives renames. Read it
    from: gh api repos/OWNER/REPO/actions/oidc/customization/sub
  EOT
  type        = string
  default     = "repo:MansiPatil21@86612618/FundEd@1368272004"
}
