output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "function_app_name" {
  value = azurerm_function_app_flex_consumption.main.name
}

output "app_url" {
  description = "The search page; append ?code=<function key> so it can call the jobs API."
  value       = "https://${azurerm_function_app_flex_consumption.main.default_hostname}/api/app"
}

output "key_vault_name" {
  description = "Vault to set the Adzuna--AppId, Adzuna--AppKey and Reed--ApiKey secrets in."
  value       = azurerm_key_vault.main.name
}
