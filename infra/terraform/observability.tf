# The AWS-supported EKS add-on forwards container stdout/stderr to CloudWatch.
# PostPilot writes only unexpected errors to stderr; routine request access logs
# intentionally remain disabled to control noise and log-ingestion cost.
data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "cloudwatch_logs_kms" {
  statement {
    sid       = "AllowAccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  # CloudWatch Logs requires the regional service principal in the key policy.
  # The encryption-context condition restricts it to PostPilot's one log group.
  statement {
    sid = "AllowPostPilotCloudWatchLogs"
    actions = [
      "kms:Decrypt*",
      "kms:Describe*",
      "kms:Encrypt*",
      "kms:GenerateDataKey*",
      "kms:ReEncrypt*",
    ]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["logs.${var.aws_region}.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/containerinsights/${local.name}/application"]
    }
  }
}

resource "aws_kms_key" "cloudwatch_logs" {
  description             = "Encrypts PostPilot CloudWatch application logs."
  deletion_window_in_days = 7
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.cloudwatch_logs_kms.json
}

resource "aws_kms_alias" "cloudwatch_logs" {
  name          = "alias/${local.name}-cloudwatch-logs"
  target_key_id = aws_kms_key.cloudwatch_logs.key_id
}

#checkov:skip=CKV_AWS_338:Thirty-day retention is an intentional low-cost demo baseline; production operators can set application_log_retention_days to 365.
resource "aws_cloudwatch_log_group" "postpilot_application" {
  name              = "/aws/containerinsights/${local.name}/application"
  retention_in_days = var.application_log_retention_days
  kms_key_id        = aws_kms_key.cloudwatch_logs.arn
}

data "aws_iam_policy_document" "cloudwatch_observability_assume_role" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

# This role is usable only by the CloudWatch agent service account through EKS
# Pod Identity. Application pods and worker nodes do not receive these rights.
resource "aws_iam_role" "cloudwatch_observability" {
  name               = "${local.name}-cloudwatch-observability"
  assume_role_policy = data.aws_iam_policy_document.cloudwatch_observability_assume_role.json
}

resource "aws_iam_role_policy_attachment" "cloudwatch_observability_agent" {
  role       = aws_iam_role.cloudwatch_observability.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_role_policy_attachment" "cloudwatch_observability_xray" {
  role       = aws_iam_role.cloudwatch_observability.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXrayWriteOnlyAccess"
}

resource "aws_eks_addon" "pod_identity_agent" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "eks-pod-identity-agent"
  resolve_conflicts_on_create = "OVERWRITE"

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

  depends_on = [
    aws_eks_addon.pod_identity_agent,
    aws_eks_node_group.spot,
  ]
}

resource "aws_secretsmanager_secret" "postpilot_application" {
  name                    = "${var.project_name}/application"
  description             = "PostPilot runtime configuration for EKS workloads."
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.postpilot_application_secrets.arn
}

# A dedicated customer-managed key keeps the application secret separately
# encrypted while avoiding a broad KMS policy in the Terraform configuration.
resource "aws_kms_key" "postpilot_application_secrets" {
  description             = "Encrypts the PostPilot EKS application secret."
  deletion_window_in_days = 7
  enable_key_rotation     = true
}

resource "aws_kms_alias" "postpilot_application_secrets" {
  name          = "alias/${local.name}-application-secrets"
  target_key_id = aws_kms_key.postpilot_application_secrets.key_id
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

  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.postpilot_application_secrets.arn]
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

resource "aws_eks_addon" "cloudwatch_observability" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "amazon-cloudwatch-observability"
  resolve_conflicts_on_create = "OVERWRITE"

  pod_identity_association {
    role_arn        = aws_iam_role.cloudwatch_observability.arn
    service_account = "cloudwatch-agent"
  }

  # Do not automatically instrument every application. This baseline keeps
  # Container Insights and logs, without generating Application Signals data.
  configuration_values = jsonencode({
    manager = {
      applicationSignals = {
        autoMonitor = {
          monitorAllServices = false
        }
      }
    }
  })

  depends_on = [
    aws_eks_addon.pod_identity_agent,
    aws_iam_role_policy_attachment.cloudwatch_observability_agent,
    aws_iam_role_policy_attachment.cloudwatch_observability_xray,
    aws_cloudwatch_log_group.postpilot_application,
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
