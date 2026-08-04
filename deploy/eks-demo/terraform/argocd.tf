locals {
  postpilot_argocd_application = templatefile("${path.module}/templates/postpilot-application.yaml.tftpl", {
    repo_url        = var.gitops_repo_url
    target_revision = var.gitops_target_revision
    manifest_path   = local.gitops_manifest_path
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
  # Store the values the destroy provisioner needs on this resource. Terraform
  # only permits `self` references in destroy-time provisioners.
  input = {
    application_manifest = local.postpilot_argocd_application
    aws_region           = var.aws_region
    cluster_name         = aws_eks_cluster.this.name
  }

  triggers_replace = [
    helm_release.argocd.id,
    sha256(local.postpilot_argocd_application),
  ]

  provisioner "local-exec" {
    command = <<-EOT
      aws eks update-kubeconfig --region ${self.input.aws_region} --name ${self.input.cluster_name}
      kubectl wait --for=condition=established --timeout=180s crd/applications.argoproj.io
      printf '%s' "$APPLICATION_MANIFEST" | kubectl apply --server-side -f -
    EOT

    environment = {
      APPLICATION_MANIFEST = local.postpilot_argocd_application
    }
  }

  provisioner "local-exec" {
    when        = destroy
    interpreter = ["/bin/bash", "-c"]
    command     = <<-EOT
      # Ask Argo CD to prune first, while the controllers that own the
      # Application resources (especially the ALB controller) are still up.
      # Poll rather than using `kubectl wait`: an interrupted Kubernetes watch
      # previously left Terraform waiting indefinitely during destroy.
      set -euo pipefail
      aws eks update-kubeconfig --region ${self.input.aws_region} --name ${self.input.cluster_name}
      printf '%s' "$APPLICATION_MANIFEST" | kubectl delete --ignore-not-found --wait=false -f -

      for attempt in $(seq 1 30); do
        if ! kubectl -n argocd get application postpilot >/dev/null 2>&1; then
          break
        fi
        sleep 10
      done

      if kubectl get namespace postpilot >/dev/null 2>&1; then
        # A remaining namespace means one of the application resources still
        # needs pruning. Delete only that namespace while Argo CD and the AWS
        # Load Balancer Controller are still available. Do not remove the
        # Application finalizer until the namespace is gone; that would risk
        # orphaning an ALB or another cloud resource.
        echo "Pruning the remaining postpilot namespace before removing the Argo CD Application."
        kubectl delete namespace postpilot --ignore-not-found --wait=false
        for attempt in $(seq 1 60); do
          if ! kubectl get namespace postpilot >/dev/null 2>&1; then
            break
          fi
          sleep 10
        done
      fi

      if kubectl get namespace postpilot >/dev/null 2>&1; then
        echo "PostPilot namespace did not finish pruning; refusing to remove the Argo CD finalizer." >&2
        exit 1
      fi

      if kubectl -n argocd get application postpilot >/dev/null 2>&1; then
        kubectl -n argocd patch application postpilot --type=merge -p '{"metadata":{"finalizers":[]}}'
      fi

      for attempt in $(seq 1 12); do
        if ! kubectl -n argocd get application postpilot >/dev/null 2>&1; then
          exit 0
        fi
        sleep 5
      done

      echo "Argo CD Application still exists after namespace pruning." >&2
      exit 1
    EOT

    environment = {
      APPLICATION_MANIFEST = self.input.application_manifest
    }
  }

  # Keep every controller required to create and delete the application's
  # resources alive until Argo has pruned them. In particular, the AWS Load
  # Balancer Controller must remove the Ingress finalizer and ALB before its
  # Helm release is destroyed. These creation dependencies reverse naturally
  # during `terraform destroy`.
  #
  # The application also mounts Secrets Manager values through the CSI driver,
  # so keep that driver and its Pod Identity association available while the
  # application Pods are terminating.
  depends_on = [
    helm_release.argocd,
    helm_release.postpilot_observability,
    helm_release.aws_load_balancer_controller,
    aws_eks_addon.secrets_store_csi,
    aws_eks_pod_identity_association.postpilot_secrets,
  ]
}
