# PostPilot EKS deployment

This directory contains the shared Terraform, EKS, Argo CD, ECR, and Kubernetes
implementation used by two separately documented profiles:

| Profile | Configuration | Intended use |
| --- | --- | --- |
| [Low-cost demo](../deploy/eks-demo/README.md) | `deployment_profile = "demo"` | Disposable demos and EKS learning |
| [Two-AZ EKS](../deploy/eks-ha/README.md) | `deployment_profile = "ha"` | Production-oriented facility deployment |

The `demo` default is deliberately compact:

- one EKS control plane;
- two fixed x86 Spot small nodes (t3.small/t3a.small) in public subnets;
- one private, single-AZ RDS PostgreSQL db.t3.micro instance with 20 GiB gp3 storage;
- public ALB subnets, private EKS control-plane subnets, and isolated database subnets across two AZs;
- no NAT Gateway, so demo workers use public IPs for ECR and AWS API egress;
- Argo CD exposed only as a ClusterIP service;
- a GitOps Application that reconciles this repository's Kubernetes manifests;
- an AWS Load Balancer Controller with a Pod Identity role; and
- Metrics Server, two CPU/memory HorizontalPodAutoscalers, and a capped
  Karpenter Spot scale-out pool with interruption handling; and
- a public-overlay ALB Ingress for PostPilot. The base manifests remain internal.

