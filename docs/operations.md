# Operations runbook

## Deployment

1. Run `npm ci && npm run build && npm test -- --runInBand`.
2. Publish immutable service images and update image tags in the deployment values.
3. Run database migrations as a single pre-deployment job; never run destructive migrations automatically.
4. Deploy with `helm upgrade --install platform helm/platform --set image.tag=<immutable-tag>`.
5. Verify `/api/health/ready`, `/api/metrics`, error rate, latency, and Kafka consumer lag before rollout completion.

## Backup and recovery

Back up each service database daily and retain point-in-time recovery logs. Test restore quarterly into an isolated cluster. Recover by stopping writers, restoring the owning service database, replaying idempotent outbox events, and validating consumer offsets before reopening traffic.

## Incident response

For elevated failures, correlate `x-request-id` in structured logs and traces. For Kafka lag, scale consumers only after checking downstream database saturation. Dead-letter events must be inspected, corrected, and replayed with their original idempotency key.

## Required production integrations

Use a managed secret store (External Secrets/Vault), managed database backups, a TLS ingress, image scanning/signing, alert routing, and an identity provider. Do not deploy the development credential values included in this repository.
