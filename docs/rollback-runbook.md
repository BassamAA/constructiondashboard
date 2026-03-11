# Rollback Runbook

Use this runbook when a new staging or production deployment is unhealthy after rollout.

## Signals to trigger rollback

- App Runner service fails health checks
- `/health` or `/ready` returns non-200
- login flow or one core business flow is broken
- startup logs show migration or runtime failures

## Fast rollback strategy

The deployment pipeline uses immutable ECR image tags (`sha-...`).
Rollback means re-pointing Terraform to the previous known-good image and applying again.

## 1) Identify the previous working image

From ECR or GitHub Actions, find the last successful image tag:

- `sha-<previous-commit>`

Keep a note of:

- ECR image URI
- deployment timestamp
- commit SHA

## 2) Roll back staging

```bash
cd infrastructure/terraform

terraform init -backend-config=backends/staging.hcl

terraform apply \
  -var-file=environments/staging.tfvars \
  -var="ecr_image_identifier=<account>.dkr.ecr.us-east-1.amazonaws.com/constructiondashboard:sha-previous"
```

## 3) Roll back production

```bash
cd infrastructure/terraform

terraform init -backend-config=backends/prod.hcl

terraform apply \
  -var-file=environments/prod.tfvars \
  -var="ecr_image_identifier=<account>.dkr.ecr.us-east-1.amazonaws.com/constructiondashboard:sha-previous"
```

## 4) Verify recovery

- `GET /health`
- `GET /ready`
- login flow
- one high-value business flow

If rollback succeeds, keep the broken image tag noted for incident follow-up.

## 5) If rollback does not recover service

- inspect App Runner application and service logs
- inspect Secrets Manager values and recent Terraform changes
- verify RDS connectivity and migration state
- stop further production changes until root cause is identified

## 6) Post-incident follow-up

- document root cause
- document detection time and recovery time
- add a preventive check to CI/CD or startup validation
