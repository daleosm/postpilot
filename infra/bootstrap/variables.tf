variable "aws_region" {
  description = "Region for the Terraform state bucket and lock table."
  type        = string
  default     = "us-east-1"
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name for encrypted, versioned Terraform state."
  type        = string
}

variable "lock_table_name" {
  description = "DynamoDB table name used for Terraform state locking."
  type        = string
  default     = "postpilot-terraform-lock"
}
