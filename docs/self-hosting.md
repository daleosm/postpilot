# Self-hosting and operations guide

## Production baseline

PostPilot is a Next.js frontend and FastAPI backend backed by PostgreSQL. It can run behind an existing HTTPS reverse proxy, on a VM, a container platform, or internal facility infrastructure.

Before production use:

1. Use a managed or properly backed-up PostgreSQL instance.
2. Set a long, unique `POSTPILOT_SESSION_SECRET`.
3. Set `POSTPILOT_FRONTEND_ORIGINS` to the public **HTTPS** URL.
4. Omit `POSTPILOT_DEBUG_DEMO` or set it to `false`.
5. Store secrets in the deployment platform’s secret manager, not Git.
6. Apply migrations in a deliberate release step.
7. Back up PostgreSQL and test restores.
8. Monitor application availability, database health, storage, and certificate expiry.
9. Keep a documented rollback and incident runbook.

For a simple non-container installation:

~~~bash
pnpm install --frozen-lockfile
cd backend
python -m venv .venv
.venv/bin/pip install -e .
.venv/bin/alembic upgrade head
cd ..
pnpm build
pnpm start
~~~

## Supplied deployment paths

Choose one of the three supplied paths:

| Path | Use it for | Do not use it for |
| --- | --- | --- |
| [Docker Compose](../deploy/docker/README.md) | Local development, an internal proof of concept, or a backed-up single-host installation | Automatic host or availability-zone failover |
| [Low-cost EKS demo](../deploy/eks-demo/README.md) | Disposable public demos and EKS learning | Facility production data or an availability commitment |
| [Two-AZ EKS](../deploy/eks-ha/README.md) | Production-oriented AWS operation with a tested runbook | A substitute for backups, recovery testing, or operational ownership |

The EKS paths share Terraform, Kubernetes manifests, Argo CD, and ECR image
publishing. Keep each profile in a different Terraform state and use a
different `project_name`; never switch an existing demo state into the two-AZ
profile.

## EKS shared delivery path

The repository includes an EKS delivery path using:

- GitHub Actions to type-check, lint, build, and publish immutable images to ECR;
- Terraform to provision AWS infrastructure;
- EKS for Kubernetes;
- RDS PostgreSQL;
- Argo CD to reconcile versioned manifests from Git; and
- a separate opt-in demo seed Job.

Read [infra/README.md](../infra/README.md) before using it. It documents Terraform state bootstrap, AWS prerequisites, ECR/GitHub OIDC, Argo CD, RDS, secrets, image publishing, migrations, seeding, access, and teardown.

The demo EKS profile is intentionally cost-conscious. Review its resilience,
access-control, private networking, backup, monitoring, and scaling choices
before treating it as a production design. The two-AZ profile is more resilient
but still requires normal facility operations, backup/recovery testing, and
capacity planning.

## Secrets

At minimum, runtime deployment needs:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string; percent-encode reserved characters in credentials |
| `POSTPILOT_SESSION_SECRET` | FastAPI opaque-session signing secret |
| `POSTPILOT_FRONTEND_ORIGINS` | Comma-separated allowed frontend origins; use HTTPS in production |
| `POSTPILOT_DEBUG_DEMO` | Local/demo-only control; do not enable in normal production |

Changing a Kubernetes secret does not necessarily update environment variables in an already-running container. Restart or roll out the workload after changing a secret that is injected as environment variables.

## Optional Microsoft Entra SSO

Email/password remains the default authentication method. Microsoft Entra SSO
is disabled by default and must remain disabled until the selected post house's
Entra tenant configuration, existing PostPilot users, and membership records
are ready. It is opt-in per post house: enabling one facility connection does
not enable another. The browser flow is
authorization-code with PKCE: it uses public client IDs, an API audience,
tenant allow-list, exact redirect URIs, and a delegated API scope—**not** an
Azure client secret.

First Microsoft sign-in only links a verified work email to one existing
PostPilot user with a live membership in that enabled facility. It does not
provision users, map Entra groups to roles, enforce SSO, or disable password
login. Those enterprise lifecycle features, including SCIM provisioning, are
intentionally deferred.

See [Microsoft Entra SSO configuration](microsoft-entra-sso.md) for the
app-registration contract, all FastAPI and browser variables, and the
important build-time behaviour of `NEXT_PUBLIC_*` values, plus the staged
rollout and rollback procedure.

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
