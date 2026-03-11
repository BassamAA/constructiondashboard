variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short project name used in resource naming"
  type        = string
  default     = "construction-dashboard"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR for VPC"
  type        = string
  default     = "10.20.0.0/16"
}

variable "private_subnet_cidrs" {
  description = "Two private subnet CIDRs in different AZs"
  type        = list(string)
  default     = ["10.20.1.0/24", "10.20.2.0/24"]
}

variable "public_subnet_cidrs" {
  description = "Two public subnet CIDRs in different AZs"
  type        = list(string)
  default     = ["10.20.11.0/24", "10.20.12.0/24"]
}

variable "apprunner_cpu" {
  description = "App Runner CPU configuration"
  type        = string
  default     = "1024"
}

variable "apprunner_memory" {
  description = "App Runner memory configuration"
  type        = string
  default     = "2048"
}

variable "ecr_image_identifier" {
  description = "Full ECR image URI, for example 123456789012.dkr.ecr.us-east-1.amazonaws.com/construction-dashboard:sha-abc123"
  type        = string
}

variable "app_port" {
  description = "Container port exposed by Express"
  type        = string
  default     = "3000"
}

variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.small"
}

variable "rds_allocated_storage" {
  description = "RDS allocated storage in GB"
  type        = number
  default     = 40
}

variable "rds_max_allocated_storage" {
  description = "RDS max auto storage scaling in GB"
  type        = number
  default     = 200
}

variable "rds_database_name" {
  description = "Application database name"
  type        = string
  default     = "construction"
}

variable "rds_username" {
  description = "Application database username"
  type        = string
  default     = "app_user"
}

variable "rds_engine_version" {
  description = "Optional PostgreSQL engine version (set null to let AWS choose a valid default for the region)"
  type        = string
  default     = null
  nullable    = true
}

variable "db_backup_retention_days" {
  description = "Automated backup retention in days"
  type        = number
  default     = 14
}

variable "db_multi_az" {
  description = "Enable Multi-AZ for production"
  type        = bool
  default     = true
}

variable "apprunner_min_size" {
  description = "Minimum App Runner instances"
  type        = number
  default     = 1
}

variable "apprunner_max_size" {
  description = "Maximum App Runner instances"
  type        = number
  default     = 4
}

variable "apprunner_max_concurrency" {
  description = "Max concurrent requests per instance"
  type        = number
  default     = 80
}

variable "session_cookie_name" {
  description = "Session cookie name"
  type        = string
  default     = "sid"
}

variable "cors_origin" {
  description = "Allowed CORS origin"
  type        = string
}

variable "admin_bootstrap_token" {
  description = "Bootstrap token for admin provisioning"
  type        = string
  sensitive   = true
}

variable "alert_email_subscriptions" {
  description = "Email addresses subscribed to CloudWatch alarm notifications via SNS"
  type        = list(string)
  default     = []
}
