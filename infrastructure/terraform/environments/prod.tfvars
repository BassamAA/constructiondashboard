aws_region   = "us-east-1"
project_name = "construction-dashboard"
environment  = "prod"

# Replace with your production app URL
cors_origin = "https://app.example.com"

# Set securely in CI/CD secrets for real deployments
admin_bootstrap_token = "replace-me"

db_multi_az              = true
apprunner_min_size       = 1
apprunner_max_size       = 4
apprunner_max_concurrency = 100
