# Prometheus and Grafana are deliberately available in the demo too. They are
# constrained to short retention and a small persistent footprint, but may
# cause Karpenter to add Spot capacity while the monitoring stack is enabled.

data "aws_iam_policy_document" "ebs_csi_assume_role" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ebs_csi" {
  name               = "${local.name}-ebs-csi"
  assume_role_policy = data.aws_iam_policy_document.ebs_csi_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  role       = aws_iam_role.ebs_csi.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

resource "aws_eks_addon" "ebs_csi" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "aws-ebs-csi-driver"
  resolve_conflicts_on_create = "OVERWRITE"

  pod_identity_association {
    role_arn        = aws_iam_role.ebs_csi.arn
    service_account = "ebs-csi-controller-sa"
  }

  depends_on = [
    aws_eks_addon.pod_identity_agent,
    aws_iam_role_policy_attachment.ebs_csi,
  ]
}

# This Terraform-owned StorageClass gives the Helm release a deterministic
# gp3 target before Argo CD reconciles the PostPilot ServiceMonitor.
resource "kubernetes_storage_class_v1" "postpilot_gp3" {
  metadata {
    name = "postpilot-gp3"
  }

  storage_provisioner    = "ebs.csi.aws.com"
  reclaim_policy         = "Delete"
  volume_binding_mode    = "WaitForFirstConsumer"
  allow_volume_expansion = true
  parameters = {
    type      = "gp3"
    encrypted = "true"
  }

  depends_on = [aws_eks_addon.ebs_csi]
}

resource "helm_release" "postpilot_observability" {
  name             = "postpilot-observability"
  namespace        = "monitoring"
  create_namespace = true
  repository       = "https://prometheus-community.github.io/helm-charts"
  chart            = "kube-prometheus-stack"
  version          = var.kube_prometheus_stack_chart_version
  wait             = true
  timeout          = 900
  atomic           = true
  cleanup_on_fail  = true

  values = [yamlencode({
    # Managed EKS does not expose scheduler, controller-manager, or etcd
    # endpoints to this cluster. Disabling their monitors prevents false alerts.
    kubeEtcd              = { enabled = false }
    kubeControllerManager = { enabled = false }
    kubeScheduler         = { enabled = false }
    alertmanager          = { enabled = false }

    grafana = {
      service = { type = "ClusterIP" }
      ingress = { enabled = false }
      # Grafana uses a single ReadWriteOnce volume in the demo. Recreate
      # avoids a rolling update briefly trying to attach that volume to two
      # Pods, which can otherwise hold a Terraform Helm upgrade open.
      deploymentStrategy = { type = "Recreate" }
      persistence = {
        enabled          = true
        type             = "pvc"
        storageClassName = kubernetes_storage_class_v1.postpilot_gp3.metadata[0].name
        accessModes      = ["ReadWriteOnce"]
        size             = var.grafana_storage_size
      }
      sidecar = {
        dashboards = {
          enabled         = true
          label           = "grafana_dashboard"
          searchNamespace = "ALL"
        }
      }
      resources = {
        requests = { cpu = "50m", memory = "128Mi" }
        limits   = { cpu = "200m", memory = "256Mi" }
      }
    }

    prometheus = {
      service = { type = "ClusterIP" }
      prometheusSpec = {
        retention = var.prometheus_retention
        resources = {
          requests = { cpu = "250m", memory = "512Mi" }
          limits   = { cpu = "500m", memory = "1Gi" }
        }
        storageSpec = {
          volumeClaimTemplate = {
            spec = {
              storageClassName = kubernetes_storage_class_v1.postpilot_gp3.metadata[0].name
              accessModes      = ["ReadWriteOnce"]
              resources = {
                requests = { storage = var.prometheus_storage_size }
              }
            }
          }
        }
        serviceMonitorSelector = {
          matchLabels = { release = "postpilot-observability" }
        }
        serviceMonitorNamespaceSelector = {}
      }
    }

    prometheusOperator = {
      resources = {
        requests = { cpu = "100m", memory = "128Mi" }
        limits   = { cpu = "250m", memory = "256Mi" }
      }
    }
    kube-state-metrics = {
      resources = {
        requests = { cpu = "50m", memory = "128Mi" }
        limits   = { cpu = "150m", memory = "256Mi" }
      }
    }
    "prometheus-node-exporter" = {
      resources = {
        requests = { cpu = "30m", memory = "64Mi" }
        limits   = { cpu = "100m", memory = "128Mi" }
      }
    }
  })]

  # Install the dynamic node pool before the monitoring workload. Prometheus
  # can then request a small extra Spot node instead of leaving its PVC-backed
  # Pod Pending on the fixed demo baseline.
  depends_on = [
    kubernetes_storage_class_v1.postpilot_gp3,
    terraform_data.karpenter_nodepool,
  ]
}
