variable "aws_region" {
  description = "AWS region. us-east-1 is the cost-focused default; choose the facility's appropriate data-residency region instead where required."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short, lower-case identifier used to name AWS resources."
  type        = string
  default     = "postpilot"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,22}$", var.project_name))
    error_message = "project_name must be 2-23 lower-case letters, numbers, or hyphens and start with a letter."
  }
}

variable "cluster_name" {
  description = "Optional explicit EKS cluster name."
  type        = string
  default     = null
}

variable "kubernetes_version" {
  description = "EKS Kubernetes minor version. Keep this on a version with EKS standard support."
  type        = string
  default     = "1.35"
}

variable "vpc_cidr" {
  description = "CIDR for the compact EKS VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "cluster_endpoint_public_access_cidrs" {
  description = "CIDRs permitted to use the EKS API endpoint. Set this to your current public IP, VPN, or office egress ranges."
  type        = list(string)

  validation {
    condition = length(var.cluster_endpoint_public_access_cidrs) > 0 && alltrue([
      for cidr in var.cluster_endpoint_public_access_cidrs : cidr != "0.0.0.0/0"
    ])
    error_message = "cluster_endpoint_public_access_cidrs must contain at least one restricted CIDR and must not include 0.0.0.0/0."
  }
}

variable "node_instance_types" {
  description = "Compatible x86_64 Spot small instances for the fixed two-node managed group."
  type        = list(string)
  default     = ["t3.small", "t3a.small"]
}

variable "node_min_size" {
  description = "Minimum Spot nodes. Two is the fixed baseline for this non-essential pilot configuration."
  type        = number
  default     = 2
}

variable "node_desired_size" {
  description = "Desired Spot nodes."
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Maximum Spot nodes. Keep this at two for the fixed small-node baseline."
  type        = number
  default     = 2
}

variable "rds_instance_class" {
  description = "RDS PostgreSQL instance class. db.t3.micro is the low-cost default."
  type        = string
  default     = "db.t3.micro"
}

variable "rds_allocated_storage_gb" {
  description = "Allocated gp3 storage for the PostgreSQL instance. RDS requires at least 20 GiB for this configuration."
  type        = number
  default     = 20
}

variable "argocd_chart_version" {
  description = "Pinned Argo CD Helm chart version. Upgrade deliberately after testing."
  type        = string
  default     = "10.1.3"
}

variable "gitops_repo_url" {
  description = "HTTPS Git repository Argo CD watches for the PostPilot Kubernetes manifests. A public repository works without an Argo repository credential."
  type        = string
}

variable "github_repository" {
  description = "GitHub owner/repository allowed to publish PostPilot images through the production environment, for example YOUR-ORG/postpilot."
  type        = string

  validation {
    condition     = can(regex("^[^/]+/[^/]+$", var.github_repository))
    error_message = "github_repository must be in OWNER/REPOSITORY form."
  }
}

variable "github_oidc_subjects" {
  description = "Optional exact GitHub Actions OIDC subject claims allowed to publish images. Leave null for standard production-environment and main-branch subjects derived from github_repository; set it if GitHub has a custom OIDC subject template."
  type        = list(string)
  default     = null

  validation {
    condition     = var.github_oidc_subjects == null || (length(var.github_oidc_subjects) > 0 && alltrue([for subject in var.github_oidc_subjects : startswith(subject, "repo:")]))
    error_message = "github_oidc_subjects must contain at least one GitHub repository OIDC subject beginning with repo:."
  }
}

variable "github_oidc_provider_arn" {
  description = "Optional existing GitHub Actions OIDC provider ARN. Set this when the AWS account already manages token.actions.githubusercontent.com outside this Terraform state."
  type        = string
  default     = null
}

variable "gitops_target_revision" {
  description = "Git branch, tag, or commit Argo CD should reconcile."
  type        = string
  default     = "main"
}

variable "gitops_manifest_path" {
  description = "Kustomize path within gitops_repo_url used by the Argo CD Application."
  type        = string
  default     = "deploy/kubernetes/base"
}

variable "tags" {
  description = "Extra tags merged into all Terraform-managed AWS resources."
  type        = map(string)
  default     = {}
}