This is a low-cost **two-node EKS pilot with capped Spot scale-out**, not a high-availability production topology. It uses Spot nodes, which can be interrupted or temporarily unavailable, and must not be used for essential workloads. Use the [two-AZ profile](../deploy/eks-ha/README.md) for private On-Demand workers, one NAT Gateway per AZ, and Multi-AZ RDS. EKS also charges for the control plane independently of EC2 nodes, and EC2, RDS, storage, network, public-IP, NAT, SQS, and Secrets Manager charges remain separate. Read the current [Amazon EKS pricing](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html#eks-pricing) before creating the cluster.

For a live facility, start with this only as a pilot. Use one NAT Gateway per AZ, larger nodes with headroom, RDS deletion protection and Multi-AZ, a restrictive API CIDR allow-list, and stronger backup/monitoring policies.

## Architecture

~~~text
GitHub Actions
  ├── validates Next.js and Terraform on every PR/push
  ├── builds three immutable private ECR images on main
  │     runtime:        ACCOUNT.dkr.ecr.REGION.amazonaws.com/postpilot:<commit-sha>
  │     migrations:     ACCOUNT.dkr.ecr.REGION.amazonaws.com/postpilot:migrations-<commit-sha>
  │     demo seed:      ACCOUNT.dkr.ecr.REGION.amazonaws.com/postpilot:api-seed-<commit-sha> (manual only)
  └── commits those image references into both profile-specific Kubernetes folders
                                      │
                                      ▼
                      Argo CD watches this Git repository
                                      │
                                      ▼
                 PreSync migration Job → PostPilot Deployment
                                      │
                                      ▼
                       private RDS PostgreSQL micro
~~~

Argo CD pulls **Git desired state**, not an artefact directly from GitHub Actions. The workflow's GitOps commit is the hand-off: Actions publishes immutable images, writes their tags to Git, then Argo CD detects and reconciles that commit. This avoids giving CI direct Kubernetes credentials for everyday application releases.

## Prerequisites

- Terraform 1.7+, AWS CLI, kubectl, and access to an AWS account.
- A GitHub repository. The supplied Argo Application can read a public repository without extra configuration. For private repositories configure an Argo CD repository credential using a GitHub App or deploy key.
- `jq` for reading the RDS-managed credential from AWS Secrets Manager.

## Step-by-step: a first demo deployment

This path creates the low-cost **pilot** environment described above and loads the five fictional demo post houses. It is not a production-data bootstrap: the demo seed deliberately replaces its own known fixture organisations. Do not run it against a facility database containing real work.

### 1. Put the repository on GitHub

Create an empty GitHub repository, then connect and push this checkout. If `origin` already exists, omit the first command.

~~~bash
git remote add origin https://github.com/YOUR_ORG/postpilot.git
git push -u origin main
~~~

In **GitHub → Settings → Actions → General**, set **Workflow permissions** to **Read and write permissions**. The first image build happens after Terraform creates the private Amazon ECR repository and its GitHub OIDC publishing role in step 4.

### 2. Install and authenticate the local operator tools

Install AWS CLI, Terraform, kubectl, and jq on the machine you will use to administer the cluster. Sign in to AWS using your usual short-lived credentials (for example AWS IAM Identity Center), choose a region, and confirm the account:

~~~bash
aws configure sso
aws sts get-caller-identity
~~~

This machine needs outbound HTTPS access to AWS. It does not need a bastion host. After creation, kubectl will talk to the EKS public API endpoint, restricted by the CIDR you choose below.

### 3. Create encrypted Terraform state storage

Run this once per AWS account/region. It creates the encrypted, versioned state bucket and a legacy compatibility lock table. The main deployment uses Terraform's current native S3 lockfile mechanism; do not remove the existing table while this bootstrap state still manages it.

~~~bash
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars: choose globally unique bucket_name and a lock_table_name.
terraform init
terraform apply
~~~

### 4. Configure and create EKS, RDS, Argo CD, and ECR

Use your current public IP for the initial EKS API allow-list. Replace it with an office/VPN CIDR if appropriate. In `infra/terraform/terraform.tfvars`, set both `gitops_repo_url` and `github_repository` to your GitHub repository, then set `cluster_endpoint_public_access_cidrs` to the resulting `/32` value.

~~~bash
cd ../terraform
cp terraform.tfvars.example terraform.tfvars
MY_IP=$(curl -fsSL https://checkip.amazonaws.com | tr -d '\n')
# Edit terraform.tfvars before continuing.
# Example: cluster_endpoint_public_access_cidrs = ["${MY_IP}/32"]

terraform init \
  -backend-config="bucket=YOUR_STATE_BUCKET" \
  -backend-config="key=postpilot/terraform.tfstate" \
  -backend-config="region=us-east-1" \
  -backend-config="encrypt=true" \
  -backend-config="use_lockfile=true"
terraform plan
terraform apply
~~~

Keep the generated `terraform.tfvars` out of Git. This apply creates billable AWS resources. Review the plan and current AWS pricing before approving it.

### 5. Authorise GitHub Actions to publish to ECR

Terraform creates a private ECR repository, grants the EKS node role read-only access, and creates a narrowly-scoped GitHub OIDC publish role. In **GitHub → Settings → Environments → production**, create these variables using the Terraform outputs:

~~~bash
terraform output -raw github_ecr_publish_role_arn
terraform output -raw ecr_repository_url
~~~

| GitHub environment variable | Value |
| --- | --- |
| `AWS_REGION` | The region used for Terraform, e.g. `us-east-1` |
| `AWS_ECR_PUBLISH_ROLE_ARN` | `github_ecr_publish_role_arn` output |
| `ECR_REPOSITORY_URL` | `ecr_repository_url` output |

From the **Actions** tab, run **Build and publish PostPilot** manually, or push a new commit to `main`. It authenticates with GitHub OIDC, pushes immutable images to ECR, and commits the ECR image tags to the GitOps manifests. EKS pulls private ECR images with its node IAM role: no Kubernetes image-pull secret, GitHub package, or long-lived AWS key is required.

### 6. Create the application secret in AWS Secrets Manager

Terraform creates the empty `postpilot/application` Secrets Manager record, and the EKS Secrets Store CSI add-on retrieves it using a Pod Identity role limited to that one secret. Its values are synchronised to the runtime `postpilot-secrets` Kubernetes Secret only for containers that need environment variables. Use `POSTPILOT_SESSION_SECRET` and `POSTPILOT_FRONTEND_ORIGINS` for new installations. The current Kubernetes secret mapping also accepts the historical `NEXTAUTH_SECRET`/`NEXTAUTH_URL` keys so an existing deployment can move to FastAPI without a secret-rotation outage.

Microsoft Entra SSO remains disabled by default. Its Entra client ID, API
audience, authority, allowed directory IDs, redirect URI, and delegated scope
are configuration identifiers rather than secrets. The browser-facing
`NEXT_PUBLIC_POSTPILOT_MSAL_*` values are compiled into the Next.js image, so
they belong in the image-build configuration rather than AWS Secrets Manager.
See [the Entra SSO guide](../docs/microsoft-entra-sso.md) before enabling it;
do not add an Azure client secret for the SPA PKCE flow.

~~~bash
aws eks update-kubeconfig --region us-east-1 --name postpilot-eks
RDS_SECRET_ARN=$(terraform output -raw rds_master_user_secret_arn)
RDS_SECRET=$(aws secretsmanager get-secret-value --secret-id "$RDS_SECRET_ARN" --query SecretString --output text)
RDS_USERNAME=$(printf '%s' "$RDS_SECRET" | jq -r .username)
RDS_PASSWORD=$(printf '%s' "$RDS_SECRET" | jq -r .password)
RDS_HOST=$(terraform output -raw rds_endpoint)
AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
APP_SECRET_NAME=$(terraform output -raw application_secrets_manager_name)

jq -n \
  --arg database_url "postgres://${RDS_USERNAME}:${RDS_PASSWORD}@${RDS_HOST}:5432/postpilot?sslmode=require" \
  --arg session_secret "$AUTH_SECRET" \
  --arg frontend_origins 'http://localhost:3000' \
  '{DATABASE_URL: $database_url, POSTPILOT_SESSION_SECRET: $session_secret, POSTPILOT_FRONTEND_ORIGINS: $frontend_origins, POSTPILOT_DEBUG_DEMO: "true"}' \
  | aws secretsmanager put-secret-value --secret-id "$APP_SECRET_NAME" --secret-string file:///dev/stdin
~~~

Argo CD selects `deploy/eks-demo/kubernetes` or `deploy/eks-ha/kubernetes`
from `deployment_profile`. Each profile owns a complete Kubernetes manifest
set and its own immutable image references. Argo CD first runs a PreSync
secret-sync Job, which mounts the AWS secret and creates `postpilot-secrets`;
it then runs the migration Job. Check both complete before proceeding:

~~~bash
kubectl -n postpilot get jobs,pods,svc
kubectl -n postpilot logs job/postpilot-secrets-sync
kubectl -n postpilot logs job/postpilot-migrations
~~~

### 7. Initialise demo data once

The seed Job is deliberately not part of Argo CD. Run it only to create the disposable example workspace:

~~~bash
kubectl -n postpilot apply -f deploy/eks-demo/kubernetes/demo-seed.yaml
kubectl -n postpilot logs -f job/postpilot-demo-seed
~~~

The demo credentials are defined by `backend/app/demo_seed.py` and use the password `password`; `maya@postpilot.debug` is the multi-tenant administrator. To deliberately rerun the fixture seed, delete the completed Job first. This replaces only its five fixed demo organisations, but it still destroys changes inside those demo tenants.

~~~bash
kubectl -n postpilot delete job postpilot-demo-seed
kubectl -n postpilot apply -f deploy/eks-demo/kubernetes/demo-seed.yaml
~~~

For a real facility, leave `POSTPILOT_DEBUG_DEMO` set to `false`, do not use this Job, and provision the first organization and administrator through an approved onboarding/bootstrap process. That production bootstrap flow is not included in this initial infrastructure package.

### 8. Open PostPilot and Argo CD

Argo CD remains private. The demo overlay creates an internet-facing HTTP
Application Load Balancer for PostPilot. Get its generated AWS hostname with:

~~~bash
kubectl -n postpilot get ingress postpilot
~~~

Until a domain and ACM certificate are configured, the **demo** profile can use
that hostname with `http://`. Update `POSTPILOT_FRONTEND_ORIGINS` in
`postpilot/application` to exactly that origin and restart the deployment. The
HA overlay intentionally creates no public listener until its ACM-backed HTTPS
ingress example is completed; see [the HA instructions](../deploy/eks-ha/README.md).
Keep two terminals open if you also want local service access or private Argo
CD access:

~~~bash
# Terminal 1: PostPilot
kubectl -n postpilot port-forward svc/postpilot 3000:80

# Terminal 2: Argo CD
kubectl -n argocd port-forward svc/argocd-server 8080:80
~~~

Open http://localhost:3000 for locally port-forwarded PostPilot and
http://localhost:8080 for Argo CD. Retrieve the one-time Argo CD password with:

~~~bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 --decode; echo
~~~

Sign in to Argo CD as `admin`, then rotate or disable that initial account.
Before a real facility deployment, add a domain and ACM certificate, change the
Ingress to HTTPS-only, and update `POSTPILOT_FRONTEND_ORIGINS` in `postpilot/application` to
the exact public HTTPS origin. Restart the PostPilot Deployment after changing
an environment-variable secret. The CSI driver refreshes its Kubernetes Secret
mirror from AWS Secrets Manager every two minutes; a restart is still required
because environment variables are fixed when a container starts.

## First cluster deployment

The concise version below is retained as a reference for experienced operators. New installations should follow the detailed walkthrough above.

1. Copy and edit the variable example:

   ~~~bash
   # One-time: create encrypted, versioned remote state.
   cd infra/bootstrap
   cp terraform.tfvars.example terraform.tfvars
   terraform init
   terraform apply

   # Then configure the actual cluster.
   cd infra/terraform
   cp terraform.tfvars.example terraform.tfvars
   ~~~

2. Set **gitops_repo_url** to the repository URL. Replace the API CIDR placeholder with the office/VPN/administrator egress IP range. Configure the cluster project to use the bootstrap state values:

   ~~~bash
   terraform init \
     -backend-config="bucket=YOUR_STATE_BUCKET" \
     -backend-config="key=postpilot/terraform.tfstate" \
     -backend-config="region=us-east-1" \
     -backend-config="encrypt=true" \
     -backend-config="use_lockfile=true"
   ~~~

3. Review the plan and apply it from a secured operator machine. The first apply is intentionally local: the GitHub Actions Terraform role and remote state bucket are infrastructure-account bootstrap concerns.

   ~~~bash
   terraform plan
   terraform apply
   ~~~

4. Configure kubectl using the Terraform output, then retrieve the RDS-managed credentials and create the application secret in AWS Secrets Manager. The CSI driver synchronises the necessary runtime values into Kubernetes; neither the database URL nor FastAPI session secret is committed to Git:

   ~~~bash
   aws eks update-kubeconfig --region us-east-1 --name postpilot-eks
   RDS_SECRET_ARN=$(terraform output -raw rds_master_user_secret_arn)
   RDS_SECRET=$(aws secretsmanager get-secret-value --secret-id "$RDS_SECRET_ARN" --query SecretString --output text)
   RDS_USERNAME=$(printf '%s' "$RDS_SECRET" | jq -r .username)
   RDS_PASSWORD=$(printf '%s' "$RDS_SECRET" | jq -r .password)
   RDS_HOST=$(terraform output -raw rds_endpoint)
   APP_SECRET_NAME=$(terraform output -raw application_secrets_manager_name)
   jq -n \
     --arg database_url "postgres://${RDS_USERNAME}:${RDS_PASSWORD}@${RDS_HOST}:5432/postpilot?sslmode=require" \
     --arg session_secret "$(openssl rand -base64 48 | tr -d '\n')" \
     --arg frontend_origins 'https://postpilot.example.com' \
     '{DATABASE_URL: $database_url, POSTPILOT_SESSION_SECRET: $session_secret, POSTPILOT_FRONTEND_ORIGINS: $frontend_origins, POSTPILOT_DEBUG_DEMO: "false"}' \
     | aws secretsmanager put-secret-value --secret-id "$APP_SECRET_NAME" --secret-string file:///dev/stdin
   ~~~

   Argo CD will first synchronise the AWS secret, then retry the migration and application. The default Service is ClusterIP. The demo overlay adds an HTTP ALB Ingress; the HA overlay requires an explicitly configured ACM-backed HTTPS ingress. Use the base manifests directly only for a private/VPN-only installation.

5. Get the initial Argo CD password and access it without exposing a public service:

   ~~~bash
   kubectl -n argocd get secret argocd-initial-admin-secret \
     -o jsonpath='{.data.password}' | base64 --decode; echo
   kubectl -n argocd port-forward svc/argocd-server 8080:80
   ~~~

   Browse to http://localhost:8080 and sign in as **admin**. Rotate or disable the initial admin account after setting up your preferred Argo CD access controls.

## GitHub Actions configuration

The **Build and publish PostPilot** workflow publishes private images to Amazon ECR, using GitHub's short-lived OIDC identity. It needs `contents: write` to commit immutable image references for Argo CD and the three `production` environment variables described in step 5. The managed EKS node group already has `AmazonEC2ContainerRegistryReadOnly`, so it can pull from the private repository without an image-pull secret.

For the optional **Terraform EKS** workflow, create a protected GitHub environment named **production** and set these environment variables:

| Variable | Purpose |
| --- | --- |
| AWS_REGION | Region used by Terraform |
| AWS_TERRAFORM_ROLE_ARN | Short-lived OIDC-assumed role for Terraform |
| TF_STATE_BUCKET | Existing versioned, encrypted S3 state bucket |
| GITOPS_REPO_URL | HTTPS URL for the repository Argo CD should reconcile |

The AWS IAM trust policy must limit GitHub OIDC to this repository and the protected **production** environment. GitHub recommends OIDC instead of long-lived AWS keys and AWS requires a condition on the GitHub subject claim. See [GitHub's OIDC guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws) and the [AWS IAM guidance](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html).

## Operations

~~~bash
# Validate the infrastructure locally
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate

# Check the delivery state
kubectl -n argocd get applications.argoproj.io postpilot
kubectl -n postpilot get jobs,pods,svc
kubectl -n postpilot logs job/postpilot-migrations

# Confirm the resource-metrics API and the application autoscalers.
kubectl top nodes
kubectl -n postpilot top pods
kubectl -n postpilot get hpa
kubectl -n postpilot describe hpa postpilot
kubectl -n postpilot describe hpa postpilot-api

# Inspect Karpenter's provisioner and dynamically created capacity.
kubectl get nodepools.karpenter.sh,ec2nodeclasses.karpenter.k8s.aws
kubectl get nodeclaims.karpenter.sh
kubectl -n kube-system logs deployment/karpenter --tail=100
~~~

### Lean CloudWatch logging

This stack deliberately enables **Standard Container Insights**, not Enhanced
Container Insights. Standard mode retains CloudWatch history for cluster and
node CPU, memory, network, disk, Pod health, and restarts. Enhanced mode
collects high-cardinality observations for every node, Pod, and container and
is deliberately disabled because it is disproportionally expensive for this
small deployment.

Instead, the pinned `aws-for-fluent-bit` DaemonSet runs as cluster
infrastructure in `kube-system`, but tails only container log files from the
`postpilot` namespace and writes them to the seven-day
`/postpilot/application` log group. The supported CloudWatch agent writes only
the short-retention standard performance group required for resource history.
It does not collect container logs, host logs, dataplane logs, traces,
Application Signals, OTel metrics, GPU metrics, or logs from Argo CD and
Kubernetes system components. FastAPI access logging remains off; the intended
application-log signal is PostPilot startup output and unexpected errors.

A single lightweight Event Exporter also watches Kubernetes Events and writes
only `Warning` events to `/postpilot/kubernetes-events`. This preserves useful
failure evidence—such as image-pull, scheduling, volume-mount, eviction, and
restart events—without forwarding normal scheduling chatter. It uses a
seven-day retention period and is separate from application logs.

~~~bash
# Live application logs in Kubernetes
kubectl -n postpilot logs -f deployment/postpilot
kubectl -n postpilot logs -f deployment/postpilot-api

# Confirm the narrow forwarder is healthy after Terraform applies
kubectl -n kube-system get pods -l app.kubernetes.io/instance=postpilot-log-forwarder
kubectl -n kube-system logs daemonset/postpilot-log-forwarder --tail=100

# Kubernetes Warning Events, retained in CloudWatch by the Event Exporter
kubectl -n postpilot logs deployment/postpilot-event-exporter --tail=100
aws logs tail /postpilot/kubernetes-events --region eu-west-1 --since 1h
~~~

Keep `application_log_retention_days = 7` for the demo unless a facility's
retention policy requires longer. The remaining CloudWatch alarms cover
PostPilot server errors and optional ALB health. Watch Cost Explorer for the
absence of `ObservationUsage`; Standard Container Insights is billed through
embedded-metric and data-processing usage instead.

The migration Job is an Argo CD PreSync hook. If a migration fails, the release does not advance to the new deployment. Fix the migration or restore from a tested backup; do not delete migration history to force a sync.

### Autoscaling behaviour

Metrics Server provides the CPU and memory API used by `kubectl top` and the
two application HPAs. Both `postpilot` and `postpilot-api` have a fixed
minimum of two replicas, scale to at most four when average CPU reaches 70% or
memory reaches 80% of their declared requests, and wait five minutes before
scaling down. The HPAs do not replace the deployment resource requests; those
requests are the baseline that makes utilisation meaningful.

Karpenter does **not** replace the two managed baseline nodes. In the demo
profile it watches for Pods that cannot be scheduled and may add only
`t3.small` or `t3a.small` x86 Spot instances, with an aggregate dynamic-pool
limit of 4 vCPUs and 8 GiB. It consolidates empty or under-used Karpenter nodes
after five minutes and receives Spot interruption, rebalance, EC2 state-change,
capacity-reservation, and AWS Health events through its dedicated SQS queue.
The two-AZ profile retains its two On-Demand baseline nodes in private subnets;
review Karpenter's instance types and limits before allowing additional
capacity in a live facility environment.

## Cost and resilience decisions

| Choice | Saves | Trade-off |
| --- | --- | --- |
| Two baseline Spot small nodes plus capped Karpenter Spot scale-out | Keeps a predictable two-node floor while allowing short bursts to receive capacity | Spot capacity can be reclaimed or unavailable; Karpenter adds SQS/EventBridge and occasional dynamic-node cost, so this is unsuitable for essential facility operations. |
| Single-AZ RDS db.t3.micro | Lowest RDS PostgreSQL class/storage baseline | No database failover; deletion protection is off and the final snapshot is skipped for low-cost iteration. |
| Demo: public workers and no NAT Gateway | Avoids NAT Gateway and public-IP costs for a disposable learning environment | Worker nodes have public IPs and there is no private-node egress resilience; never use for a live facility deployment. |
| Two-AZ: private On-Demand workers, one NAT Gateway per AZ, isolated database subnets | Keeps normal worker traffic private and preserves egress if one NAT/AZ fails | Higher fixed NAT and compute cost; use a separate state and capacity-test the node sizes. |
| ClusterIP services with a deliberate public ALB overlay | Internal services do not each create a load balancer | The public overlay creates one ALB and needs normal HTTP/HTTPS edge hardening. |

The application uses the RDS master user only as a bootstrap simplification. After the first migration, create a least-privilege application database user and update `postpilot/application` in AWS Secrets Manager; AWS recommends applications avoid using the RDS master user directly. [RDS PostgreSQL guidance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.MasterAccounts.html) and [Argo CD automated sync guidance](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/) explain the underlying platform behaviour.
