# App Runner + RDS Terraform

This Terraform stack provisions AWS infrastructure for the monorepo:

- App Runner service from ECR image (Dockerized backend serving React build)
- RDS PostgreSQL in private subnets
- VPC with public/private subnets and NAT
- App Runner VPC connector for private DB access
- Security groups with least-privilege DB ingress
- Secrets Manager for `DATABASE_URL` and `ADMIN_BOOTSTRAP_TOKEN`
- IAM roles for App Runner build/runtime
- CloudWatch alarms for RDS CPU and storage

## Environment Layout

- `environments/dev.tfvars`
- `environments/staging.tfvars`
- `environments/prod.tfvars`
- `backends/*.hcl.example` (S3 backend examples)

The Terraform backend uses `s3` with DynamoDB locking.

## Local Usage

1. Copy backend config and set real values.

```bash
cd infrastructure/terraform
cp backends/staging.hcl.example backends/staging.hcl
```

2. Initialize Terraform with remote state.

```bash
terraform init -backend-config=backends/staging.hcl
```

3. Plan/apply with an environment file and image tag.

```bash
terraform plan \
  -var-file=environments/staging.tfvars \
  -var="ecr_image_identifier=<account>.dkr.ecr.us-east-1.amazonaws.com/construction-dashboard:sha-abc123"

terraform apply \
  -var-file=environments/staging.tfvars \
  -var="ecr_image_identifier=<account>.dkr.ecr.us-east-1.amazonaws.com/construction-dashboard:sha-abc123"
```

## GitHub Actions Deployment

Workflow: `.github/workflows/deploy-aws.yml`

- On push to `main`: run backend tests, build frontend, build/push Docker image, deploy to `staging`.
- On manual dispatch:
  - `staging`: deploy latest built image to staging.
  - `prod`: deploy to production (intended to be protected by GitHub Environment approval rules).

Required GitHub repository variables:

- `AWS_REGION`
- `ECR_REPOSITORY`
- `VITE_API_BASE`

Required GitHub repository secrets:

- `AWS_ROLE_TO_ASSUME` (OIDC IAM role ARN)
- `TF_STATE_BUCKET`
- `TF_LOCK_TABLE`
- `ADMIN_BOOTSTRAP_TOKEN_STAGING`
- `ADMIN_BOOTSTRAP_TOKEN_PROD`

## Important Notes

- RDS is private (`publicly_accessible = false`) and only accessible from the App Runner VPC connector SG.
- App Runner health checks use `/health`.
- Use immutable ECR tags (`sha-*`) instead of `latest`.
- `deletion_protection = true` is enabled for RDS.
- Configure GitHub Environments `staging` and `production`; set required reviewers on `production` for a manual approval gate.
