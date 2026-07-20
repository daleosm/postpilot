locals {
  postpilot_argocd_application = templatefile("${path.module}/templates/postpilot-application.yaml.tftpl", {
    repo_url        = var.gitops_repo_url
    target_revision = var.gitops_target_revision
    manifest_path   = var.gitops_manifest_path
  })
}

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
      # This cluster bootstraps a single Application directly; it does not use
      # ApplicationSet generators, so do not spend a pod on its controller.
      replicas = 0
    }
  })]

  depends_on = [aws_eks_node_group.spot]
}

# The Application CRD is installed by the Helm release above, so it cannot be
# included in that same release's manifest. Apply it only after the CRD is
# established. kubectl uses the operator's existing AWS SSO credentials.
resource "terraform_data" "postpilot_argocd_application" {
  input = local.postpilot_argocd_application

  triggers_replace = [
    helm_release.argocd.id,
    sha256(local.postpilot_argocd_application),
  ]

  provisioner "local-exec" {
    command = <<-EOT
      aws eks update-kubeconfig --region ${var.aws_region} --name ${aws_eks_cluster.this.name}
      kubectl wait --for=condition=established --timeout=180s crd/applications.argoproj.io
      printf '%s' "$APPLICATION_MANIFEST" | kubectl apply --server-side -f -
    EOT

    environment = {
      APPLICATION_MANIFEST = local.postpilot_argocd_application
    }
  }

  provisioner "local-exec" {
    when    = destroy
    command = "printf '%s' \"$APPLICATION_MANIFEST\" | kubectl delete --ignore-not-found -f -"

    environment = {
      APPLICATION_MANIFEST = self.input
    }
  }

  depends_on = [helm_release.argocd]
}
