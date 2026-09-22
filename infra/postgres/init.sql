CREATE DATABASE users_db;
CREATE DATABASE orders_db;
CREATE DATABASE notifications_db;
CREATE DATABASE email_db;
CREATE DATABASE sms_db;
CREATE DATABASE admin_db;
CREATE DATABASE shared_pool_db;
\connect users_db
CREATE TABLE outbox_events (id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, published_at TIMESTAMPTZ, attempts INT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, dead_lettered_at TIMESTAMPTZ);
CREATE TABLE inbox_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response JSONB, completed_at TIMESTAMPTZ);
CREATE TABLE users (id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL, roles TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[], created_at TIMESTAMPTZ NOT NULL DEFAULT now());
\connect orders_db
CREATE TABLE outbox_events (id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, published_at TIMESTAMPTZ, attempts INT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, dead_lettered_at TIMESTAMPTZ);
CREATE TABLE inbox_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response JSONB, completed_at TIMESTAMPTZ);
CREATE TABLE orders (id UUID PRIMARY KEY, user_id UUID NOT NULL, total NUMERIC(12,2) NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
\connect notifications_db
CREATE TABLE outbox_events (id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, published_at TIMESTAMPTZ, attempts INT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, dead_lettered_at TIMESTAMPTZ);
CREATE TABLE inbox_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response JSONB, completed_at TIMESTAMPTZ);
CREATE TABLE notification_preferences (user_id UUID PRIMARY KEY, email_enabled BOOLEAN NOT NULL DEFAULT true, sms_enabled BOOLEAN NOT NULL DEFAULT false);
\connect email_db
CREATE TABLE outbox_events (id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, published_at TIMESTAMPTZ, attempts INT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, dead_lettered_at TIMESTAMPTZ);
CREATE TABLE inbox_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response JSONB, completed_at TIMESTAMPTZ);
\connect sms_db
CREATE TABLE outbox_events (id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, published_at TIMESTAMPTZ, attempts INT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, dead_lettered_at TIMESTAMPTZ);
CREATE TABLE inbox_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response JSONB, completed_at TIMESTAMPTZ);
\connect admin_db
CREATE TABLE outbox_events (id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, published_at TIMESTAMPTZ, attempts INT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, dead_lettered_at TIMESTAMPTZ);
CREATE TABLE inbox_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response JSONB, completed_at TIMESTAMPTZ);
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  mfa_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  role VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE enterprise_tenants (
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
CREATE TABLE global_hardware_catalog (
  sku VARCHAR(50) PRIMARY KEY,
  model_name VARCHAR(100) NOT NULL,
  hardware_revision VARCHAR(20) NOT NULL,
  min_supported_firmware VARCHAR(20) NOT NULL,
  sensor_capabilities JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE admin_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  action VARCHAR(100) NOT NULL,
  target_tenant_id UUID REFERENCES enterprise_tenants(id),
  ip_address INET NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
