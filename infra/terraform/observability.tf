# The AWS-supported EKS add-on forwards container stdout/stderr to CloudWatch.
# PostPilot writes only unexpected errors to stderr; routine request access logs
# intentionally remain disabled to control noise and log-ingestion cost.
#checkov:skip=CKV_AWS_338:Thirty-day retention is an intentional low-cost demo baseline; production operators can set application_log_retention_days to 365.
resource "aws_cloudwatch_log_group" "postpilot_application" {
  name              = "/aws/containerinsights/${local.name}/application"
  retention_in_days = var.application_log_retention_days
  # AWS-managed encryption avoids an unnecessary customer-managed KMS key
  # while keeping container logs encrypted at rest.
  kms_key_id = "alias/aws/logs"
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

# Kubernetes creates this Classic Load Balancer, so its stable AWS name is a
# supplied value rather than an application secret. Setting it enables direct
# edge and backend availability alarms in addition to application-error logs.
resource "aws_cloudwatch_metric_alarm" "postpilot_elb_backend_5xx" {
  count = var.public_load_balancer_name == null ? 0 : 1

  alarm_name                = "${local.name}-elb-backend-5xx"
  alarm_description         = "The PostPilot Classic Load Balancer received backend 5xx responses."
  namespace                 = "AWS/ELB"
  metric_name               = "HTTPCode_Backend_5XX"
  statistic                 = "Sum"
  period                    = 300
  evaluation_periods        = 1
  threshold                 = 1
  comparison_operator       = "GreaterThanOrEqualToThreshold"
  treat_missing_data        = "notBreaching"
  alarm_actions             = var.observability_alarm_email == null ? [] : [aws_sns_topic.postpilot_observability.arn]
  insufficient_data_actions = []

  dimensions = {
    LoadBalancerName = var.public_load_balancer_name
  }
}

resource "aws_cloudwatch_metric_alarm" "postpilot_elb_5xx" {
  count = var.public_load_balancer_name == null ? 0 : 1

  alarm_name                = "${local.name}-elb-5xx"
  alarm_description         = "The PostPilot Classic Load Balancer itself returned 5xx responses."
  namespace                 = "AWS/ELB"
  metric_name               = "HTTPCode_ELB_5XX"
  statistic                 = "Sum"
  period                    = 300
  evaluation_periods        = 1
  threshold                 = 1
  comparison_operator       = "GreaterThanOrEqualToThreshold"
  treat_missing_data        = "notBreaching"
  alarm_actions             = var.observability_alarm_email == null ? [] : [aws_sns_topic.postpilot_observability.arn]
  insufficient_data_actions = []

  dimensions = {
    LoadBalancerName = var.public_load_balancer_name
  }
}

resource "aws_cloudwatch_metric_alarm" "postpilot_elb_no_healthy_targets" {
  count = var.public_load_balancer_name == null ? 0 : 1

  alarm_name                = "${local.name}-elb-no-healthy-targets"
  alarm_description         = "The PostPilot Classic Load Balancer has no healthy backend targets."
  namespace                 = "AWS/ELB"
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
    LoadBalancerName = var.public_load_balancer_name
  }
}
