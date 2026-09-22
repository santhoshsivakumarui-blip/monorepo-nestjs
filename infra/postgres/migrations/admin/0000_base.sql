-- Base scaffolding, previously only created by infra/postgres/init.sql's
-- one-time docker-entrypoint-initdb.d hook against the local dev container.
-- Numbered ahead of 0001_tenant_platform_schema.sql (which renames and alters
-- enterprise_tenants, so assumes this shape already exists) so
-- `db-migrate.js admin` can provision a database anywhere, not just replay
-- on top of a local Postgres volume.
CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  dead_lettered_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS inbox_events (
  id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  response JSONB,
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  mfa_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  role VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS enterprise_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code VARCHAR(50) UNIQUE NOT NULL,
  legal_name VARCHAR(255) NOT NULL,
  compliance_framework VARCHAR(50) NOT NULL,
  tenancy_model VARCHAR(30) NOT NULL,
  region_affinity VARCHAR(50) NOT NULL,
  vault_secret_path VARCHAR(255) NOT NULL,
  kms_key_arn VARCHAR(255) NOT NULL,
  lifecycle_status VARCHAR(30) NOT NULL DEFAULT 'provisioning',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS global_hardware_catalog (
  sku VARCHAR(50) PRIMARY KEY,
  model_name VARCHAR(100) NOT NULL,
  hardware_revision VARCHAR(20) NOT NULL,
  min_supported_firmware VARCHAR(20) NOT NULL,
  sensor_capabilities JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS admin_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  action VARCHAR(100) NOT NULL,
  target_tenant_id UUID REFERENCES enterprise_tenants(id),
  ip_address INET NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
