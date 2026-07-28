# Two-AZ EKS Terraform

This is an independent Terraform root for the production-oriented EKS profile.
It always uses private On-Demand workers, one NAT Gateway per AZ, Multi-AZ RDS,
and the `deploy/eks-ha/kubernetes` GitOps manifests. Those topology choices
are fixed in `main.tf`; they cannot be changed by `terraform.tfvars`.

Use a dedicated production state key and a `project_name` that are never shared
with the demo profile.

```bash
cp terraform.tfvars.example terraform.tfvars
terraform init \
  -backend-config="bucket=YOUR_STATE_BUCKET" \
  -backend-config="key=postpilot/production/terraform.tfstate" \
  -backend-config="region=YOUR_AWS_REGION" \
  -backend-config="encrypt=true" \
  -backend-config="use_lockfile=true"
terraform plan
terraform apply
```

The example enables deletion protection and a final RDS snapshot. Keep those
settings for a facility database and regularly rehearse backup restoration.

This directory contains the complete two-AZ Terraform configuration.
