locals {
  name = "funded-${var.environment}"

  tags = {
    project     = "funded"
    environment = var.environment
    managed_by  = "terraform"
    repository  = var.github_repository
  }

  # Azure's Arm64 sizes carry a "p" in the family suffix (B2ps_v2, D2pls_v5). deploy-aks.sh reads
  # this to build images for the right CPU architecture.
  node_architecture = can(regex("^Standard_[A-Z]+[0-9]+[a-z]*p", var.node_vm_size)) ? "arm64" : "amd64"
}

data "azurerm_client_config" "current" {}

data "azurerm_container_registry" "images" {
  name                = var.acr_name
  resource_group_name = var.acr_resource_group
}

resource "azurerm_resource_group" "aks" {
  name     = "rg-${local.name}-aks"
  location = var.location
  tags     = local.tags
}

resource "azurerm_kubernetes_cluster" "main" {
  name                = "aks-${local.name}"
  location            = azurerm_resource_group.aks.location
  resource_group_name = azurerm_resource_group.aks.name
  dns_prefix          = "aks-${local.name}"
  node_resource_group = "rg-${local.name}-aks-nodes"

  # Free tier: no uptime SLA and no control plane charge. Only the node and its disk cost money,
  # and `az aks stop` removes the node charge between uses.
  sku_tier                  = "Free"
  automatic_upgrade_channel = "patch"
  node_os_upgrade_channel   = "NodeImage"

  # No static admin kubeconfig. Every kubectl call signs in with Microsoft Entra ID and is
  # authorised by Azure role assignments.
  local_account_disabled            = true
  role_based_access_control_enabled = true
  azure_active_directory_role_based_access_control {
    azure_rbac_enabled = true
    tenant_id          = data.azurerm_client_config.current.tenant_id
  }

  oidc_issuer_enabled       = true
  workload_identity_enabled = true

  default_node_pool {
    name                        = "system"
    vm_size                     = var.node_vm_size
    node_count                  = var.node_count
    # 30 GiB filled up: the system images plus FundEd's three images put the node under disk
    # pressure, and the kubelet tainted it so nothing new could be scheduled.
    os_disk_size_gb             = 64
    temporary_name_for_rotation = "systemtmp"
    tags                        = local.tags

    upgrade_settings {
      max_surge = "10%"
    }
  }

  identity {
    type = "SystemAssigned"
  }

  # Azure CNI overlay with Cilium, which enforces the NetworkPolicies in infra/k8s.
  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    network_data_plane  = "cilium"
    network_policy      = "cilium"
    load_balancer_sku   = "standard"
  }

  tags = local.tags
}

# Nodes pull images from the registry with their kubelet identity. No registry password exists.
resource "azurerm_role_assignment" "kubelet_acr_pull" {
  scope                            = data.azurerm_container_registry.images.id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
  skip_service_principal_aad_check = true
}

resource "azurerm_role_assignment" "cluster_admin" {
  scope                = azurerm_kubernetes_cluster.main.id
  role_definition_name = "Azure Kubernetes Service RBAC Cluster Admin"
  principal_id         = var.cluster_admin_object_id
}
