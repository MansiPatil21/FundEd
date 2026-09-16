variable "subscription_id" {
  description = "Azure subscription to deploy into."
  type        = string
}

variable "location" {
  description = "Azure region. Must be allowed by the subscription's region policy."
  type        = string
  default     = "canadacentral"
}

variable "environment" {
  description = "Environment name used in resource names and tags."
  type        = string
  default     = "dev"
}

variable "github_repository" {
  description = "Source repository, recorded as a tag on every resource."
  type        = string
  default     = "MansiPatil21/FundEd"
}

variable "sql_admin_object_id" {
  description = "Microsoft Entra object ID that administers the SQL server. A fixed value, so the plan does not change with whoever runs it."
  type        = string
  default     = "673910e6-612d-4e36-a984-5f6cbd41dd48"
}

variable "sql_admin_login" {
  description = "Display name of the Entra administrator, shown in the portal."
  type        = string
  default     = "ui812392@dal.ca"
}

variable "client_ip" {
  description = "Public IP allowed through the SQL firewall, so the pipeline can be verified from this machine. Empty adds no rule."
  type        = string
  default     = ""
}

variable "fx_base" {
  description = "Base currency the Data Factory pipeline requests from the ECB reference-rate API."
  type        = string
  default     = "EUR"
}

variable "fx_symbols" {
  description = "Quote currencies to keep, as the API's comma-separated list."
  type        = string
  default     = "CAD,INR,USD,GBP"
}
