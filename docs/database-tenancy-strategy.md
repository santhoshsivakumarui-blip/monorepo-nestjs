# Database Tenancy Strategy

## 1. Purpose

This document defines how Zentinel supports three commercial packages while keeping tenant data isolated:

- **Starter**: shared pooled database
- **Growth**: shared pooled database, with higher capacity and feature limits
- **Enterprise**: dedicated database for each customer

The design supports an initial shared pool and allows tenants to move to different pools or dedicated databases without changing their tenant ID.

## 2. Architectural decision

Use a hybrid tenancy model:

```text
                         +----------------+
                         |   platform_db  |
                         | tenants/plans  |
                         | memberships    |
                         | placements     |
                         +--------+-------+
                                  |
                         tenant placement
                                  |
          +-----------------------+-----------------------+
          |                       |                       |
   starter_pool_01         growth_pool_01       enterprise_acme_db
   shared tenant data      shared tenant data    one customer only
```

The platform database stores control-plane metadata. It must not store clinical transaction data.

Each domain service continues to own its data. A service must not query another service's database directly. Cross-service communication uses HTTP APIs or versioned events.

## 3. Database categories

### 3.1 Platform database

`platform_db` contains:

- tenants
- organizations and branches
- users and tenant memberships
- roles and permissions
- subscriptions and package limits
- database placements
- module activation
- provisioning jobs
- platform-level audit records

### 3.2 Pooled databases

Starter and Growth tenants use shared PostgreSQL databases. Every tenant-owned row must contain `tenant_id`.

A first deployment can use:

```text
starter_pool_01
```

When capacity or noisy-neighbor behavior requires it, add more pools:

```text
starter_pool_01
starter_pool_02
growth_pool_01
growth_pool_02
```

The tenant placement changes, but the tenant ID does not.

### 3.3 Enterprise databases

Each Enterprise customer receives a dedicated database or database cluster:

```text
enterprise_acme_db
enterprise_northstar_db
enterprise_cityhospital_db
```

The database is provisioned from the same schema migrations as the pooled database. It receives its own credentials, backups, monitoring, connection limits, and restore process.

Where service boundaries require it, provision one database per Enterprise customer per domain service, for example:

```text
enterprise_acme_users_db
enterprise_acme_clinic_db
enterprise_acme_billing_db
enterprise_acme_notifications_db
```

Do not create foreign keys across service databases.

## 4. Control-plane schema

The following tables belong in `platform_db`.

```sql
CREATE TYPE subscription_plan AS ENUM (
  'starter',
  'growth',
  'enterprise'
);

CREATE TYPE database_mode AS ENUM (
  'pooled',
  'dedicated'
);

CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  legal_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan subscription_plan NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioning',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_database_assignments (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
  mode database_mode NOT NULL,
  pool_name TEXT,
  database_key TEXT NOT NULL,
  schema_version TEXT,
  status TEXT NOT NULL DEFAULT 'provisioning',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (
    (mode = 'pooled' AND pool_name IS NOT NULL)
    OR
    (mode = 'dedicated' AND pool_name IS NULL)
  )
);

CREATE INDEX tenant_database_assignments_database_idx
  ON tenant_database_assignments (database_key);
```

`database_key` is a secret-manager reference, not a raw password or connection string.

Example placements:

| Tenant     | Plan       | Mode      | Database key            |
| ---------- | ---------- | --------- | ----------------------- |
| Clinic A   | Starter    | pooled    | `starter_pool_01`       |
| Clinic B   | Growth     | pooled    | `growth_pool_01`        |
| Hospital A | Enterprise | dedicated | `enterprise_hospital_a` |

## 5. Pooled database schema

Every shared business table must carry the tenant boundary.

```sql
CREATE TABLE patients (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  medical_record_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, medical_record_number)
);

CREATE INDEX patients_tenant_idx
  ON patients (tenant_id);

CREATE INDEX patients_tenant_branch_idx
  ON patients (tenant_id, branch_id);
```

Use the same pattern for appointments, encounters, prescriptions, invoices, payments, inventory, audit records, and other tenant-owned data.

Use composite uniqueness constraints. For example, a medical record number is unique within a tenant, not necessarily across the whole platform.

## 6. Tenant isolation

Use multiple layers of isolation for pooled databases:

1. Resolve `tenantId` from a trusted authenticated claim.
2. Validate the user's membership and branch permissions.
3. Pass tenant context into the service request.
4. Include `tenant_id` in every query and mutation.
5. Enforce PostgreSQL Row-Level Security (RLS).
6. Test that cross-tenant reads and writes fail.

At the beginning of a transaction:

```sql
SELECT set_config('app.tenant_id', $1, true);
```

Example RLS policy:

```sql
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY patients_tenant_isolation
ON patients
USING (
  tenant_id = current_setting('app.tenant_id')::uuid
)
WITH CHECK (
  tenant_id = current_setting('app.tenant_id')::uuid
);
```

