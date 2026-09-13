# Platform Architecture Overview

## 1. Purpose

This document describes the architecture of the platform monorepo, its service boundaries, interaction patterns, runtime dependencies, operational controls, and production-readiness requirements. It is intended to support technical review, client communication, and pull-request-level handoff.

## 2. Executive Summary

The platform is implemented as a NestJS monorepo with a public API gateway and domain-specific service apps. The system is designed around clear service ownership, transaction-safe writes, retryable asynchronous communication, and explicit operational gates before production rollout.

The core pattern is:

- the gateway exposes the external HTTP surface
- domain services own business state and transactional write logic
- each business change is written with a corresponding outbox record in the same transaction
- a relay worker publishes the outbox message asynchronously to Kafka or RabbitMQ
- consumers process events with idempotent semantics and dead-letter handling
- gateway and service boundaries are protected by retries, request correlation, rate limiting, and startup validation

This creates a system that is resilient to transient failure, supports replay and recovery, and is easier to reason about under operational incidents.

## 3. Architecture Overview

### 3.1 Runtime Components

- API gateway
  - public REST entry point
  - handles authentication, validation, request IDs, rate limiting, security headers, and routing
  - exposes health and metrics endpoints

- Users service
  - owns user-domain operations and state
  - emits domain events to Kafka

- Orders service
  - owns order-domain operations and state
  - emits domain events to Kafka

- Notifications service
  - consumes domain events and dispatches notifications via RabbitMQ

- Shared libraries
  - request ID middleware
  - structured JSON logger
  - idempotency helper
  - outbox helper
  - common resilience utilities
  - shared contract definitions

- Data stores
  - PostgreSQL for service state and transactional writes
  - Redis for rate limiting and transient shared-state usage
  - Kafka for domain event distribution
  - RabbitMQ for notification work and other async tasks
  - Elasticsearch for search/read-oriented workloads

## 4. Service Boundaries and Responsibilities

### 4.1 API Gateway

The API gateway is the only externally exposed application layer. It is responsible for:

- incoming HTTP routing
- request validation
- authorization checks
- rate limiting
- request correlation via `x-request-id`
- structured JSON logging
- response security headers and CORS policy
- forwarding traffic to internal services through a controlled reverse-proxy layer

The gateway is intentionally thin. It does not own business logic beyond authentication, routing, and policy enforcement.

### 4.2 Domain Services

Each domain service owns its own business state and database. The domain services are responsible for:

- validating domain commands
- writing transactional state
- persisting outbox records in the same transaction
- publishing domain change events through the outbox relay
- handling consumer-driven follow-up actions

This enforces a clean domain ownership model and avoids cross-service write coupling.

### 4.3 Notifications and Event Consumers

Notification handling is separated from the business services so that downstream delivery failure does not stall the primary domain transaction. Kafka and RabbitMQ are used as asynchronous integration channels, and the message flow is built around the same contract and idempotency assumptions.

## 5. Reliability Pattern: Transactional Outbox

The transactional outbox pattern is a core architectural decision.

For each successful business write, the service performs two writes in the same database transaction:

1. the business row update or insert
2. the corresponding outbox event row

The relay worker then processes pending outbox rows and publishes them to the configured broker. The system records:

- pending
- failed
- dead-letter
- published

This avoids the risk of losing an event when the domain write succeeds but the message publish fails.

### Event reliability guarantees

- domain changes are durable before they are published
- replay is possible because failed or pending events remain available
- recovery can be controlled with explicit replay rules
- dead-letter rows are retained for investigation and manual recovery

## 6. Idempotency Model

All mutating operations require an idempotency key. The same key and payload combination returns the original response. The same key with a different payload is rejected to prevent duplicate but non-identical requests from being accidentally accepted.

This matters for:

- retries from clients
- network retries
- replay after infrastructure recovery
- duplicate event-driven processing

The pattern is backed by a database row keyed by the idempotency key and by a stable request fingerprint.

## 7. Security Model

### 7.1 Authentication and Authorization

The gateway supports token-based access for local development and can be configured to work with external OIDC providers such as Keycloak. Production configuration enforces explicit identity settings and rejects placeholder secrets.

Key controls include:

- JWT secret validation
- production-only issuer/audience enforcement when not using OIDC
- OIDC configuration completeness checks
- denial of local token minting when external OIDC is enabled

### 7.2 Gateway Security Controls

The gateway applies default browser hardening including:

- `x-content-type-options: nosniff`
- `x-frame-options: DENY`
- `referrer-policy: no-referrer`
- `content-security-policy`
- CORS configuration via environment-driven allowlist

## 8. Operational Controls

### 8.1 Health and Readiness

The API gateway exposes readiness and health endpoints used by orchestration and deployment checks. This supports safe rollout and safe termination behavior.

### 8.2 Graceful Shutdown

The gateway attaches signal handlers for `SIGTERM` and `SIGINT` and closes the Nest app gracefully before exit. This supports container orchestration and clean restarts under rolling deployments.

### 8.3 Rate Limiting and Timeouts

The gateway uses Redis-backed rate limiting and upstream reverse-proxy timeouts. This prevents slow dependencies from stalling traffic indefinitely and gives the system bounded failure behavior under degraded conditions.

### 8.4 Release Gates

Production deployment is gated by script-level commands that validate:

- environment completeness
- production configuration correctness
- disaster recovery readiness
- platform operations readiness

These checks are enforced through package scripts and are designed to stop unsafe deploys before they reach production.

## 9. Data and Recovery Strategy

The project includes operational guidance for:

- retention strategy
- backup and restore policy
- point-in-time recovery expectations
- replay and dead-letter recovery
- RTO/RPO review
- incident documentation and approval workflow

This is necessary because event-driven systems are operationally more complex than simple CRUD systems. Recovery is not just “restart the app”; it requires restoring correctness, replaying state safely, and validating downstream side effects.

## 10. Deployment Model

The repository includes:

- Docker Compose for local development
- Kubernetes manifests for base and production overlays
- Helm chart scaffolding
- network policy templates
- external-secret patterns
- operational CronJobs for relay and cleanup tasks

Production deployment should use:

- managed PostgreSQL, Redis, Kafka, RabbitMQ, and Elasticsearch
- external secret management
- ingress with TLS
- immutable image tags
- standard alert routing and ownership
- centrally managed GitOps or deployment automation

## 11. Current Status and Remaining Work

The architecture is now materially hardened and includes strong code-level and deployment-level checks. The codebase demonstrates a credible production-alignment model across:

- identity safety
- environment validation
- resilience patterns
- graceful shutdown
- gateway security
- outbox and replay semantics
- disaster recovery readiness policy
- platform operations readiness policy

The remaining work is primarily operational proof rather than core architecture redesign. The remaining high-value items are:

- live OIDC integration validation with an external IdP
- real broker and database failure/recovery validation in a managed environment
- restore drill and backup validation
- SLO and alert tuning based on actual operational data

## 12. Conclusion

This platform is structured to support an event-driven, service-owned, production-oriented deployment model. It has strong defaults for reliability, resilience, and operational discipline, and it now includes concrete deployment gates intended to prevent unsafe production rollout.

The design is appropriate for a modern distributed business platform with a public API, asynchronous event processing, strict data integrity requirements, and a need for recovery and replay control.
