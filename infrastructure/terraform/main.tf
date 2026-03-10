locals {
  name_prefix = "${var.project_name}-${var.environment}"
  # App Runner autoscaling names must be <= 32 chars.
  apprunner_autoscaling_name = substr("${var.project_name}-${var.environment}-as", 0, 32)
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = merge(local.common_tags, { Name = "${local.name_prefix}-vpc" })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.common_tags, { Name = "${local.name_prefix}-igw" })
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-public-${count.index + 1}"
    Tier = "public"
  })
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-private-${count.index + 1}"
    Tier = "private"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = merge(local.common_tags, { Name = "${local.name_prefix}-public-rt" })
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = merge(local.common_tags, { Name = "${local.name_prefix}-nat-eip" })
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags          = merge(local.common_tags, { Name = "${local.name_prefix}-nat" })
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
  tags = merge(local.common_tags, { Name = "${local.name_prefix}-private-rt" })
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id
  tags       = merge(local.common_tags, { Name = "${local.name_prefix}-db-subnet-group" })
}

resource "aws_security_group" "apprunner_vpc_connector" {
  name        = "${local.name_prefix}-apprunner-vpc"
  description = "Security group for App Runner VPC connector"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-apprunner-vpc" })
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds"
  description = "RDS PostgreSQL access"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.apprunner_vpc_connector.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-rds" })
}

resource "random_password" "db_password" {
  length           = 24
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_db_instance" "main" {
  identifier                      = "${var.project_name}-${var.environment}-db"
  engine                          = "postgres"
  engine_version                  = var.rds_engine_version
  instance_class                  = var.rds_instance_class
  allocated_storage               = var.rds_allocated_storage
  max_allocated_storage           = var.rds_max_allocated_storage
  db_name                         = var.rds_database_name
  username                        = var.rds_username
  password                        = random_password.db_password.result
  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [aws_security_group.rds.id]
  port                            = 5432
  publicly_accessible             = false
  multi_az                        = var.db_multi_az
  backup_retention_period         = var.db_backup_retention_days
  deletion_protection             = true
  storage_encrypted               = true
  performance_insights_enabled    = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  auto_minor_version_upgrade      = true
  copy_tags_to_snapshot           = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${var.project_name}-${var.environment}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  apply_immediately               = false

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-db" })
}

locals {
  database_url = "postgresql://${var.rds_username}:${random_password.db_password.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.rds_database_name}?schema=public"
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.name_prefix}/database-url"
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = local.database_url
}

resource "aws_secretsmanager_secret" "admin_bootstrap_token" {
  name                    = "${local.name_prefix}/admin-bootstrap-token"
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "admin_bootstrap_token" {
  secret_id     = aws_secretsmanager_secret.admin_bootstrap_token.id
  secret_string = var.admin_bootstrap_token
}

resource "aws_iam_role" "apprunner_ecr_access" {
  name = "${local.name_prefix}-apprunner-ecr-access"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "build.apprunner.amazonaws.com" },
      Action    = "sts:AssumeRole",
    }],
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr_access" {
  role       = aws_iam_role.apprunner_ecr_access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

resource "aws_iam_role" "apprunner_instance" {
  name = "${local.name_prefix}-apprunner-instance"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "tasks.apprunner.amazonaws.com" },
      Action    = "sts:AssumeRole",
    }],
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy" "apprunner_instance_secrets" {
  name = "${local.name_prefix}-apprunner-secrets"
  role = aws_iam_role.apprunner_instance.id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "secretsmanager:GetSecretValue",
        ],
        Resource = [
          aws_secretsmanager_secret.database_url.arn,
          aws_secretsmanager_secret.admin_bootstrap_token.arn,
        ],
      },
    ],
  })
}

resource "aws_apprunner_auto_scaling_configuration_version" "main" {
  auto_scaling_configuration_name = local.apprunner_autoscaling_name
  min_size                        = var.apprunner_min_size
  max_size                        = var.apprunner_max_size
  max_concurrency                 = var.apprunner_max_concurrency
  tags                            = local.common_tags
}

resource "aws_apprunner_vpc_connector" "main" {
  vpc_connector_name = "${local.name_prefix}-connector"
  subnets            = aws_subnet.private[*].id
  security_groups    = [aws_security_group.apprunner_vpc_connector.id]
  tags               = local.common_tags
}

resource "aws_apprunner_service" "main" {
  service_name = "${local.name_prefix}-svc"

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_ecr_access.arn
    }

    auto_deployments_enabled = false

    image_repository {
      image_identifier      = var.ecr_image_identifier
      image_repository_type = "ECR"

      image_configuration {
        port = var.app_port

        runtime_environment_variables = {
          NODE_ENV            = "production"
          PORT                = var.app_port
          CORS_ORIGIN         = var.cors_origin
          SESSION_COOKIE_NAME = var.session_cookie_name
        }

        runtime_environment_secrets = {
          DATABASE_URL          = aws_secretsmanager_secret.database_url.arn
          ADMIN_BOOTSTRAP_TOKEN = aws_secretsmanager_secret.admin_bootstrap_token.arn
        }
      }
    }
  }

  instance_configuration {
    cpu               = var.apprunner_cpu
    memory            = var.apprunner_memory
    instance_role_arn = aws_iam_role.apprunner_instance.arn
  }

  health_check_configuration {
    path                = "/health"
    protocol            = "HTTP"
    healthy_threshold   = 1
    unhealthy_threshold = 5
    interval            = 10
    timeout             = 5
  }

  network_configuration {
    egress_configuration {
      egress_type       = "VPC"
      vpc_connector_arn = aws_apprunner_vpc_connector.main.arn
    }

    ingress_configuration {
      is_publicly_accessible = true
    }
  }

  auto_scaling_configuration_arn = aws_apprunner_auto_scaling_configuration_version.main.arn

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${local.name_prefix}-rds-cpu-high"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  alarm_description = "RDS CPU is above 80 percent"
  tags              = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage_low" {
  alarm_name          = "${local.name_prefix}-rds-free-storage-low"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 5 * 1024 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  alarm_description = "RDS free storage below 5 GB"
  tags              = local.common_tags
}
