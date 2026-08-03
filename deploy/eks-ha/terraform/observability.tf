# Lean, application-only CloudWatch logging.  This intentionally does not use
# the amazon-cloudwatch-observability add-on: its Enhanced Container Insights
# pipeline collects cluster-wide performance observations and logs from every
# Kubernetes workload, which is disproportionate for this small deployment.
#
# A small aws-for-fluent-bit DaemonSet below tails *only* files from the
# postpilot namespace.  FastAPI routine access logs remain disabled, so the
# retained signal is startup, warnings, and unexpected errors from PostPilot.
data "aws_caller_identity" "current" {}

# CloudWatch Logs keeps this group encrypted with its service-managed default.
# No customer-managed KMS key is needed for the standard PostPilot deployment.
#checkov:skip=CKV_AWS_338:Seven-day retention is an intentional low-cost demo baseline; facilities can raise it if policy requires.
resource "aws_cloudwatch_log_group" "postpilot_application" {
  name              = "/${var.project_name}/application"
  retention_in_days = var.application_log_retention_days
}

data "aws_iam_policy_document" "postpilot_log_forwarder_assume_role" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

# This service account may write only to the one PostPilot application group.
# It cannot create groups, emit CloudWatch metrics, use X-Ray, or read logs.
resource "aws_iam_role" "postpilot_log_forwarder" {
  name               = "${local.name}-application-log-forwarder"
  assume_role_policy = data.aws_iam_policy_document.postpilot_log_forwarder_assume_role.json
}

data "aws_iam_policy_document" "postpilot_log_forwarder_write" {
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    resources = [
      "${aws_cloudwatch_log_group.postpilot_application.arn}:*",
      "${aws_cloudwatch_log_group.postpilot_kubernetes_events.arn}:*",
    ]
  }

}

resource "aws_iam_role_policy" "postpilot_log_forwarder_write" {
  name   = "write-postpilot-application-logs"
  role   = aws_iam_role.postpilot_log_forwarder.id
  policy = data.aws_iam_policy_document.postpilot_log_forwarder_write.json
}

# Standard Container Insights retains historical cluster and node resource
# metrics in CloudWatch without the high-cardinality, per-observation Enhanced
# mode. The AWS-managed policy is required by the supported agent for the
# performance-log/embedded-metric pipeline; application logging remains on the
# separate, narrow forwarder role above.
data "aws_iam_policy_document" "cloudwatch_standard_insights_assume_role" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cloudwatch_standard_insights" {
  name               = "${local.name}-standard-container-insights"
  assume_role_policy = data.aws_iam_policy_document.cloudwatch_standard_insights_assume_role.json
}

resource "aws_iam_role_policy_attachment" "cloudwatch_standard_insights_agent" {
  role       = aws_iam_role.cloudwatch_standard_insights.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

# Standard Container Insights writes its aggregated, queryable performance
# events here. The same short retention prevents low-value historic telemetry
# from quietly accumulating storage cost.
#checkov:skip=CKV_AWS_338:Seven-day retention is intentional for a small demo cluster.
resource "aws_cloudwatch_log_group" "postpilot_performance" {
  name              = "/aws/containerinsights/${local.name}/performance"
  retention_in_days = var.application_log_retention_days
}

# Kubernetes Events are not container logs. A compact in-cluster exporter below
# forwards Warning Events here so scheduling, image-pull, mount, eviction, and
# restart failures remain searchable after Kubernetes has discarded them.
#checkov:skip=CKV_AWS_338:Seven-day retention is intentional for a small demo cluster.
resource "aws_cloudwatch_log_group" "postpilot_kubernetes_events" {
  name              = "/${var.project_name}/kubernetes-events"
  retention_in_days = var.application_log_retention_days
}

resource "aws_eks_addon" "pod_identity_agent" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "eks-pod-identity-agent"
  resolve_conflicts_on_create = "OVERWRITE"

  depends_on = [aws_eks_node_group.spot]
}

