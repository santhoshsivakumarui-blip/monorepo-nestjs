-- Reconciles apps/admin's enterprise_tenants table with docs/database-tenancy-strategy.md §4.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_plan') THEN
    CREATE TYPE subscription_plan AS ENUM ('starter', 'growth', 'enterprise');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'database_mode') THEN
    CREATE TYPE database_mode AS ENUM ('pooled', 'dedicated');
  END IF;
END $$;

ALTER TABLE IF EXISTS enterprise_tenants RENAME TO tenants;

ALTER TABLE tenants RENAME COLUMN tenant_code TO slug;
ALTER TABLE tenants RENAME COLUMN lifecycle_status TO status;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tenants' AND constraint_name = 'tenants_slug_unique'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_slug_unique UNIQUE (slug);
  END IF;
END $$;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan subscription_plan NOT NULL DEFAULT 'enterprise';
ALTER TABLE tenants ALTER COLUMN plan DROP DEFAULT;
ALTER TABLE tenants DROP COLUMN IF EXISTS tenancy_model;

-- vault_secret_path/kms_key_arn only apply to dedicated-mode (Enterprise) tenants now;
-- Starter/Growth tenants are pooled and never populate them.
ALTER TABLE tenants ALTER COLUMN vault_secret_path DROP NOT NULL;
ALTER TABLE tenants ALTER COLUMN kms_key_arn DROP NOT NULL;

CREATE TABLE IF NOT EXISTS tenant_database_assignments (
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
    OR (mode = 'dedicated' AND pool_name IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS tenant_database_assignments_database_idx
  ON tenant_database_assignments (database_key);