Use a restricted application database role so application code cannot bypass RLS accidentally.

## 7. Request routing

Every authenticated request should contain a tenant claim similar to:

```json
{
  "sub": "user-id",
  "tenantId": "tenant-id",
  "roles": ["doctor"],
  "branchIds": ["branch-id"]
}
```

The request flow is:

```text
1. Authenticate the request.
2. Read tenantId from the trusted token.
3. Load tenant placement from platform_db or a short-lived cache.
4. Resolve the pooled or dedicated connection pool.
5. Set tenant context for pooled databases.
6. Execute the service transaction.
7. Write the domain change and outbox event atomically.
8. Release the connection.
```

Never trust a tenant ID supplied only in a request body, URL, or query string.

## 8. Connection management

The application should use a connection manager instead of one global `DATABASE_URL`:

```ts
type TenantPlacement = {
  tenantId: string;
  mode: "pooled" | "dedicated";
  databaseKey: string;
  poolName?: string;
};

async function getTenantPool(tenantId: string) {
  const placement = await placementRepository.findByTenantId(tenantId);

  if (!placement || placement.status !== "active") {
    throw new Error("Tenant database is unavailable");
  }

  return connectionManager.getOrCreatePool(placement.databaseKey);
}
```

The connection manager must:

- cache pools by `databaseKey`
- enforce maximum connections per database
- close idle Enterprise pools
- refresh rotated credentials
- expose pool health and saturation metrics
- prevent one Enterprise tenant from exhausting process resources
- use PgBouncer for pooled databases where appropriate

Do not create a new PostgreSQL pool for every request.

## 9. Provisioning workflow

### Starter or Growth tenant

```text
1. Create tenant in platform_db with status=provisioning.
2. Create organization, branch, and initial membership.
3. Assign the appropriate pooled database.
4. Confirm the pooled schema version.
5. Enable the plan modules and limits.
6. Run a tenant health check.
7. Set tenant status=active.
```

### Enterprise tenant

```text
1. Create tenant in platform_db with status=provisioning.
2. Provision the dedicated database.
3. Create credentials and store them in the secret manager.
4. Run database migrations.
5. Seed required roles and permissions.
6. Create the placement record.
7. Run connectivity, schema, backup, and isolation checks.
8. Set tenant status=active.
```

A tenant must not become active until provisioning and health checks complete successfully.

Provisioning should be an idempotent job. Retrying it must not create duplicate databases, users, or memberships.

## 10. Plan changes and data movement

### Starter to Growth

If both plans remain in pooled storage:

```text
1. Update the subscription and limits.
2. Enable Growth modules.
3. Keep the same tenant ID and database placement.
```

If the tenant moves to a Growth pool:

```text
1. Provision or select the target pool.
2. Copy only that tenant's rows.
3. Validate counts and checksums.
4. Pause writes briefly.
5. Switch tenant_database_assignments.
6. Resume writes and monitor.
```

### Growth to Enterprise

```text
1. Provision the Enterprise database.
2. Apply the same schema version.
3. Copy the tenant data.
4. Validate counts, checksums, indexes, and permissions.
5. Schedule a short write pause.
6. Perform a final incremental copy.
7. Change the placement to dedicated.
8. Resume writes.
9. Monitor errors, latency, and event delivery.
```

Keep the tenant ID, patient IDs, invoice IDs, and event IDs unchanged during migration.

Do not automatically move a customer out of dedicated storage because of a billing change. Treat that as a planned migration with customer and compliance approval.

## 11. Events and operational tables

Every service database, pooled or dedicated, needs its own operational tables:

```sql
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY,
  tenant_id UUID,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE TABLE inbox_events (
  event_id UUID PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Every domain write and its outbox event must be committed in one transaction. Events must include `tenantId` and `correlationId`.

Do not place sensitive clinical information in logs or event payloads unless the receiving contract explicitly requires it.

## 12. Migrations and backups

Maintain three migration targets:

```text
platform migrations       -> platform_db
pooled service migrations -> starter/growth pools
dedicated migrations      -> Enterprise databases
```

Use one versioned migration set for pooled and dedicated service schemas. Run migrations through a controlled job, not from every application replica.

For each Enterprise database, maintain:

- independent backup policy
- restore verification
- retention policy
- schema version tracking
- database health metrics
- tenant-specific recovery runbook

## 13. Recommended first release

Start with:

```text
platform_db
shared_pool_db
Enterprise databases created on demand
```

Implement these components first:

1. tenant and placement tables
2. tenant-aware authentication context
3. pooled database tenant columns and RLS
4. placement resolver
5. connection manager
6. Enterprise provisioning worker
7. schema migration runner
8. tenant migration and validation job
9. per-database backups and health checks

Later, split the shared database into separate Starter and Growth pools when capacity, compliance, or noisy-neighbor behavior requires it. This preserves the package model without introducing unnecessary operational complexity at the beginning.
