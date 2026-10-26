resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

locals {
  suffix = random_string.suffix.result

  # App setting name -> secret name in the vault. Key Vault secret names can't contain "_" or ":", so
  # "__" becomes "--". Terraform never sees the values: they are set by hand (see CLAUDE.md).
  key_vault_secrets = {
    "Adzuna__AppId"  = "Adzuna--AppId"
    "Adzuna__AppKey" = "Adzuna--AppKey"
    "Reed__ApiKey"   = "Reed--ApiKey"
  }
}

data "azurerm_client_config" "current" {}

resource "azurerm_resource_group" "main" {
  name     = "rg-${var.name}"
  location = var.location
}

# One account holds the Functions host state, the deployment package and the job store's tables.
resource "azurerm_storage_account" "main" {
  name                            = "st${var.name}${local.suffix}"
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
}

resource "azurerm_storage_container" "deployments" {
  name                  = "app-package"
  storage_account_id    = azurerm_storage_account.main.id
  container_access_type = "private"
}

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${var.name}-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = 0.1 # keeps ingestion under the 5 GB/month free allowance
}

resource "azurerm_application_insights" "main" {
  name                = "appi-${var.name}-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
}

resource "azurerm_service_plan" "main" {
  name                = "asp-${var.name}-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "FC1"
}

# Holds the API credentials. Only the vault and who may use it are managed here; the secrets themselves are
# created by hand so their values never enter Terraform state or HCP variables.
resource "azurerm_key_vault" "main" {
  name                       = "kv-${var.name}-${local.suffix}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 7
}

resource "azurerm_role_assignment" "key_vault_admin" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = var.key_vault_admin_object_id
}

resource "azurerm_role_assignment" "key_vault_app" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_function_app_flex_consumption.main.identity[0].principal_id
}

resource "azurerm_function_app_flex_consumption" "main" {
  name                = "func-${var.name}-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  service_plan_id     = azurerm_service_plan.main.id
  https_only          = true

  storage_container_type      = "blobContainer"
  storage_container_endpoint  = "${azurerm_storage_account.main.primary_blob_endpoint}${azurerm_storage_container.deployments.name}"
  storage_authentication_type = "StorageAccountConnectionString"
  storage_access_key          = azurerm_storage_account.main.primary_access_key

  runtime_name           = "node"
  runtime_version        = "22"
  instance_memory_in_mb  = 512 # smallest size; raise to 2048 if JobServe parsing runs out of memory
  maximum_instance_count = 40

  identity {
    type = "SystemAssigned"
  }

  site_config {
    application_insights_connection_string = azurerm_application_insights.main.connection_string
  }

  app_settings = merge(
    {
      "JobStore__ConnectionString" = azurerm_storage_account.main.primary_connection_string
      "Adzuna__Country"            = var.adzuna_country
      # The Node app mocks the store and job sites unless told otherwise; deployed, it must use the real ones.
      "MOCK_EXTERNALS" = "false"
    },
    { for setting, secret in local.key_vault_secrets : setting => "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.main.vault_uri}secrets/${secret}/)" },
    { for i, keyword in var.search_keywords : "Search__Keywords__${i}" => keyword },
  )

  lifecycle {
    # Azure adds this tag to link the portal's App Insights blade; removing it on every apply is noise.
    ignore_changes = [tags["hidden-link: /app-insights-resource-id"]]
  }
}
