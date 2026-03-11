# Observability

This project includes baseline operational visibility for the application and database layer.

## What is monitored

- App Runner CPU utilization
- App Runner memory utilization
- App Runner HTTP 5xx responses
- RDS CPU utilization
- RDS free storage

## Terraform resources

- CloudWatch alarms for App Runner and RDS
- CloudWatch dashboard for service and database metrics
- Optional SNS topic and email subscriptions for alarm delivery

These are managed in:

- `infrastructure/terraform/main.tf`
- `infrastructure/terraform/outputs.tf`

## How to use it

After Terraform apply, open the CloudWatch dashboard shown in Terraform outputs.
If `alert_email_subscriptions` is configured, confirm the SNS subscription emails before expecting alerts.

Use the dashboard during:

- staging validation after deploy
- production health checks
- incident investigation

## Suggested operating thresholds

- App Runner CPU > 80% for 10 minutes
- App Runner memory > 80% for 10 minutes
- App Runner 5xx responses >= 5 in 5 minutes
- RDS CPU > 80% for 10 minutes
- RDS free storage < 5 GB

## Alert delivery

Set `alert_email_subscriptions` in Terraform to create an SNS topic and subscribe email recipients.

Current delivery path:

- CloudWatch alarm
- SNS topic
- email subscription

## What this does not cover yet

- Slack or PagerDuty routing
- distributed tracing
- structured log aggregation outside CloudWatch
- synthetic uptime checks

Those are the next logical observability upgrades.
