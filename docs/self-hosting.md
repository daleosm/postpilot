# Self-hosting and operations guide

## Production baseline

PostPilot is a Next.js application backed by PostgreSQL. It can run behind an existing HTTPS reverse proxy, on a VM, a container platform, or internal facility infrastructure.

Before production use:

1. Use a managed or properly backed-up PostgreSQL instance.
2. Set a long, unique `NEXTAUTH_SECRET`.
3. Set `NEXTAUTH_URL` to the public **HTTPS** URL.
4. Omit `POSTPILOT_DEBUG_DEMO` or set it to `false`.
5. Store secrets in the deployment platform’s secret manager, not Git.
6. Apply migrations in a deliberate release step.
7. Back up PostgreSQL and test restores.
8. Monitor application availability, database health, storage, and certificate expiry.
9. Keep a documented rollback and incident runbook.

For a simple non-container installation:

~~~bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
pnpm start
~~~

## Supplied AWS/EKS delivery path

The repository includes a low-cost pilot deployment path using:

- GitHub Actions to type-check, lint, build, and publish immutable images to ECR;
- Terraform to provision AWS infrastructure;
- EKS for Kubernetes;
- RDS PostgreSQL;
- Argo CD to reconcile versioned manifests from Git; and
- a separate opt-in demo seed Job.

Read [infra/README.md](../infra/README.md) before using it. It documents Terraform state bootstrap, AWS prerequisites, ECR/GitHub OIDC, Argo CD, RDS, secrets, image publishing, migrations, seeding, access, and teardown.

The pilot configuration is intentionally cost-conscious. Review its resilience, access-control, private networking, backup, monitoring, and scaling choices before treating it as a production design.

## Secrets

At minimum, runtime deployment needs:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string; percent-encode reserved characters in credentials |
| `NEXTAUTH_SECRET` | Auth.js signing secret |
| `NEXTAUTH_URL` | Canonical public application URL; use HTTPS in production |
| `POSTPILOT_DEBUG_DEMO` | Local/demo-only control; do not enable in normal production |

Changing a Kubernetes secret does not necessarily update environment variables in an already-running container. Restart or roll out the workload after changing a secret that is injected as environment variables.

## Security notes

- Restrict PostgreSQL access to application workloads and authorised operators.
- Use unique passwords; replace seeded credentials before exposing an environment.
- Keep client accounts restricted to explicitly assigned/sharing-safe episode data.
- Treat external media links as sensitive operational references.
- Review tenant scope and capability checks for every new endpoint or mutation.
- Rotate Git provider, cloud, database, and application secrets using the facility’s operating procedures.
- Restrict EKS/Kubernetes access with least privilege and retain audit logs.

PostPilot is not legal, security, accounting, tax, or compliance advice. Each facility remains responsible for its own contracts, client obligations, data retention, access controls, financial treatment, and delivery requirements.

## Backup and recovery

At a minimum, document:

1. database backup frequency and retention;
2. how to perform and verify a restore;
3. where deployment secrets live and how access is recovered;
4. the deployed image/release revision;
5. rollback steps for application and migration failures; and
6. the owner and escalation path for an incident during a live delivery schedule.
