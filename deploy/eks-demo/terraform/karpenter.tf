# Karpenter complements the fixed two-node managed group. It is intentionally
# a scale-out-only pool for this low-cost pilot: the managed group remains the
# predictable baseline while Karpenter creates small Spot capacity only for
# Pods that the scheduler cannot place.

resource "aws_sqs_queue" "karpenter_interruption" {
  name                      = "${local.name}-karpenter-interruptions"
  message_retention_seconds = 300
  sqs_managed_sse_enabled   = true
}

locals {
  karpenter_interruption_events = {
    health = {
      source      = ["aws.health"]
      detail_type = ["AWS Health Event"]
    }
    spot_interruption = {
      source      = ["aws.ec2"]
      detail_type = ["EC2 Spot Instance Interruption Warning"]
    }
    rebalance = {
      source      = ["aws.ec2"]
      detail_type = ["EC2 Instance Rebalance Recommendation"]
    }
    instance_state_change = {
      source      = ["aws.ec2"]
      detail_type = ["EC2 Instance State-change Notification"]
    }
    capacity_reservation_interruption = {
      source      = ["aws.ec2"]
      detail_type = ["EC2 Capacity Reservation Instance Interruption Warning"]
    }
  }
}

resource "aws_cloudwatch_event_rule" "karpenter_interruption" {
  for_each = local.karpenter_interruption_events

  # EventBridge rule names are capped at 64 characters. Keep this safe even
  # when a caller provides the longest valid project_name/cluster_name.
  name = "${local.name}-k-${substr(replace(each.key, "_", "-"), 0, 30)}"
  event_pattern = jsonencode({
    source        = each.value.source
    "detail-type" = each.value.detail_type
  })
}

resource "aws_cloudwatch_event_target" "karpenter_interruption" {
  for_each = aws_cloudwatch_event_rule.karpenter_interruption

  rule = each.value.name
  arn  = aws_sqs_queue.karpenter_interruption.arn
}

data "aws_iam_policy_document" "karpenter_interruption_queue" {
  statement {
    sid       = "AllowEventBridge"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.karpenter_interruption.arn]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [for rule in aws_cloudwatch_event_rule.karpenter_interruption : rule.arn]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["sqs:*"]
    resources = [aws_sqs_queue.karpenter_interruption.arn]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_sqs_queue_policy" "karpenter_interruption" {
  queue_url = aws_sqs_queue.karpenter_interruption.id
  policy    = data.aws_iam_policy_document.karpenter_interruption_queue.json
}

# The controller uses EKS Pod Identity, matching the rest of this cluster.
# Karpenter supports Pod Identity on supported EKS versions, so no separate
# OIDC provider is needed solely for this controller.
data "aws_iam_policy_document" "karpenter_controller_assume_role" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "karpenter_controller" {
  name               = "${local.name}-karpenter-controller"
  assume_role_policy = data.aws_iam_policy_document.karpenter_controller_assume_role.json
}

# This is the current Karpenter AWS controller policy, rendered with this
# account, region, node role, and cluster name. Its write permissions are
# constrained to resources tagged for this cluster and a Karpenter NodePool.
resource "aws_iam_policy" "karpenter_controller" {
  name        = "${local.name}-karpenter-controller"
  description = "Scoped Karpenter controller permissions for ${local.name}."
  policy = templatefile("${path.module}/policies/karpenter-controller.json.tftpl", {
    account_id    = data.aws_caller_identity.current.account_id
    cluster_arn   = aws_eks_cluster.this.arn
    cluster_name  = aws_eks_cluster.this.name
    node_role_arn = aws_iam_role.node.arn
    region        = var.aws_region
  })
}

resource "aws_iam_role_policy_attachment" "karpenter_controller" {
  role       = aws_iam_role.karpenter_controller.name
  policy_arn = aws_iam_policy.karpenter_controller.arn
}

resource "aws_eks_pod_identity_association" "karpenter_controller" {
  cluster_name    = aws_eks_cluster.this.name
  namespace       = "kube-system"
  service_account = "karpenter"
  role_arn        = aws_iam_role.karpenter_controller.arn

  depends_on = [
    aws_eks_addon.pod_identity_agent,
    aws_iam_role_policy_attachment.karpenter_controller,
  ]
}

resource "helm_release" "karpenter" {
  name             = "karpenter"
  namespace        = "kube-system"
  repository       = "oci://public.ecr.aws/karpenter"
  chart            = "karpenter"
  version          = var.karpenter_chart_version
  create_namespace = false
  wait             = true
  timeout          = 900
  atomic           = true
  cleanup_on_fail  = true

  values = [yamlencode({
    replicas = 1
    settings = {
      clusterName       = aws_eks_cluster.this.name
      clusterEndpoint   = aws_eks_cluster.this.endpoint
      interruptionQueue = aws_sqs_queue.karpenter_interruption.name
    }
    serviceAccount = {
      create = true
      name   = "karpenter"
    }
    resources = {
      requests = {
        cpu    = "100m"
        memory = "256Mi"
      }
      limits = {
        cpu    = "500m"
        memory = "512Mi"
      }
    }
  })]

  depends_on = [
    aws_eks_pod_identity_association.karpenter_controller,
    aws_sqs_queue_policy.karpenter_interruption,
  ]
}

locals {
  karpenter_nodepool_manifest = templatefile("${path.module}/templates/karpenter-nodepool.yaml.tftpl", {
    cluster_name   = aws_eks_cluster.this.name
    node_role_name = aws_iam_role.node.name
    instance_types = var.karpenter_instance_types
    max_cpu        = var.karpenter_max_cpu
    max_memory     = var.karpenter_max_memory
  })
}

# Karpenter's CRDs are created by the chart, so apply its NodePool only after
# Helm has established them. This follows the existing Argo CD bootstrap
# pattern and leaves the application's GitOps manifests independent of cluster
# provisioning internals.
resource "terraform_data" "karpenter_nodepool" {
  input = local.karpenter_nodepool_manifest

  triggers_replace = [
    helm_release.karpenter.id,
    sha256(local.karpenter_nodepool_manifest),
    aws_ec2_tag.karpenter_cluster_security_group.id,
  ]

  provisioner "local-exec" {
    command = <<-EOT
      aws eks update-kubeconfig --region ${var.aws_region} --name ${aws_eks_cluster.this.name}
      kubectl wait --for=condition=established --timeout=180s crd/nodepools.karpenter.sh
      kubectl wait --for=condition=established --timeout=180s crd/ec2nodeclasses.karpenter.k8s.aws
      printf '%s' "$KARPENTER_NODEPOOL_MANIFEST" | kubectl apply --server-side -f -
    EOT

    environment = {
      KARPENTER_NODEPOOL_MANIFEST = local.karpenter_nodepool_manifest
    }
  }

  provisioner "local-exec" {
    when    = destroy
    command = "printf '%s' \"$KARPENTER_NODEPOOL_MANIFEST\" | kubectl delete --ignore-not-found -f -"

    environment = {
      KARPENTER_NODEPOOL_MANIFEST = self.input
    }
  }

  depends_on = [
    helm_release.karpenter,
    aws_ec2_tag.karpenter_cluster_security_group,
  ]
}
