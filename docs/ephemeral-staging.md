# Ephemeral Staging

The `staging` environment is intended to be disposable.

For `staging` and `dev`:

- RDS deletion protection is disabled
- final DB snapshots are skipped on destroy

This keeps AWS costs under control and allows one-command tear down and re-creation.

## Bring staging up

```bash
terraform -chdir=/Users/bassam/construction-dashboard/infrastructure/terraform init -reconfigure -backend-config=backends/staging.hcl

terraform -chdir=/Users/bassam/construction-dashboard/infrastructure/terraform apply \
  -var-file=environments/staging.tfvars \
  -var="ecr_image_identifier=<account>.dkr.ecr.us-east-1.amazonaws.com/constructiondashboard:sha-<tag>"
```

## Tear staging down

```bash
terraform -chdir=/Users/bassam/construction-dashboard/infrastructure/terraform destroy \
  -var-file=environments/staging.tfvars \
  -var="ecr_image_identifier=<account>.dkr.ecr.us-east-1.amazonaws.com/constructiondashboard:sha-<tag>"
```

## Notes

- `prod` remains protected and is not disposable
- staging data should be treated as temporary
- SNS email subscriptions may need reconfirmation after recreation
