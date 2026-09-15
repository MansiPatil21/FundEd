# Guardrails enforced by Azure itself, not by convention. Both are assigned at the resource-group
# scope, so they govern this deployment without affecting anything else in the subscription.

data "azurerm_policy_definition" "allowed_locations" {
  display_name = "Allowed locations"
}

resource "azurerm_resource_group_policy_assignment" "allowed_locations" {
  name                 = "funded-allowed-locations"
  display_name         = "FundEd resources must stay in ${var.location}"
  resource_group_id    = azurerm_resource_group.main.id
  policy_definition_id = data.azurerm_policy_definition.allowed_locations.id

  parameters = jsonencode({
    listOfAllowedLocations = { value = [var.location] }
  })
}

# Custom definition: every resource must carry a project tag, so cost reports and cleanup can
# find everything a deployment created. Deny rather than audit, so an untagged resource is
# refused at creation instead of discovered later.
resource "azurerm_policy_definition" "require_project_tag" {
  name         = "funded-require-project-tag"
  policy_type  = "Custom"
  mode         = "Indexed"
  display_name = "Resources must have a project tag"
  description  = "Denies creation of any resource without a non-empty 'project' tag."

  metadata = jsonencode({ category = "Tags" })

  policy_rule = jsonencode({
    if = {
      anyOf = [
        { field = "tags['project']", exists = "false" },
        { field = "tags['project']", equals = "" }
      ]
    }
    then = { effect = "deny" }
  })
}

resource "azurerm_resource_group_policy_assignment" "require_project_tag" {
  name                 = "funded-require-project-tag"
  display_name         = "FundEd resources must have a project tag"
  resource_group_id    = azurerm_resource_group.main.id
  policy_definition_id = azurerm_policy_definition.require_project_tag.id
}
