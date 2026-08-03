variable "aws_region" {
  description = "AWS region. us-east-1 is the cost-focused default; choose the facility's appropriate data-residency region instead where required."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short, lower-case identifier used to name AWS resources."
  type        = string
  default     = "postpilot-demo"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,22}$", var.project_name))
    error_message = "project_name must be 2-23 lower-case letters, numbers, or hyphens and start with a letter."
  }
}

# This is deliberately fixed by the root validation. It remains a declared
# variable solely so a prior demo tfvars file can move here without a rewrite.
variable "deployment_profile" {
  description = "Fixed deployment topology for this Terraform root."
  type        = string
  default     = "demo"

  validation {
    condition     = var.deployment_profile == "demo"
    error_message = "This root is permanently the demo topology. Use deploy/eks-ha/terraform for the two-AZ deployment."
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
  description = "x86_64 managed-node instance types. The demo profile uses Spot capacity; the ha profile uses On-Demand capacity in private subnets."
  type        = list(string)
  default     = ["t3a.small"]
}

variable "node_min_size" {
  description = "Minimum managed-node baseline. Keep at least two for a two-AZ application deployment."
  type        = number
  default     = 2
}

variable "node_desired_size" {
  description = "Desired managed-node baseline."
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Maximum managed-node baseline."
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

variable "rds_multi_az" {
  description = "Enable RDS Multi-AZ failover. The demo profile keeps this false; the ha profile must set it true."
  type        = bool
  default     = false
}

variable "rds_deletion_protection" {
  description = "Prevent accidental RDS deletion. Set true for a live facility database."
  type        = bool
  default     = false
}

variable "rds_backup_retention_days" {
  description = "Number of days of RDS automated backups to retain."
  type        = number
  default     = 1

  validation {
    condition     = var.rds_backup_retention_days >= 1 && var.rds_backup_retention_days <= 35
    error_message = "rds_backup_retention_days must be between 1 and 35."
  }
}

variable "rds_skip_final_snapshot" {
  description = "Whether Terraform skips a final RDS snapshot on deletion. This must be false for a live facility database."
  type        = bool
  default     = true
}

variable "rds_final_snapshot_identifier" {
  description = "Unique final snapshot identifier used when rds_skip_final_snapshot is false."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.rds_skip_final_snapshot || var.rds_final_snapshot_identifier != null
    error_message = "rds_final_snapshot_identifier is required when rds_skip_final_snapshot is false."
  }
}

variable "argocd_chart_version" {
  description = "Pinned Argo CD Helm chart version. Upgrade deliberately after testing."
  type        = string
  default     = "10.1.3"
}

variable "metrics_server_chart_version" {
  description = "Pinned official Metrics Server Helm chart version. Metrics Server supplies the resource metrics used by HorizontalPodAutoscalers and kubectl top."
  type        = string
  default     = "3.13.1"
}

variable "kube_prometheus_stack_chart_version" {
  description = "Pinned kube-prometheus-stack Helm chart version for Prometheus, Grafana, and Kubernetes metrics. Upgrade deliberately after reviewing its release notes."
  type        = string
  default     = "88.1.3"
}

variable "prometheus_retention" {
  description = "Prometheus metric retention for this disposable demo cluster."
  type        = string
  default     = "7d"
}

variable "prometheus_storage_size" {
  description = "Persistent gp3 volume size for demo Prometheus metrics."
  type        = string
  default     = "10Gi"
}

variable "grafana_storage_size" {
  description = "Persistent gp3 volume size for demo Grafana dashboards and configuration."
  type        = string
  default     = "5Gi"
}

variable "aws_for_fluent_bit_chart_version" {
  description = "Pinned AWS for Fluent Bit chart used for PostPilot-only CloudWatch log forwarding. This intentionally replaces the broad CloudWatch Observability add-on."
  type        = string
  default     = "0.2.0"
}

variable "karpenter_chart_version" {
  description = "Pinned Karpenter Helm chart version. Upgrade deliberately after reviewing Karpenter's EKS and Kubernetes compatibility guidance."
  type        = string
  default     = "1.14.0"
}

variable "karpenter_instance_types" {
  description = "Small x86 Spot instance types Karpenter may launch for unschedulable PostPilot Pods."
  type        = list(string)
  default     = ["t3.small", "t3a.small"]
}

variable "karpenter_max_cpu" {
  description = "Maximum aggregate vCPU capacity Karpenter may provision. The fixed managed node group remains outside this cap. Four t3.small nodes leave room for the two-replica application alongside the demo monitoring stack."
  type        = number
  default     = 8
}

variable "karpenter_max_memory" {
  description = "Maximum aggregate memory capacity Karpenter may provision, expressed in Kubernetes quantity syntax."
  type        = string
  default     = "16Gi"
}

variable "application_log_retention_days" {
  description = "How long to retain PostPilot logs, warning events, and standard performance telemetry. Three days is the low-cost demo baseline."
  type        = number
  default     = 3

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365], var.application_log_retention_days)
    error_message = "application_log_retention_days must be a supported CloudWatch Logs retention period."
  }
}

variable "observability_alarm_email" {
  description = "Optional email address subscribed to PostPilot CloudWatch alarm notifications. AWS sends a confirmation email before delivery begins."
  type        = string
  default     = null
  nullable    = true
}

variable "cost_alert_email" {
  description = "Optional finance/owner email for free AWS Budget and Cost Anomaly Detection alerts. No cost-monitoring resources are created when unset."
  type        = string
  default     = null
  nullable    = true
}

variable "monthly_cost_budget_usd" {
  description = "Monthly account cost threshold in USD for the optional public-demo budget alerts."
  type        = number
  default     = 50

  validation {
    condition     = var.monthly_cost_budget_usd > 0
    error_message = "monthly_cost_budget_usd must be greater than zero."
  }
}

variable "cost_anomaly_threshold_usd" {
  description = "Minimum unexpected AWS spend increase in USD that triggers the optional immediate anomaly email."
  type        = number
  default     = 5

  validation {
    condition     = var.cost_anomaly_threshold_usd > 0
    error_message = "cost_anomaly_threshold_usd must be greater than zero."
  }
}

variable "public_application_load_balancer_arn_suffix" {
  description = "Optional ARN suffix of the Kubernetes-created public ALB, for example app/postpilot/abc123. Enables ALB 5xx and healthy-target alarms after the Ingress is created."
  type        = string
  default     = null
  nullable    = true
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

variable "tags" {
  description = "Extra tags merged into all Terraform-managed AWS resources."
  type        = map(string)
  default     = {}
}
