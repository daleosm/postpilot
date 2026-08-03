# EKS low-cost demo

This is the current cost-conscious EKS deployment path. It is useful for a
public demo, EKS learning, or disposable testing—not live facility work.

It uses:

- two small Spot worker nodes in public subnets;
- public ALB ingress;
- a private, single-AZ RDS PostgreSQL instance;
- no NAT Gateway; and
- its own `terraform/` root and `kubernetes/` manifests.

Spot capacity can be reclaimed and the database does not fail over across AZs.
Treat the whole environment as disposable.

## Use it

1. Follow the state-bootstrap instructions in [../../infra/README.md](../../infra/README.md).
2. Copy the Terraform example in this folder and replace every placeholder.
3. Run Terraform from `terraform/` using a state dedicated to this demo.

```bash
cd deploy/eks-demo/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init ...
terraform plan
terraform apply
```

The rest of the GitHub Actions, ECR, Argo CD, Secrets Manager, migration, and
optional demo-seed process is documented in [../../infra/README.md](../../infra/README.md).

The demo overlay deliberately creates an HTTP ALB and sets non-secure cookies
so the generated AWS hostname works without a domain or certificate. Do not
copy that ingress or cookie configuration into a facility deployment.

For low-cost observability, this profile keeps three days of PostPilot error
logs, warning-only Kubernetes events, standard node/Pod metrics, and a small
in-cluster Prometheus and Grafana installation. The monitoring stack has
seven-day metric retention and persistent gp3 volumes. It can make Karpenter
launch additional Spot capacity, so it is intentionally useful for learning
and demos rather than the lowest possible monthly cost.

Grafana is not public. After Terraform has applied, access it locally:

```bash
kubectl -n monitoring port-forward svc/postpilot-observability-grafana 3000:80
kubectl -n monitoring get secret postpilot-observability-grafana \
  -o jsonpath='{.data.admin-password}' | base64 -d; echo
```

Open `http://localhost:3000` as `admin`, then use the printed password. The
included PostPilot API dashboard shows request rate, p95 latency, 5xx rate,
and database readiness. Set `cost_alert_email` in `terraform.tfvars` to opt
into free monthly Budget and Cost Anomaly Detection emails; they notify but do
not shut down resources.

For a resilient facility environment, use [`../eks-ha/`](../eks-ha/README.md)
with a different Terraform state and `project_name`.
