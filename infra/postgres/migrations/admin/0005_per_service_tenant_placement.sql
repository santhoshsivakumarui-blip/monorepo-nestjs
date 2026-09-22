-- docs/database-tenancy-strategy.md §3.3 describes one dedicated database
-- PER DOMAIN SERVICE for an Enterprise tenant (enterprise_acme_users_db,
-- enterprise_acme_vitals_db, ...), but tenant_database_assignments has only
-- ever supported one placement row per tenant. This migration adds a
-- `service` column so a tenant can have a different placement per service.
--
-- Pooled (Starter/Growth) tenants keep a single row that applies to every
-- service — service = '*' is that wildcard, chosen over NULL because a
-- primary-key column can't be NULL. A dedicated (Enterprise) tenant instead
-- gets one row per real service name ('users', 'vitals', 'notifications',
-- 'clinical-records', 'subscriptions').
--
-- `admin` is deliberately never one of those per-tenant service rows: it
-- hosts this very registry (tenants, tenant_database_assignments) plus
-- other platform-wide tables, so a per-tenant dedicated copy of it would
-- duplicate the registry itself. admin's own tenant-owned tables
-- (tenant_staff, hospital_settings, hospital_audit_events, ...) stay in the
-- shared admin_db for every tenant regardless of plan — a known limitation
-- of this pass, not a design endorsement.

ALTER TABLE tenant_database_assignments ADD COLUMN IF NOT EXISTS service TEXT NOT NULL DEFAULT '*';
ALTER TABLE tenant_database_assignments ALTER COLUMN service DROP DEFAULT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_database_assignments_pkey'
  ) THEN
    ALTER TABLE tenant_database_assignments DROP CONSTRAINT tenant_database_assignments_pkey;
  END IF;
END $$;

ALTER TABLE tenant_database_assignments ADD PRIMARY KEY (tenant_id, service);

-- The old single-row-per-tenant index is superseded by the primary key above.
DROP INDEX IF EXISTS tenant_database_assignments_database_idx;
CREATE INDEX IF NOT EXISTS tenant_database_assignments_database_idx
  ON tenant_database_assignments (database_key);
