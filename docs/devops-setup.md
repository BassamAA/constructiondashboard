# DevOps Setup Checklist (AWS)

This project now includes an AWS deployment workflow at `.github/workflows/deploy-aws.yml`.
For first-time AWS account/bootstrap steps, use `docs/aws-bootstrap.md`.

## 1) Create Terraform state backend

Create once per AWS account:

- S3 bucket for Terraform state
- DynamoDB table for state locking (`LockID` string partition key)

## 2) Configure GitHub OIDC role

Create an IAM role trusted by GitHub OIDC, then grant it permissions for:

- ECR (push image)
- App Runner (update service)
- RDS, VPC, IAM, Secrets Manager, CloudWatch (Terraform-managed resources)
- S3 + DynamoDB (Terraform backend state/lock)

Templates are provided in:

- `infrastructure/iam/github-oidc-trust-policy.json`
- `infrastructure/iam/github-actions-ci-policy.json`

Set repository secret:

- `AWS_ROLE_TO_ASSUME`

## 3) Configure GitHub repository variables

- `AWS_REGION`
- `TF_STATE_REGION`
- `ECR_REPOSITORY`
- `VITE_API_BASE`

## 4) Configure GitHub repository secrets

- `TF_STATE_BUCKET`
- `TF_LOCK_TABLE`
- `ADMIN_BOOTSTRAP_TOKEN_STAGING`
- `ADMIN_BOOTSTRAP_TOKEN_PROD`

## 5) Configure GitHub Environments

Create environments:

- `staging`
- `production`

For `production`, add required reviewers to enforce manual approval before deploy.

## 6) Deploy flow

- Push to `main`: CI + build + deploy to staging.
- Manual workflow dispatch (`target_env=prod`): deploy to production (approval gate via environment).

## 7) Security checks

Workflow: `.github/workflows/security-checks.yml`

- Trivy filesystem scan (HIGH/CRITICAL, ignores unfixed)
- Gitleaks secret scan

## 8) Local Terraform usage

Examples are in:

- `infrastructure/terraform/backends/*.hcl.example`
- `infrastructure/terraform/environments/*.tfvars`

## 9) Runbooks

- `docs/rollback-runbook.md`
- `docs/fly-to-aws-db-migration.md`
- `docs/observability.md`
