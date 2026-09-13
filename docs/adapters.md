# External adapter contracts

Implement provider credentials only through environment variables or a secret manager.

- `OAUTH_ISSUER`, `OAUTH_AUDIENCE`, `OAUTH_CLIENT_ID`: OIDC validation.
- `PAYMENTS_PROVIDER`, `PAYMENTS_API_KEY`, `PAYMENTS_WEBHOOK_SECRET`: payments adapter and verified webhook ingress.
- `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `SMS_PROVIDER`, `SMS_API_KEY`: notification delivery adapters.
- `ELASTICSEARCH_NODE`: search index worker and query service.

Adapters should expose domain interfaces, implement retry/backoff, and write failures to the outbox/dead-letter workflow rather than leaking provider SDKs into controllers.
