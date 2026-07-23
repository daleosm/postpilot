# PostPilot EKS deployment

This directory supplies a deliberately compact EKS and Argo CD footprint for a pilot or small self-hosted PostPilot installation:

- one EKS control plane;
- two fixed x86 Spot small nodes (t3.small/t3a.small);
- one private, single-AZ RDS PostgreSQL db.t3.micro instance with 20 GiB gp3 storage;
- public subnets and no NAT gateway, which avoids the usual fixed NAT cost;
- Argo CD exposed only as a ClusterIP service;
- a GitOps Application that reconciles this repository's Kubernetes manifests;
- no load balancer, ingress controller, or DNS zone created by default.

This is a low-cost **fixed two-node EKS pilot** profile, not a high-availability production topology. It uses two Spot nodes, which can be interrupted or temporarily unavailable, and must not be used for essential workloads. EKS also charges for the control plane independently of EC2 nodes, and EC2, RDS, storage, network, public-IP, and Secrets Manager charges remain separate. Read the current [Amazon EKS pricing](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html#eks-pricing) before creating the cluster.

For a live facility, start with this only as a pilot. Move application nodes into private networking, use larger nodes with headroom, turn on RDS deletion protection and Multi-AZ, set a restrictive API CIDR allow-list, and add backups/monitoring.

## Architecture

~~~text
GitHub Actions
  ├── validates Next.js and Terraform on every PR/push
  ├── builds three immutable private ECR images on main
  │     runtime:        ACCOUNT.dkr.ecr.REGION.amazonaws.com/postpilot:<commit-sha>
  │     migrations:     ACCOUNT.dkr.ecr.REGION.amazonaws.com/postpilot:migrations-<commit-sha>
  │     demo seed:      ACCOUNT.dkr.ecr.REGION.amazonaws.com/postpilot:seed-<commit-sha> (manual only)
  └── commits those image references into deploy/kubernetes/base
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

Terraform creates the empty `postpilot/application` Secrets Manager record, and the EKS Secrets Store CSI add-on retrieves it using a Pod Identity role limited to that one secret. Its values are synchronised to the runtime `postpilot-secrets` Kubernetes Secret only for containers that need environment variables. Start with the local port-forward URL below, then replace `NEXTAUTH_URL` with your real HTTPS address before exposing the app publicly.

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
  --arg nextauth_secret "$AUTH_SECRET" \
  --arg nextauth_url 'http://localhost:3000' \
  '{DATABASE_URL: $database_url, NEXTAUTH_SECRET: $nextauth_secret, NEXTAUTH_URL: $nextauth_url, POSTPILOT_DEBUG_DEMO: "true"}' \
  | aws secretsmanager put-secret-value --secret-id "$APP_SECRET_NAME" --secret-string file:///dev/stdin
~~~

Argo CD first runs a PreSync secret-sync Job, which mounts the AWS secret and creates `postpilot-secrets`; it then runs the migration Job. Check both complete before proceeding:

~~~bash
kubectl -n postpilot get jobs,pods,svc
kubectl -n postpilot logs job/postpilot-secrets-sync
kubectl -n postpilot logs job/postpilot-migrations
~~~

### 7. Initialise demo data once

The seed Job is deliberately not part of Argo CD. Run it only to create the disposable example workspace:

~~~bash
kubectl -n postpilot apply -f deploy/kubernetes/jobs/demo-seed.yaml
kubectl -n postpilot logs -f job/postpilot-demo-seed
~~~

The demo credentials are the seeded email addresses from `scripts/seed.ts` and the password `password`; `maya@postpilot.debug` is the multi-tenant administrator. To deliberately rerun the fixture seed, delete the completed Job first. This replaces only its five fixed demo organisations, but it still destroys changes inside those demo tenants.

~~~bash
kubectl -n postpilot delete job postpilot-demo-seed
kubectl -n postpilot apply -f deploy/kubernetes/jobs/demo-seed.yaml
~~~

For a real facility, leave `POSTPILOT_DEBUG_DEMO` set to `false`, do not use this Job, and provision the first organization and administrator through an approved onboarding/bootstrap process. That production bootstrap flow is not included in this initial infrastructure package.

### 8. Open PostPilot and Argo CD privately

No public load balancer is created by default. Keep two terminals open while testing:

~~~bash
# Terminal 1: PostPilot
kubectl -n postpilot port-forward svc/postpilot 3000:80

# Terminal 2: Argo CD
kubectl -n argocd port-forward svc/argocd-server 8080:80
~~~

Open http://localhost:3000 for PostPilot and http://localhost:8080 for Argo CD. Retrieve the one-time Argo CD password with:

~~~bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 --decode; echo
~~~

Sign in to Argo CD as `admin`, then rotate or disable that initial account. When you are ready for a real URL, deploy a TLS-enabled ingress or private VPN/reverse proxy and update `NEXTAUTH_URL` in `postpilot/application` in AWS Secrets Manager to the exact public HTTPS origin. Restart the PostPilot Deployment after changing an environment-variable secret.

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

4. Configure kubectl using the Terraform output, then retrieve the RDS-managed credentials and create the application secret in AWS Secrets Manager. The CSI driver synchronises the necessary runtime values into Kubernetes; neither the database URL nor Auth.js secret is committed to Git:

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
     --arg nextauth_secret "$(openssl rand -base64 48 | tr -d '\n')" \
     --arg nextauth_url 'https://postpilot.example.com' \
     '{DATABASE_URL: $database_url, NEXTAUTH_SECRET: $nextauth_secret, NEXTAUTH_URL: $nextauth_url, POSTPILOT_DEBUG_DEMO: "false"}' \
     | aws secretsmanager put-secret-value --secret-id "$APP_SECRET_NAME" --secret-string file:///dev/stdin
   ~~~

   Argo CD will first synchronise the AWS secret, then retry the migration and application. The default Service is ClusterIP; use a secure internal ingress/VPN for production. The **public** Kustomize overlay intentionally creates a cloud load balancer and therefore increases cost.

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
~~~

The migration Job is an Argo CD PreSync hook. If a migration fails, the release does not advance to the new deployment. Fix the migration or restore from a tested backup; do not delete migration history to force a sync.

## Cost and resilience decisions

| Choice | Saves | Trade-off |
| --- | --- | --- |
| Two Spot small nodes | Lower worker compute cost with enough practical pod/memory headroom for this pilot | Spot capacity can be reclaimed or unavailable; this is unsuitable for essential facility operations. |
| Single-AZ RDS db.t3.micro | Lowest RDS PostgreSQL class/storage baseline | No database failover; deletion protection is off and the final snapshot is skipped for low-cost iteration. |
| Public subnets, no NAT gateway | A fixed NAT gateway charge | Requires deliberate network/API allow-list and database connectivity design. |
| ClusterIP services | Load balancer cost | Access requires a private ingress, VPN, port-forward, or a deliberate public overlay. |

The application uses the RDS master user only as a bootstrap simplification. After the first migration, create a least-privilege application database user and update `postpilot/application` in AWS Secrets Manager; AWS recommends applications avoid using the RDS master user directly. [RDS PostgreSQL guidance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.MasterAccounts.html) and [Argo CD automated sync guidance](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/) explain the underlying platform behaviour.
