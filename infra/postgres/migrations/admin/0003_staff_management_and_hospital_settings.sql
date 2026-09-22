ALTER TABLE tenant_staff ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE tenant_staff ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE tenant_staff ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE tenant_staff ADD COLUMN IF NOT EXISTS license TEXT;
ALTER TABLE tenant_staff ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tenant_staff ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS staff_invites (
  token_hash TEXT PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES tenant_staff(id),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hospital_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
  linking_code TEXT UNIQUE NOT NULL,
  emergency_phone TEXT,
  require_mfa BOOLEAN NOT NULL DEFAULT true,
  audit_retention_years INT NOT NULL DEFAULT 2,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hospital_monitoring_defaults (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  value TEXT,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS hospital_integrations (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  integration_key TEXT NOT NULL,
  connected BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, integration_key)
);

CREATE TABLE IF NOT EXISTS hospital_audit_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  actor_id UUID,
  actor_label TEXT,
  action TEXT NOT NULL,
  target TEXT,
  category TEXT NOT NULL,        -- 'Consent' | 'Access' | 'Roles' | 'Settings' | 'Auth'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hospital_audit_events_tenant_idx ON hospital_audit_events (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_notification_preferences (
  staff_id UUID PRIMARY KEY REFERENCES tenant_staff(id),
  critical BOOLEAN NOT NULL DEFAULT true,
  messages BOOLEAN NOT NULL DEFAULT true,
  scripts BOOLEAN NOT NULL DEFAULT true,
  weekly_summary BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  id UUID PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES tenant_staff(id),
  device_label TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES tenant_staff(id),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
