# Operations runbook

## Deployment

1. Run `npm ci && npm run build && npm test -- --runInBand`.
2. Publish immutable service images and update image tags in the deployment values.
3. Run database migrations as a single pre-deployment job; never run destructive migrations automatically.
4. Deploy with `helm upgrade --install platform helm/platform --set image.tag=<immutable-tag>`.
5. Verify `/api/health/ready`, `/api/metrics`, error rate, latency, and Kafka consumer lag before rollout completion.

## Outbox lifecycle and failure states

Each service writes its domain change and a corresponding `outbox_events` row in the same transaction. The relay worker reads pending rows and publishes them to the configured broker. The state model is:

- `pending`: inserted after a successful domain transaction and waiting for relay processing
- `failed`: relay attempt failed but the event is still eligible for retry
- `dead-letter`: retry count reached the configured threshold (`OUTBOX_MAX_ATTEMPTS`, default 5)
- `published`: broker acknowledged the message and the row is complete

The relay loop in [workers/outbox-relay.ts](workers/outbox-relay.ts) reads rows with `FOR UPDATE SKIP LOCKED` to avoid duplicate processing across workers. Only one relay worker per service should operate against a single database. The row is marked `published` only after broker acknowledgement is confirmed.

## Monitoring and alerts

Check the outbox queue at least every 5 minutes in production and alert on the following thresholds:

- pending rows growing above normal baseline
- failed rows increasing continuously for more than 10 minutes
- dead-letter rows above zero for a sustained window
- service-level consumer lag or downstream broker saturation
- repeated `last_error` patterns from the same topic or payload family

Useful queries:

```sql
SELECT status, COUNT(*)
FROM outbox_events
GROUP BY status;

SELECT id, topic, attempts, status, last_error, created_at, dead_lettered_at
FROM outbox_events
WHERE status IN ('pending', 'failed', 'dead-letter')
ORDER BY created_at ASC
LIMIT 50;

SELECT id, topic, payload, attempts, status, last_error
FROM outbox_events
WHERE status = 'dead-letter'
ORDER BY dead_lettered_at DESC;
```

When a row is `dead-letter`, do not silently delete it. Keep it for audit, diagnosis, and replay after the upstream issue is fixed.

## Replay procedure

A replay is a controlled recovery action for a message that was not delivered or was classified as failed before the dead-letter threshold. Replays must be deliberate and traceable.

1. Confirm the root cause and the affected topic.
2. Inspect the event payload and error trace:

```sql
SELECT id, topic, payload, attempts, status, last_error, created_at, dead_lettered_at
FROM outbox_events
WHERE id = $1;
```

3. If the issue is transient and the payload is valid, reset the event for replay:

```sql
UPDATE outbox_events
SET attempts = 0,
    status = 'pending',
    published_at = NULL,
    last_error = NULL,
    dead_lettered_at = NULL
WHERE id = $1;
```

4. Resume the relay worker and monitor the row until it becomes `published`.
5. Validate downstream effects by checking the target topic, consumer lag, and the corresponding domain state.
6. Record the replay in the incident log with the event ID, root cause, and verification result.

Do not replay a row without verifying that the downstream issue is resolved. A replay during an active outage can create duplicate consumer work or make the incident harder to reason about.

## Dead-letter handling

A `dead-letter` row means the event exceeded the configured retry budget and is no longer eligible for automatic re-delivery. Treat it as a manual recovery action.

Operational steps:

1. Open a support or incident ticket for the event ID.
2. Determine whether the payload is still valid or if the event represents a stale or unsafe state.
3. If the message is recoverable, fix the root cause and requeue it through the same controlled replay flow.
4. If the payload is invalid, preserve it for audit and document why it was rejected rather than discarded.
5. Only after manual approval should a dead-letter row be reset and replayed.

Example replay approval pattern:

```sql
UPDATE outbox_events
SET attempts = 0,
    status = 'pending',
    published_at = NULL,
    last_error = NULL,
    dead_lettered_at = NULL,
    last_error = 'manual replay approved after downstream fix'
WHERE id = $1;
```

For production, the preferred workflow is: inspect → repair root cause → manual approval → replay → verify publish → close incident.

## Recovery checklist

Before closing any delivery incident, confirm all of the following:

- root cause is identified and documented
- broker or consumer issue has been corrected
- event payload was reviewed and validated
- affected outbox rows were either replayed or intentionally quarantined
- consumer lag has returned to baseline
- no duplicate side effects were introduced
- the incident record includes the event IDs and replay verification result

## Data retention, backup, restore, and disaster-recovery validation

Each service database must have a clear retention policy because both business data and operational recovery data are stored there. At minimum:

