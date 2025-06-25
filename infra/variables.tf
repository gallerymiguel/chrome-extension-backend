variable "bucket_name" {
  description = "The name of the S3 bucket"
  type        = string
}

resource "aws_s3_bucket" "etl_reports" {
  bucket = var.bucket_name
  acl    = "private"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}
