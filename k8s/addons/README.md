# Cluster add-ons

Install their operators/controllers first, then customize and apply these templates:

- Argo CD for GitOps reconciliation.
- External Secrets Operator backed by Vault or your cloud secret manager.
- cert-manager for the ingress certificate.
- Kyverno for admission policy.

The resources are not part of the normal Kustomize deployment because their CRDs and environment-specific endpoints must exist first.