- keep business records according to the product retention policy
- retain idempotency rows long enough to safely protect retries, but clean up expired entries using `npm run idempotency:cleanup`
- retain outbox and dead-letter rows for incident review and replay verification
- keep database backup artifacts and PITR logs for the service-level recovery window required by the business

Recommended baseline:

- daily encrypted backups for each service database
- point-in-time recovery enabled for Postgres if supported by the provider
- backup retention of at least 30 days, with a longer archive window for audit-focused records
- quarterly restore testing in an isolated environment
- pre-approved recovery runbooks for partial outage, full DB restore, broker outage, and consumer lag conditions

Restore workflow:

1. Stop writes to the affected application or isolate traffic at the gateway.
2. Identify the last known-good backup or PITR point.
3. Restore the owning service database into a non-production recovery environment.
4. Reconcile restored data with upstream system-of-record expectations.
5. Replay pending or failed outbox events only after confirming the system is healthy enough to process them safely.
6. Validate application state, consumer offsets, and event flow before redirecting traffic.

Disaster recovery validation checklist:

- verify backup encryption and access permissions
- test restore from backup to a fresh environment
- verify Prisma schema compatibility after restore
- confirm `outbox_events` and `idempotency` tables are reconciled correctly
- validate the relay worker resumes without duplicating already-published records
- confirm broker lag is back to normal before announcing recovery
- document the actual restore time and whether it meets the agreed RTO/RPO

If a restore requires replay, the process must respect the idempotency contract: same key + same payload returns the original result; same key + different payload fails. This protects the system during repeated attempts and keeps recovery deterministic.

## Incident response

For elevated failures, correlate `x-request-id` in structured logs and traces. For Kafka lag, scale consumers only after checking downstream database saturation. Dead-letter events must be inspected, corrected, and replayed with their original idempotency key.

## Identity and secret management

Production identity must be externalized from the application itself. The current JWT-based local flow is acceptable for local development and basic validation, but production should use an OIDC provider such as Keycloak, Entra ID, or another approved identity service.

Required production flow:

1. Register the gateway as a confidential client or resource server in the identity provider.
2. Configure issuer discovery and audience validation against the approved OIDC metadata URL.
3. Map external groups or roles to application roles before allowing route access.
4. Require short-lived access tokens and rotate signing keys through the provider's standard lifecycle.
5. Keep user identity claims separate from application authorization decisions; authorization should still use a policy system such as OpenFGA when fine-grained access is needed.

Secret operations:

- Store all production secrets in a managed secret manager (Vault, AWS Secrets Manager, Azure Key Vault, or GCP Secret Manager).
- Inject them through Kubernetes Secrets or workload identity rather than embedding them in Helm values.
- Rotate database, Redis, Kafka, RabbitMQ, and JWT-related secrets on a controlled schedule.
- Reject development placeholders in CI and startup checks before deployment proceeds.
- Keep secret rotation, emergency revocation, and ownership explicit in the incident runbook.

Operational verification:

- confirm the identity provider is reachable and healthy before gateway rollout
- test token expiry and invalid audience rejection
- verify that the gateway rejects tokens signed by the wrong issuer
- confirm secret updates do not require a full application redeploy when mounted dynamically

## SLOs, alerting, and operational readiness

The repository already exposes metrics and request IDs, but production requires explicit service-level objectives and alert thresholds to make those signals actionable. Define and review these targets for every environment before broad rollout:

- API availability: 99.9% for the public gateway
- p95 request latency: under 500 ms for normal authenticated API traffic
- error rate: alert if 5xx rate exceeds 1% for 10 minutes
- broker lag: alert if Kafka consumer lag or RabbitMQ backlog exceeds baseline by more than 2x for 15 minutes
- outbox failure rate: alert if pending or failed outbox rows keep rising across two consecutive checks
- dead-letter queue growth: page the owning team if dead-letter rows remain above zero for a sustained interval

Recommended signal sources:

- gateway health and metrics endpoints
- structured JSON logs with `x-request-id` and service name
- broker lag and throughput metrics
- database connection saturation and query latency
- outbox `status` counts and `last_error` values

Alert routing:

- route 5xx, latency, and DLQ alerts to the service owners
- publish incident-level alerts for broker outage or database saturation
- attach event ID, request ID, and impacted topic to every alert payload

Error budget policy:

- if the gateway error budget is exhausted, freeze non-critical releases
- prioritize root cause isolation before scaling consumers or bypassing the outbox
- escalate to the incident commander if the issue threatens data durability or end-user trust

## Required production integrations

Use a managed secret store (External Secrets/Vault), managed database backups, a TLS ingress, image scanning/signing, alert routing, and an identity provider. Do not deploy the development credential values included in this repository.
