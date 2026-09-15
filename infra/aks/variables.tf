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

variable "node_vm_size" {
  description = "Node size. Standard_B2ps_v2 is 2 Arm64 vCPUs and 8 GiB, one of the few sizes Azure for Students offers in canadacentral."
  type        = string
  default     = "Standard_B2ps_v2"
}

variable "node_count" {
  description = "Nodes in the system pool."
  type        = number
  default     = 1
}

variable "acr_name" {
  description = "The Azure Container Registry created by infra/azure. The kubelet identity gets AcrPull on it."
  type        = string
}

variable "acr_resource_group" {
  description = "Resource group of that registry."
  type        = string
  default     = "rg-funded-dev"
}

variable "github_repository" {
  description = "Source repository, recorded as a tag on every resource."
  type        = string
  default     = "MansiPatil21/FundEd"
}

variable "cluster_admin_object_id" {
  description = "Microsoft Entra object ID granted Azure Kubernetes Service RBAC Cluster Admin. A fixed value, so the plan does not change with whoever runs it."
  type        = string
  default     = "673910e6-612d-4e36-a984-5f6cbd41dd48"
}
