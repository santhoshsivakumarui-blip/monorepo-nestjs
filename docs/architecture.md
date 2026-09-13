# Architecture and data boundaries

Each domain service owns its database: `users_db`, `orders_db`, and `notifications_db`. A service must not query another service's database. Its public HTTP API and versioned events are its contracts.

## Reliable event flow

1. Write the aggregate change and an `outbox_events` row in one database transaction.
2. The outbox relay publishes the event to Kafka (or RabbitMQ for notification delivery).
3. Mark the row published only after broker acknowledgement.
4. Consumers deduplicate by the event ID and send exhausted messages to a dead-letter topic.

This eliminates the dual-write failure where a database commit succeeds but event publication fails. Consumers must remain idempotent because at-least-once delivery is expected.

The `users` and `orders` HTTP create endpoints implement the transaction boundary locally. Run `npm run outbox:relay` with the owning service's `DATABASE_URL` to publish pending rows. In production run it as one managed worker per service, with a lease/lock and a dead-letter/replay policy.

Idempotency uses a per-service database key table and row-level locking, rather than a best-effort cache. A concurrent retry waits for the original transaction then receives its stored response. The idempotency key includes a request fingerprint, so key reuse for a different payload fails safely with `409`.

## Production observability

The gateway exposes Prometheus metrics. Collect JSON logs and OpenTelemetry traces with a deployment-level collector; attach `x-request-id`, service name, and event correlation ID to each record. Alert on gateway error rate, p95 latency, consumer lag, dead-letter growth, and database saturation.
