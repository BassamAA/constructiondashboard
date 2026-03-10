output "apprunner_service_url" {
  description = "Public App Runner service URL"
  value       = aws_apprunner_service.main.service_url
}

output "rds_endpoint" {
  description = "RDS endpoint address"
  value       = aws_db_instance.main.address
}

output "database_url_secret_arn" {
  description = "Secrets Manager ARN for DATABASE_URL"
  value       = aws_secretsmanager_secret.database_url.arn
}

output "admin_bootstrap_token_secret_arn" {
  description = "Secrets Manager ARN for admin bootstrap token"
  value       = aws_secretsmanager_secret.admin_bootstrap_token.arn
}
