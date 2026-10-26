data "azurerm_subscription" "current" {}

data "tfe_project" "main" {
  name = "Default Project"
}

data "tfe_github_app_installation" "main" {
  name = var.github_app_installation
}

# Identity that HCP Terraform runs sign in as, with no stored secret: Entra trusts HCP's OIDC tokens
# for this workspace's plan and apply phases only.
resource "azuread_application" "hcp" {
  display_name = "hcp-terraform-${var.workspace}"
}

resource "azuread_service_principal" "hcp" {
  client_id = azuread_application.hcp.client_id
}

resource "azuread_application_federated_identity_credential" "hcp" {
  for_each = toset(["plan", "apply"])

  application_id = azuread_application.hcp.id
  display_name   = "hcp-terraform-${var.workspace}-${each.key}"
  issuer         = "https://app.terraform.io"
  audiences      = ["api://AzureADTokenExchange"]
  subject        = "organization:${var.organization}:project:${data.tfe_project.main.name}:workspace:${var.workspace}:run_phase:${each.key}"
}

# Subscription scope because the configuration creates its own resource group.
resource "azurerm_role_assignment" "hcp" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.hcp.object_id
}

# Lets the configuration give the function app's identity and its operator access to the Key Vault, which
# Contributor can't (it has no permission to write role assignments).
resource "azurerm_role_assignment" "hcp_access_admin" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "User Access Administrator"
  principal_id         = azuread_service_principal.hcp.object_id
}

import {
  to = tfe_workspace.main
  id = "${var.organization}/${var.workspace}"
}

# Pushes to main that touch the configuration queue a run; pull requests get a speculative plan.
# auto_apply stays off, so every apply waits for someone to confirm it in HCP Terraform.
resource "tfe_workspace" "main" {
  name              = var.workspace
  project_id        = data.tfe_project.main.id
  working_directory = "infra"
  trigger_patterns  = ["infra/*.tf", "infra/.terraform.lock.hcl"]
  auto_apply        = false
  queue_all_runs    = false

  vcs_repo {
    identifier                 = var.github_repo
    branch                     = "main"
    github_app_installation_id = data.tfe_github_app_installation.main.id
  }
}

resource "tfe_workspace_settings" "main" {
  workspace_id   = tfe_workspace.main.id
  execution_mode = "remote"
}

locals {
  env_vars = {
    TFC_AZURE_PROVIDER_AUTH = "true"
    TFC_AZURE_RUN_CLIENT_ID = azuread_application.hcp.client_id
    ARM_TENANT_ID           = data.azurerm_subscription.current.tenant_id
  }

  terraform_vars = {
    subscription_id           = { value = var.subscription_id, sensitive = false, hcl = false }
    adzuna_country            = { value = var.adzuna_country, sensitive = false, hcl = false }
    search_keywords           = { value = jsonencode(var.search_keywords), sensitive = false, hcl = true }
    key_vault_admin_object_id = { value = var.key_vault_admin_object_id, sensitive = false, hcl = false }
  }
}

resource "tfe_variable" "env" {
  for_each = local.env_vars

  workspace_id = tfe_workspace.main.id
  category     = "env"
  key          = each.key
  value        = each.value
}

resource "tfe_variable" "terraform" {
  # Listed keys rather than the map, since for_each rejects values derived from sensitive ones.
  for_each = toset(["subscription_id", "adzuna_country", "search_keywords", "key_vault_admin_object_id"])

  workspace_id = tfe_workspace.main.id
  category     = "terraform"
  key          = each.key
  value        = local.terraform_vars[each.key].value
  sensitive    = local.terraform_vars[each.key].sensitive
  hcl          = local.terraform_vars[each.key].hcl
}
