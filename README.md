# Platform monorepo

NestJS services, backed locally by Docker Compose and deployable with Kubernetes manifests.

## Services

| App | Responsibility | Transport |
|---|---|---|
| `api-gateway` | Public REST entry point | HTTP :3000 |
| `users` | User-domain events | Kafka |
| `orders` | Order-domain events | Kafka |
| `notifications` | Asynchronous notifications | RabbitMQ |

`Postgres`, `Redis`, `Kafka`, `RabbitMQ`, and `Elasticsearch` are included as development infrastructure. Shared event contracts live in `libs/contracts`; common logging and request middleware live in `libs/common`.

## Platform capabilities

- REST gateway with Swagger at `/docs`, health at `/api/health`, and Prometheus metrics at `/api/metrics`.
- JWT foundation: `POST /api/auth/token` issues a short-lived development token. Replace that development issuer with users-service credential validation before production use.
- Global request IDs (`x-request-id`), structured JSON logs, and gateway throttling (100 requests/minute).
- Prisma schema and a baseline SQL migration. Run `npm run db:migrate` after configuring `DATABASE_URL`.
- Versioned Kafka event contracts and an initial dead-letter topic name in `libs/contracts`.
- Unit-test setup and GitHub Actions CI (build, test, Kubernetes rendering).
- HTTP routes are reachable through the gateway: `POST /api/users/users`, `POST /api/orders/orders`, and `POST /api/notifications/notifications`. Internal services remain Kafka/RabbitMQ consumers.
- Helm chart, k6 smoke load test, Testcontainers integration-test baseline, and incident/recovery runbook.

## Local startup

```sh
cp .env.example .env
docker compose up --build
```

On first use, Compose initializes separate `users_db`, `orders_db`, and `notifications_db` databases. If you previously started an older database volume and need this local schema, remove only the project volumes with `docker compose down -v`, then start again; this permanently removes local development data.

The gateway health endpoint is `http://localhost:3000/api/health`. RabbitMQ management is at `http://localhost:15672` (`platform` / `platform`).

Run the gateway load baseline with `k6 run load/k6-gateway.js` after the stack is healthy.

## Rate limits and idempotency

The gateway enforces shared Redis limits: authentication routes are limited to 5 requests/minute per API key, bearer token, or client IP; other public API routes are limited to 100/minute. Kong applies the matching Redis-backed edge limit when the optional platform profile is enabled. Run `k6 run load/k6-rate-limit.js` to exercise the authentication limit.

Every mutating domain endpoint requires an `Idempotency-Key` header of 16–255 characters. The same key and request body replay the original response; reusing a key with a different payload returns `409`. Keys are stored atomically with the domain write and outbox event. Run `npm run idempotency:cleanup` daily for each service database to retain completed keys for 24 hours.

## Developer workflow

```sh
make bootstrap       # installs dependencies and enables repository hooks
make verify          # architecture rules, build, tests, and manifest rendering
npm run generate:service -- billing
```

The generator creates a service skeleton; register it in `nest-cli.json`, Compose, Kubernetes, and Helm after defining its domain contract. Architecture rules prevent applications from importing another application's implementation.

## Kubernetes

Build and publish one image per app, using `--build-arg APP=<app>` and replace the `platform/*:latest` image references in `k8s/services.yaml`. Then apply:

```sh
kubectl apply -k k8s
```

The bundled dependency manifests are for development clusters only; production should use managed PostgreSQL/Redis/Kafka/RabbitMQ/Elasticsearch, external secrets, durable storage, resource limits, network policies, and an ingress controller.

For workload-only production deployment, configure managed dependency endpoints and apply `k8s/production`. It adds gateway autoscaling, resource limits, hardened container settings, and ingress network policies:

```sh
kubectl apply -k k8s/production
```

Before production, replace `change-me` and the development JWT secret through your secrets manager, publish immutable image tags, configure an ingress/TLS certificate, and add database backup/restore automation.
