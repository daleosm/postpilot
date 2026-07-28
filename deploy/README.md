# Deployment options

Choose one path. They are deliberately separate because their cost, resilience,
and operational responsibility are materially different.

| Option | Folder | Best for | Resilience profile |
| --- | --- | --- | --- |
| Docker Compose | [`docker/`](docker/README.md) | Local development, internal pilots, and a single-host installation | One host; protect it with host and database backups |
| EKS low-cost demo | [`eks-demo/`](eks-demo/README.md) | Disposable public demos and EKS learning | Two Spot worker nodes, public worker networking, single-AZ PostgreSQL; not for live facility work |
| EKS two-AZ | [`eks-ha/`](eks-ha/README.md) | A production-oriented facility deployment | Private workers, one NAT Gateway per AZ, two-AZ RDS failover, On-Demand baseline nodes |

All three run the same Next.js frontend, FastAPI API, and PostgreSQL schema.
They differ only in how the containers, database, networking, secrets, backups,
and operational controls are managed.

The two EKS options also have fully separate Kubernetes and Terraform folders:

- `deploy/eks-demo/terraform` and `deploy/eks-demo/kubernetes` provide the
  disposable HTTP ALB demo;
- `deploy/eks-ha/terraform` and `deploy/eks-ha/kubernetes` enable secure
  cookies and intentionally
  requires an ACM-backed HTTPS ingress to be configured before it is public.

Each Terraform directory permanently selects its own topology. Never reuse a
state key or `project_name` between them: create a separate state for every
deployment.