# Metrics Server is the Kubernetes resource-metrics API used by the two HPAs
# in both profile-specific Kubernetes folders and by kubectl top. It is intentionally separate
# from CloudWatch observability, which is not an autoscaling metrics source.
resource "helm_release" "metrics_server" {
  name             = "metrics-server"
  namespace        = "kube-system"
  repository       = "https://kubernetes-sigs.github.io/metrics-server/"
  chart            = "metrics-server"
  version          = var.metrics_server_chart_version
  create_namespace = false
  wait             = true
  timeout          = 600
  atomic           = true
  cleanup_on_fail  = true

  values = [yamlencode({
    # EKS has two baseline nodes, so two replicas keep the metrics API
    # available while a node is replaced. The chart maintains its own PDB.
    replicas = 2
    podDisruptionBudget = {
      enabled      = true
      minAvailable = 1
    }
    resources = {
      requests = {
        cpu    = "25m"
        memory = "64Mi"
      }
      limits = {
        cpu    = "100m"
        memory = "128Mi"
      }
    }
  })]

  depends_on = [aws_eks_node_group.spot]
}

# The AWS Load Balancer Controller creates and reconciles the application ALB
# from Kubernetes Ingress objects. Keep its AWS permissions separate from the
# node role, then bind them only to its kube-system service account through
# EKS Pod Identity.
resource "aws_iam_policy" "load_balancer_controller" {
  name        = "${local.name}-load-balancer-controller"
  description = "AWS Load Balancer Controller permissions from the AWS-supported v2.14.1 policy."
  policy      = file("${path.module}/policies/aws-load-balancer-controller.json")
}

data "aws_iam_policy_document" "load_balancer_controller_assume_role" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "load_balancer_controller" {
  name               = "${local.name}-load-balancer-controller"
  assume_role_policy = data.aws_iam_policy_document.load_balancer_controller_assume_role.json
}

resource "aws_iam_role_policy_attachment" "load_balancer_controller" {
  role       = aws_iam_role.load_balancer_controller.name
  policy_arn = aws_iam_policy.load_balancer_controller.arn
}

resource "aws_eks_pod_identity_association" "load_balancer_controller" {
  cluster_name    = aws_eks_cluster.this.name
  namespace       = "kube-system"
  service_account = "aws-load-balancer-controller"
  role_arn        = aws_iam_role.load_balancer_controller.arn

  depends_on = [
    aws_eks_addon.pod_identity_agent,
    aws_iam_role_policy_attachment.load_balancer_controller,
  ]
}

# AWS recommends Helm for this controller. Pin the chart deliberately: upgrades
# can include CRD changes and should be reviewed rather than applied implicitly.
resource "helm_release" "aws_load_balancer_controller" {
  name            = "aws-load-balancer-controller"
  namespace       = "kube-system"
  repository      = "https://aws.github.io/eks-charts"
  chart           = "aws-load-balancer-controller"
  version         = "1.14.0"
  wait            = true
  timeout         = 900
  atomic          = true
  cleanup_on_fail = true

  values = [yamlencode({
    clusterName  = aws_eks_cluster.this.name
    region       = var.aws_region
    vpcId        = aws_vpc.this.id
    replicaCount = 2
    serviceAccount = {
      create = true
      name   = "aws-load-balancer-controller"
    }
    resources = {
      requests = {
        cpu    = "100m"
        memory = "128Mi"
      }
      limits = {
        cpu    = "250m"
        memory = "256Mi"
      }
    }
  })]

  depends_on = [aws_eks_pod_identity_association.load_balancer_controller]
}

# Application credentials live in AWS Secrets Manager. This EKS-managed add-on
# mounts them through the AWS Secrets and Configuration Provider (ASCP); it
# also supports syncing selected values into the existing Kubernetes Secret
# required by envFrom without storing secret values in Git or Terraform state.
resource "aws_eks_addon" "secrets_store_csi" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "aws-secrets-store-csi-driver-provider"
  resolve_conflicts_on_create = "OVERWRITE"

  # The application consumes the synced Kubernetes Secret through envFrom.
  # Rotation keeps that mirror aligned with AWS Secrets Manager; restarting the
  # Deployment remains necessary for a process to receive new environment vars.
  configuration_values = jsonencode({
    "secrets-store-csi-driver" = {
      enableSecretRotation = true
      rotationPollInterval = "2m"
    }
  })

  depends_on = [
    aws_eks_addon.pod_identity_agent,
    aws_eks_node_group.spot,
  ]
}

