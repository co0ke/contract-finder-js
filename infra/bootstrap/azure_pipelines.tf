data "azuredevops_project" "main" {
  name = var.azure_devops_project
}

# Both must match the names ../../azure-pipelines.yml uses.
locals {
  service_connection = "contract-finder-azure"
  environment        = "production"
}

# Identity the Azure Pipelines deploy signs in as, again with no stored secret: Entra trusts Azure
# DevOps's OIDC tokens for this one service connection.
resource "azuread_application" "pipelines" {
  display_name = "azure-pipelines-${var.workspace}"
}

resource "azuread_service_principal" "pipelines" {
  client_id = azuread_application.pipelines.client_id
}

resource "azuredevops_serviceendpoint_azurerm" "main" {
  project_id                             = data.azuredevops_project.main.id
  service_endpoint_name                  = local.service_connection
  description                            = "Deploys the function app. Managed by infra/bootstrap."
  service_endpoint_authentication_scheme = "WorkloadIdentityFederation"
  azurerm_spn_tenantid                   = data.azurerm_subscription.current.tenant_id
  azurerm_subscription_id                = data.azurerm_subscription.current.subscription_id
  azurerm_subscription_name              = data.azurerm_subscription.current.display_name

  credentials {
    serviceprincipalid = azuread_application.pipelines.client_id
  }
}

resource "azuread_application_federated_identity_credential" "pipelines" {
  application_id = azuread_application.pipelines.id
  display_name   = "azure-pipelines-${local.service_connection}"
  issuer         = azuredevops_serviceendpoint_azurerm.main.workload_identity_federation_issuer
  audiences      = ["api://AzureADTokenExchange"]
  subject        = azuredevops_serviceendpoint_azurerm.main.workload_identity_federation_subject
}

# Deploys only publish code, so Website Contributor rather than Contributor. Subscription scope because
# the resource group doesn't exist until ../ is applied.
resource "azurerm_role_assignment" "pipelines" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Website Contributor"
  principal_id         = azuread_service_principal.pipelines.object_id
}

resource "azuredevops_environment" "main" {
  project_id  = data.azuredevops_project.main.id
  name        = local.environment
  description = "The function app. Deploys wait for approval; see infra/bootstrap."
}

data "azuredevops_group" "approvers" {
  project_id = data.azuredevops_project.main.id
  name       = "Project Administrators"
}

# Every deploy waits for someone to approve it in Azure DevOps, much as HCP applies wait for a confirm.
# Whoever pushed may approve, since there's one person on the project.
resource "azuredevops_check_approval" "production" {
  project_id            = data.azuredevops_project.main.id
  target_resource_id    = azuredevops_environment.main.id
  target_resource_type  = "environment"
  approvers             = [data.azuredevops_group.approvers.origin_id]
  requester_can_approve = true
  instructions          = "Approve only the newest waiting run: approving an older one deploys older code."
  timeout               = 1440 # minutes; an unapproved run fails after a day rather than lingering
}

# Lets pipelines use the connection and environment without someone granting access on the first run.
resource "azuredevops_pipeline_authorization" "service_connection" {
  project_id  = data.azuredevops_project.main.id
  resource_id = azuredevops_serviceendpoint_azurerm.main.id
  type        = "endpoint"
}

resource "azuredevops_pipeline_authorization" "environment" {
  project_id  = data.azuredevops_project.main.id
  resource_id = azuredevops_environment.main.id
  type        = "environment"
}
