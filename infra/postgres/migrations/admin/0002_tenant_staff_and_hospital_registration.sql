-- A public, unauthenticated hospital self-registration has no admin actor.
ALTER TABLE admin_audit_events ALTER COLUMN admin_id DROP NOT NULL;
ALTER TABLE admin_audit_events ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'PLATFORM_ADMIN';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_staff_role') THEN
    CREATE TYPE tenant_staff_role AS ENUM ('Doctor', 'Nurse', 'Reception', 'Admin', 'Auditor');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant_staff (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role tenant_staff_role NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_challenges (
  id UUID PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES tenant_staff(id),
  code_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
