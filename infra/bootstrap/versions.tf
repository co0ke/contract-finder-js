terraform {
  required_version = ">= 1.9"

  # Local state (gitignored): this runs once from a laptop to set up the cloud runs, and holds secrets.
  required_providers {
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.4"
    }
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.40"
    }
    azuredevops = {
      source  = "microsoft/azuredevops"
      version = "~> 1.16"
    }
    tfe = {
      source  = "hashicorp/tfe"
      version = "~> 0.70"
    }
  }
}

# All four use your own logins: az login (Azure DevOps too, or set AZDO_PERSONAL_ACCESS_TOKEN), and
# terraform login for HCP Terraform.
provider "azuread" {}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

provider "azuredevops" {
  org_service_url = var.azure_devops_org_url
}

provider "tfe" {
  organization = var.organization
}
