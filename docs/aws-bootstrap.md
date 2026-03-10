# AWS Bootstrap (Slice 1)

This guide bootstraps AWS/GitHub prerequisites for CI/CD.

## 1) Set your shell variables

```bash
export AWS_REGION="us-east-1"
export AWS_ACCOUNT_ID="123456789012"
export TF_STATE_BUCKET="construction-dashboard-tf-state"
export TF_LOCK_TABLE="construction-dashboard-tf-lock"
export ROLE_NAME="github-actions-construction-dashboard"
export POLICY_NAME="github-actions-construction-dashboard-ci"
export GITHUB_OWNER="your-github-org-or-user"
export GITHUB_REPO="construction-dashboard"
```

## 2) Create Terraform remote state resources

```bash
aws s3api create-bucket \
  --bucket "$TF_STATE_BUCKET" \
  --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"

aws s3api put-bucket-versioning \
  --bucket "$TF_STATE_BUCKET" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket "$TF_STATE_BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws dynamodb create-table \
  --table-name "$TF_LOCK_TABLE" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "$AWS_REGION"
```

For `us-east-1`, omit `--create-bucket-configuration` if AWS returns `InvalidLocationConstraint`.

## 3) Create GitHub OIDC provider (one-time per AWS account)

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

If the provider already exists, reuse it.

## 4) Create IAM role for GitHub Actions

1. Open `infrastructure/iam/github-oidc-trust-policy.json` and replace:
- `<AWS_ACCOUNT_ID>`
- `<GITHUB_OWNER>`
- `<GITHUB_REPO>`

2. Create role:

```bash
aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document file://infrastructure/iam/github-oidc-trust-policy.json
```

3. Open `infrastructure/iam/github-actions-ci-policy.json` and replace:
- `<TF_STATE_BUCKET>`
- `<TF_LOCK_TABLE>`
- `<AWS_REGION>`
- `<AWS_ACCOUNT_ID>`

4. Create and attach policy:

```bash
aws iam create-policy \
  --policy-name "$POLICY_NAME" \
  --policy-document file://infrastructure/iam/github-actions-ci-policy.json

aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn "arn:aws:iam::$AWS_ACCOUNT_ID:policy/$POLICY_NAME"
```

## 5) Configure GitHub repository variables

- `AWS_REGION`
- `ECR_REPOSITORY`
- `VITE_API_BASE`

## 6) Configure GitHub repository secrets

- `AWS_ROLE_TO_ASSUME` = `arn:aws:iam::<AWS_ACCOUNT_ID>:role/<ROLE_NAME>`
- `TF_STATE_BUCKET`
- `TF_LOCK_TABLE`
- `ADMIN_BOOTSTRAP_TOKEN_STAGING`
- `ADMIN_BOOTSTRAP_TOKEN_PROD`

## 7) Configure GitHub Environments

Create:
- `staging`
- `production`

Set required reviewers on `production`.

## 8) Validate from GitHub Actions

Run workflow `.github/workflows/deploy-aws.yml` using `workflow_dispatch` and `target_env=staging`.

Expected result:
- tests pass
- image pushed to ECR
- Terraform apply for staging succeeds
