# Low-cost demo Terraform

This is an independent Terraform root for the disposable EKS demo. It always
uses public Spot worker nodes, no NAT Gateway, a single-AZ PostgreSQL instance,
and the `deploy/eks-demo/kubernetes` GitOps manifests. Those topology choices
are fixed in `main.tf`; they cannot be changed by `terraform.tfvars`.

Use a state key and `project_name` that are never shared with another profile.

```bash
cp terraform.tfvars.example terraform.tfvars
terraform init \
  -backend-config="bucket=YOUR_STATE_BUCKET" \
  -backend-config="key=postpilot/demo/terraform.tfstate" \
  -backend-config="region=YOUR_AWS_REGION" \
  -backend-config="encrypt=true" \
  -backend-config="use_lockfile=true"
terraform plan
terraform apply
```

Run `terraform destroy` only when the demo is disposable. The database uses no
final snapshot by default, so this intentionally removes demo data.

This directory contains the complete demo Terraform configuration.
