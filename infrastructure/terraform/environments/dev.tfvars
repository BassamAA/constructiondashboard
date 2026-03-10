aws_region   = "us-east-1"
project_name = "construction-dashboard"
environment  = "dev"

# Replace with your dev app URL
cors_origin = "https://dev.example.com"

# Set securely in CI/CD secrets for real deployments
admin_bootstrap_token = "replace-me"

# Recommended smaller defaults for dev cost control
db_multi_az              = false
apprunner_min_size       = 1
apprunner_max_size       = 2
apprunner_max_concurrency = 50
