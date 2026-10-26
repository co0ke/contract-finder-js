terraform {
  required_version = ">= 1.9"

  # Runs execute in HCP Terraform, triggered by pushes to main, and sign in to Azure with dynamic
  # credentials; bootstrap/ sets that up. Locally, `terraform plan` runs a speculative plan there.
  cloud {
    organization = "your-hcp-org"

    workspaces {
      name = "contract-finder"
    }
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.40"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}
