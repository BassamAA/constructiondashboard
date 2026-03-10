aws_region   = "us-east-1"
project_name = "construction-dashboard"
environment  = "staging"

# Replace with your staging app URL
cors_origin = "https://staging.example.com"

# Set securely in CI/CD secrets for real deployments
admin_bootstrap_token = "replace-me"

db_multi_az              = false
apprunner_min_size       = 1
apprunner_max_size       = 3
apprunner_max_concurrency = 80
