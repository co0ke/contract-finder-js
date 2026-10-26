variable "subscription_id" {
  description = "Azure subscription to deploy into."
  type        = string
}

variable "location" {
  description = "Azure region. Must support Flex Consumption with Node.js 22."
  type        = string
  default     = "uksouth"
}

variable "name" {
  description = "Base name for resources; a random suffix keeps global names unique."
  type        = string
  default     = "contractfinder"

  validation {
    condition     = can(regex("^[a-z0-9]{3,14}$", var.name))
    error_message = "Use 3-14 lowercase letters or digits, so the storage account name stays within 24 characters."
  }
}

variable "adzuna_country" {
  description = "Adzuna country code."
  type        = string
  default     = "gb"
}

variable "key_vault_admin_object_id" {
  description = "Object id of the person who sets the secrets in the Key Vault (az ad signed-in-user show --query id -o tsv)."
  type        = string
}

variable "search_keywords" {
  description = "Replaces GetJobs.DefaultKeywords when non-empty."
  type        = list(string)
  default     = []
}
