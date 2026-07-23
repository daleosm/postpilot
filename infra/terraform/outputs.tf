output "cluster_name" {
  value       = aws_eks_cluster.this.name
  description = "EKS cluster name."
}

output "cluster_endpoint" {
  value       = aws_eks_cluster.this.endpoint
  description = "EKS Kubernetes API endpoint."
}

output "kubectl_configure_command" {
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${aws_eks_cluster.this.name}"
  description = "Command to configure kubectl for the cluster."
}

output "argocd_port_forward_command" {
  value       = "kubectl -n argocd port-forward svc/argocd-server 8080:80"
  description = "Cost-free local access path to the Argo CD UI; it intentionally avoids creating a public load balancer."
}

output "rds_endpoint" {
  value       = aws_db_instance.postgres.address
  description = "Private PostgreSQL hostname reachable from the EKS cluster."
}

output "rds_port" {
  value       = aws_db_instance.postgres.port
  description = "PostgreSQL port."
}

output "application_secrets_manager_name" {
  description = "AWS Secrets Manager secret that supplies PostPilot runtime configuration."
  value       = aws_secretsmanager_secret.postpilot_application.name
}

output "application_secrets_manager_arn" {
  description = "ARN of the PostPilot runtime configuration secret."
  value       = aws_secretsmanager_secret.postpilot_application.arn
}

output "rds_master_user_secret_arn" {
  value       = aws_db_instance.postgres.master_user_secret[0].secret_arn
  description = "RDS-managed Secrets Manager ARN containing the bootstrap PostgreSQL master credentials."
  sensitive   = true
}

output "ecr_repository_url" {
  value       = aws_ecr_repository.postpilot.repository_url
  description = "Private ECR repository used by GitHub Actions and EKS."
}

output "github_ecr_publish_role_arn" {
  value       = aws_iam_role.github_ecr_publish.arn
  description = "GitHub Actions OIDC role allowed to publish immutable PostPilot images to ECR."
}

output "application_log_group_name" {
  value       = aws_cloudwatch_log_group.postpilot_application.name
  description = "CloudWatch log group receiving PostPilot container stdout/stderr for the configured retention period."
}

output "observability_sns_topic_arn" {
  value       = aws_sns_topic.postpilot_observability.arn
  description = "SNS topic used by optional PostPilot observability alarm subscriptions."
}
