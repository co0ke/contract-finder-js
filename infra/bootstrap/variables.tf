variable "organization" {
  description = "HCP Terraform organization."
  type        = string
  default     = "your-hcp-org"
}

variable "workspace" {
  description = "HCP Terraform workspace that runs ../ (it already exists and is imported)."
  type        = string
  default     = "contract-finder"
}

variable "github_repo" {
  description = "GitHub repository, as owner/name, whose main branch triggers runs."
  type        = string
  default     = "your-github-user/your-repo"
}

variable "github_app_installation" {
  description = "Name of the HCP Terraform GitHub App installation (your GitHub account name)."
  type        = string
  default     = "your-azdo-org"
}

variable "azure_devops_org_url" {
  description = "Azure DevOps organization whose pipeline deploys the function app."
  type        = string
  default     = "https://dev.azure.com/your-org"
}

variable "azure_devops_project" {
  description = "Azure DevOps project that holds the pipeline (it already exists)."
  type        = string
  default     = "Contract Finder"
}

# The rest mirror ../variables.tf so ../terraform.tfvars can be passed in with -var-file.

variable "subscription_id" {
  type = string
}

variable "adzuna_country" {
  type    = string
  default = "gb"
}

variable "key_vault_admin_object_id" {
  type = string
}

variable "search_keywords" {
  type    = list(string)
  default = []
}
