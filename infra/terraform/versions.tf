terraform {
  required_version = ">= 1.7.0"

  # Values are supplied at init time, never committed. See infra/README.md.
  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
  }
}
