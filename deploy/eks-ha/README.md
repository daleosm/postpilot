# EKS two-AZ deployment

This is the production-oriented EKS profile for a facility that needs to
survive a single availability-zone failure. It is intentionally more expensive
than the demo profile.

It configures:

- private worker nodes with two On-Demand baseline nodes;
- one NAT Gateway in each availability zone for independent private-node egress;
- an internet-facing ALB in public subnets;
- RDS PostgreSQL in isolated subnets with Multi-AZ failover;
- deletion protection, retained backups, and a final snapshot on database
  deletion; and
- the existing replica, PodDisruptionBudget, and zone spread rules in the
  independent `deploy/eks-ha/kubernetes` Kubernetes YAML.

This improves availability but does not replace an operations plan. Test an
RDS failover, restore a backup, rehearse an image rollback, use HTTPS and a
real DNS name, and choose node/database sizes from observed load.

## Use it

1. Create remote Terraform state as described in [../../infra/README.md](../../infra/README.md).
2. Create a **new** state key and project name. Never switch an existing demo
   state to this profile.
3. Copy `terraform/terraform.tfvars.example` to `terraform/terraform.tfvars`, replacing all
   placeholders and choosing realistic sizes, retention, and CIDRs.
4. Apply from `terraform/`:

```bash
cd deploy/eks-ha/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init ... # use a dedicated production state key
terraform plan
terraform apply
```

Then follow the shared ECR, GitHub Actions, Argo CD, AWS Secrets Manager,
migration, and HTTPS ingress instructions in [../../infra/README.md](../../infra/README.md).

## Enable the public HTTPS ingress

The HA overlay does not create a public listener until a real ACM certificate
and DNS host are ready. This prevents an accidental HTTP production endpoint.

1. Copy `deploy/eks-ha/kubernetes/ingress.example.yaml` to
   `deploy/eks-ha/kubernetes/ingress.yaml`.
2. Replace `REPLACE_WITH_ACM_CERTIFICATE_ARN` and `app.example.com`.
3. Add `- ingress.yaml` under `resources` in the HA `kustomization.yaml`.
4. Set `POSTPILOT_FRONTEND_ORIGINS` in AWS Secrets Manager to the exact
   `https://app.example.com` origin and restart the API deployment.

The HA API patch requires secure cookies, so sign-in will intentionally fail
until traffic reaches it over HTTPS.

The profile only controls the AWS topology. Before live use, set
`POSTPILOT_DEBUG_DEMO=false`, do not run the demo seed, use a real certificate,
and complete the checklist in [../../docs/self-hosting.md](../../docs/self-hosting.md).

The profile forwards structured application errors and warning-only Kubernetes
events, while retaining standard node/Pod metrics. It also installs
Prometheus and Grafana with 15-day metric retention and gp3-backed persistent
volumes. Grafana and Prometheus are cluster-internal; they are not exposed on
the public ALB.

Access Grafana locally after Terraform has applied:

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