resource "aws_secretsmanager_secret" "postpilot_application" {
  name                    = "${var.project_name}/application"
  description             = "PostPilot runtime configuration for EKS workloads."
  recovery_window_in_days = 7

  # Omitting kms_key_id selects the AWS-managed Secrets Manager key. It keeps
  # the secret encrypted at rest without the customer-managed-key fee or
  # lifecycle overhead. Dedicated enterprise deployments can override this
  # with a customer-managed key when a contract requires it.
}

data "aws_iam_policy_document" "postpilot_secrets_assume_role" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "postpilot_secrets_read" {
  statement {
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
    ]
    resources = [aws_secretsmanager_secret.postpilot_application.arn]
  }

}

resource "aws_iam_role" "postpilot_secrets" {
  name               = "${local.name}-application-secrets"
  assume_role_policy = data.aws_iam_policy_document.postpilot_secrets_assume_role.json
}

resource "aws_iam_role_policy" "postpilot_secrets_read" {
  name   = "read-postpilot-application-secret"
  role   = aws_iam_role.postpilot_secrets.id
  policy = data.aws_iam_policy_document.postpilot_secrets_read.json
}

resource "aws_eks_pod_identity_association" "postpilot_secrets" {
  cluster_name    = aws_eks_cluster.this.name
  namespace       = "postpilot"
  service_account = "postpilot"
  role_arn        = aws_iam_role.postpilot_secrets.arn

  depends_on = [
    aws_eks_addon.pod_identity_agent,
    aws_eks_addon.secrets_store_csi,
    aws_iam_role_policy.postpilot_secrets_read,
  ]
}

resource "aws_eks_pod_identity_association" "postpilot_log_forwarder" {
  cluster_name = aws_eks_cluster.this.name
  # This DaemonSet is cluster infrastructure, so it runs in the namespace that
  # Terraform already owns. It only tails files belonging to postpilot.
  namespace       = "kube-system"
  service_account = "postpilot-log-forwarder"
  role_arn        = aws_iam_role.postpilot_log_forwarder.arn

  depends_on = [
    aws_eks_addon.pod_identity_agent,
    aws_iam_role_policy.postpilot_log_forwarder_write,
  ]
}

# Keep CloudWatch resource history, but deliberately select Standard Container
# Insights. Enhanced mode is the source of the costly ObservationUsage line
# item, so it must remain explicitly false. The add-on's own log, trace, OTel,
# GPU, and exporter features remain disabled; PostPilot logs use the scoped
# Fluent Bit release below instead.
resource "aws_eks_addon" "cloudwatch_standard_insights" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "amazon-cloudwatch-observability"
  resolve_conflicts_on_create = "OVERWRITE"

  pod_identity_association {
    role_arn        = aws_iam_role.cloudwatch_standard_insights.arn
    service_account = "cloudwatch-agent"
  }

  configuration_values = jsonencode({
    containerInsights = {
      enabled = true
    }
    containerLogs = {
      enabled = false
    }
    applicationSignals = {
      enabled = false
    }
    otelContainerInsights = {
      enabled = false
    }
    dcgmExporter = {
      enabled = false
    }
    neuronMonitor = {
      enabled = false
    }
    nodeExporter = {
      enabled = false
    }
    kubeStateMetrics = {
      enabled = false
    }
    agent = {
      resources = {
        requests = {
          cpu    = "50m"
          memory = "64Mi"
        }
        limits = {
          cpu    = "150m"
          memory = "192Mi"
        }
      }
      config = {
        logs = {
          metrics_collected = {
            kubernetes = {
              cluster_name                = local.name
              enhanced_container_insights = false
              accelerated_compute_metrics = false
            }
          }
        }
      }
    }
  })

  depends_on = [
    aws_eks_addon.pod_identity_agent,
    aws_iam_role_policy_attachment.cloudwatch_standard_insights_agent,
    aws_cloudwatch_log_group.postpilot_performance,
  ]
}

