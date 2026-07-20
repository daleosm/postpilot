resource "helm_release" "argocd" {
  name             = "argocd"
  namespace        = "argocd"
  create_namespace = true
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = var.argocd_chart_version
  wait             = true
  timeout          = 900

  values = [yamlencode({
    global = {
      domain = ""
    }
    server = {
      service = {
        type = "ClusterIP"
      }
      resources = {
        requests = {
          cpu    = "50m"
          memory = "64Mi"
        }
      }
    }
    controller = {
      resources = {
        requests = {
          cpu    = "100m"
          memory = "128Mi"
        }
      }
    }
    repoServer = {
      resources = {
        requests = {
          cpu    = "50m"
          memory = "64Mi"
        }
      }
    }
    redis = {
      resources = {
        requests = {
          cpu    = "25m"
          memory = "64Mi"
        }
      }
    }
    dex = {
      enabled = false
    }
    notifications = {
      enabled = false
    }
    applicationSet = {
      enabled = false
    }
    extraObjects = [
      {
        apiVersion = "v1"
        kind       = "Namespace"
        metadata = {
          name = "postpilot"
        }
      },
      yamldecode(templatefile("${path.module}/templates/postpilot-application.yaml.tftpl", {
        repo_url        = var.gitops_repo_url
        target_revision = var.gitops_target_revision
        manifest_path   = var.gitops_manifest_path
      })),
    ]
  })]

  depends_on = [aws_eks_node_group.on_demand]
}
