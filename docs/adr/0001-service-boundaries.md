# ADR 0001: Domain-owned services and data

## Status

Accepted.

## Decision

Each service owns its data store and publishes versioned domain events through the transactional outbox. Other services communicate only through documented HTTP APIs or event contracts.

## Consequences

Cross-domain reporting uses read models or search projections. Consumers must be idempotent. Direct database joins across services are prohibited.
