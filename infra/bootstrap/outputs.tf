output "hcp_client_id" {
  description = "Client id of the service principal HCP Terraform runs as."
  value       = azuread_application.hcp.client_id
}

output "pipelines_client_id" {
  description = "Client id of the service principal Azure Pipelines deploys as."
  value       = azuread_application.pipelines.client_id
}

output "workspace_url" {
  value = "https://app.terraform.io/app/${var.organization}/workspaces/${var.workspace}"
}
