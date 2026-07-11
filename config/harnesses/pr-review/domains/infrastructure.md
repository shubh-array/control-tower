# Infrastructure Domain Guidance

When reviewing infrastructure changes, pay special attention to:
- IAM policy and role changes (principle of least privilege)
- Network configuration (security groups, VPC peering, DNS)
- Secret and certificate management
- Cost-impacting resource changes (instance types, scaling policies)
- Deployment pipeline changes and rollback safety
- Environment parity between staging and production
