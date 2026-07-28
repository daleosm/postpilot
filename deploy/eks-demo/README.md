# EKS low-cost demo

This is the current cost-conscious EKS deployment path. It is useful for a
public demo, EKS learning, or disposable testing—not live facility work.

It uses:

- two small Spot worker nodes in public subnets;
- public ALB ingress;
- a private, single-AZ RDS PostgreSQL instance;
- no NAT Gateway; and
- the `deploy/kubernetes/overlays/demo` Kubernetes YAML, selected
  automatically by Terraform/Argo CD.

Spot capacity can be reclaimed and the database does not fail over across AZs.
Treat the whole environment as disposable.

## Use it

1. Follow the state-bootstrap instructions in [../../infra/README.md](../../infra/README.md).
2. Copy this profile to `infra/terraform/terraform.tfvars` and replace every
   placeholder.
3. Keep `deployment_profile = "demo"`.
4. Run Terraform from `infra/terraform` using a state dedicated to this demo.

```bash
cd infra/terraform
cp ../../deploy/eks-demo/terraform.tfvars.example terraform.tfvars
terraform init ...
terraform plan
terraform apply
```

The rest of the GitHub Actions, ECR, Argo CD, Secrets Manager, migration, and
optional demo-seed process is documented in [../../infra/README.md](../../infra/README.md).

The demo overlay deliberately creates an HTTP ALB and sets non-secure cookies
so the generated AWS hostname works without a domain or certificate. Do not
copy that ingress or cookie configuration into a facility deployment.

For a resilient facility environment, use [`../eks-ha/`](../eks-ha/README.md)
with a different Terraform state and `project_name`.
