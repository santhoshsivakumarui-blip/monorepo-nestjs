# Ready-made platform integration choices

| Need | Local/bootstrap choice | Production rule |
|---|---|---|
| Identity | Keycloak | Use OIDC issuer discovery and rotate client secrets. |
| Fine-grained authorization | OpenFGA | Model relationships in version-controlled `.fga` files. |
| API edge | Kong | Manage declarative config and rate limits as code. |
| Durable workflows | Temporal | Use managed service or official Helm/persistence setup. |
| Feature flags | Unleash | Environment-scoped tokens; audit every flag change. |
| Email and cloud emulation | Mailpit and LocalStack | Replace with approved managed providers. |
| GitOps, secrets, TLS, policies | Argo CD, External Secrets, cert-manager, Kyverno | Install and operate their controllers centrally. |