# The collector only tails container log files whose Kubernetes namespace is
# postpilot. It does not run Container Insights, collect host/dataplane logs,
# scrape metrics, create log groups, or forward logs from Kubernetes system
# components. Chart values are pinned for predictable GitOps rebuilds.
resource "helm_release" "postpilot_log_forwarder" {
  name             = "postpilot-log-forwarder"
  namespace        = "kube-system"
  repository       = "https://aws.github.io/eks-charts"
  chart            = "aws-for-fluent-bit"
  version          = var.aws_for_fluent_bit_chart_version
  create_namespace = false
  wait             = true
  timeout          = 600
  atomic           = true
  cleanup_on_fail  = true

  values = [yamlencode({
    serviceAccount = {
      create = true
      name   = "postpilot-log-forwarder"
    }
    input = {
      enabled = true
      tag     = "postpilot.*"
      # Event Exporter has its own input/output below. All ordinary PostPilot
      # containers share this input, including migration and secret-sync Jobs.
      path            = "/var/log/containers/*_postpilot_postpilot-*.log,/var/log/containers/*_postpilot_api-*.log,/var/log/containers/*_postpilot_migrate-*.log,/var/log/containers/*_postpilot_sync-*.log"
      db              = "/var/log/postpilot-fluent-bit.db"
      multilineParser = "docker, cri"
      memBufLimit     = "5MB"
      skipLongLines   = "On"
      refreshInterval = 10
    }
    additionalInputs = <<-EOT
      [INPUT]
          Name                tail
          Tag                 kubernetes-events.*
          Path                /var/log/containers/*_postpilot_event-exporter-*.log
          DB                  /var/log/kubernetes-events-fluent-bit.db
          multiline.parser    docker, cri
          Mem_Buf_Limit       1MB
          Skip_Long_Lines     On
          Refresh_Interval    10
    EOT
    # The namespace is enforced by the host file pattern above. Skipping the
    # Kubernetes metadata filter avoids cluster-wide API reads and extra data.
    filter = {
      enabled = false
    }
    cloudWatch = {
      enabled = false
    }
    cloudWatchLogs = {
      enabled           = true
      match             = "postpilot.*"
      region            = var.aws_region
      logGroupName      = aws_cloudwatch_log_group.postpilot_application.name
      logStreamPrefix   = "postpilot-"
      autoCreateGroup   = false
      autoRetryRequests = true
    }
    # The chart renders cloudWatchLogs.extraOutputs inside its primary output
    # stanza. A second output must instead use its top-level extension point.
    additionalOutputs = <<-EOT
      [OUTPUT]
          Name                cloudwatch_logs
          Match               kubernetes-events.*
          region              ${var.aws_region}
          log_group_name      ${aws_cloudwatch_log_group.postpilot_kubernetes_events.name}
          log_stream_prefix   kubernetes-events-
          auto_create_group   false
          auto_retry_requests true
    EOT
    resources = {
      requests = {
        cpu    = "25m"
        memory = "32Mi"
      }
      limits = {
        cpu    = "100m"
        memory = "96Mi"
      }
    }
  })]

  depends_on = [
    aws_eks_node_group.spot,
    aws_eks_pod_identity_association.postpilot_log_forwarder,
    aws_cloudwatch_log_group.postpilot_application,
    aws_cloudwatch_log_group.postpilot_kubernetes_events,
  ]
}

# Turn structured application errors into a low-noise CloudWatch metric. The
# filter matches our stable event name rather than user-supplied error text.
resource "aws_cloudwatch_log_metric_filter" "postpilot_server_errors" {
  name           = "${local.name}-server-errors"
  log_group_name = aws_cloudwatch_log_group.postpilot_application.name
  pattern        = "\"request_failed\""

  metric_transformation {
    name          = "ServerErrors"
    namespace     = "PostPilot/Application"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_sns_topic" "postpilot_observability" {
  name              = "${local.name}-observability-alerts"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "postpilot_observability_email" {
  count = var.observability_alarm_email == null ? 0 : 1

  topic_arn = aws_sns_topic.postpilot_observability.arn
  protocol  = "email"
  endpoint  = var.observability_alarm_email
}

resource "aws_cloudwatch_metric_alarm" "postpilot_server_errors" {
  alarm_name                = "${local.name}-server-errors"
  alarm_description         = "PostPilot recorded one or more unexpected server errors in five minutes."
  namespace                 = "PostPilot/Application"
  metric_name               = aws_cloudwatch_log_metric_filter.postpilot_server_errors.metric_transformation[0].name
  statistic                 = "Sum"
  period                    = 300
  evaluation_periods        = 1
  threshold                 = 1
  comparison_operator       = "GreaterThanOrEqualToThreshold"
  treat_missing_data        = "notBreaching"
  alarm_actions             = var.observability_alarm_email == null ? [] : [aws_sns_topic.postpilot_observability.arn]
  insufficient_data_actions = []
}

# The ALB is created by the Kubernetes controller rather than Terraform. Its
# ARN suffix is supplied after the first Ingress reconciliation so these alarms
# observe the real public edge without Terraform owning the ALB resource.
resource "aws_cloudwatch_metric_alarm" "postpilot_alb_target_5xx" {
  count = var.public_application_load_balancer_arn_suffix == null ? 0 : 1

  alarm_name                = "${local.name}-alb-target-5xx"
  alarm_description         = "The PostPilot Application Load Balancer received backend 5xx responses."
  namespace                 = "AWS/ApplicationELB"
  metric_name               = "HTTPCode_Target_5XX_Count"
  statistic                 = "Sum"
  period                    = 300
  evaluation_periods        = 1
  threshold                 = 1
  comparison_operator       = "GreaterThanOrEqualToThreshold"
  treat_missing_data        = "notBreaching"
  alarm_actions             = var.observability_alarm_email == null ? [] : [aws_sns_topic.postpilot_observability.arn]
  insufficient_data_actions = []

  dimensions = {
    LoadBalancer = var.public_application_load_balancer_arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "postpilot_alb_5xx" {
  count = var.public_application_load_balancer_arn_suffix == null ? 0 : 1

  alarm_name                = "${local.name}-alb-5xx"
  alarm_description         = "The PostPilot Application Load Balancer itself returned 5xx responses."
  namespace                 = "AWS/ApplicationELB"
  metric_name               = "HTTPCode_ELB_5XX_Count"
  statistic                 = "Sum"
  period                    = 300
  evaluation_periods        = 1
  threshold                 = 1
  comparison_operator       = "GreaterThanOrEqualToThreshold"
  treat_missing_data        = "notBreaching"
  alarm_actions             = var.observability_alarm_email == null ? [] : [aws_sns_topic.postpilot_observability.arn]
  insufficient_data_actions = []

  dimensions = {
    LoadBalancer = var.public_application_load_balancer_arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "postpilot_alb_no_healthy_targets" {
  count = var.public_application_load_balancer_arn_suffix == null ? 0 : 1

  alarm_name                = "${local.name}-alb-no-healthy-targets"
  alarm_description         = "The PostPilot Application Load Balancer has no healthy backend targets."
  namespace                 = "AWS/ApplicationELB"
  metric_name               = "HealthyHostCount"
  statistic                 = "Minimum"
  period                    = 60
  evaluation_periods        = 2
  threshold                 = 1
  comparison_operator       = "LessThanThreshold"
  treat_missing_data        = "breaching"
  alarm_actions             = var.observability_alarm_email == null ? [] : [aws_sns_topic.postpilot_observability.arn]
  insufficient_data_actions = []

  dimensions = {
    LoadBalancer = var.public_application_load_balancer_arn_suffix
  }
}
