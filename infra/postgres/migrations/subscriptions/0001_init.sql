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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_subscription_cycle') THEN
    CREATE TYPE device_subscription_cycle AS ENUM ('monthly', 'annual');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_subscription_status') THEN
    CREATE TYPE device_subscription_status AS ENUM ('active', 'paused', 'cancelled');
  END IF;
END $$;

-- user_id/device_sku/linked_tenant_id are opaque references to other services'
-- databases (users_db, admin_db) — no cross-database FKs, per docs/adr/0001-service-boundaries.md.
CREATE TABLE IF NOT EXISTS device_subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  device_sku TEXT NOT NULL,
  device_label TEXT NOT NULL,
  billing_cycle device_subscription_cycle NOT NULL,
  price_cents INT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  status device_subscription_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  -- Visibility only. A hospital linked here can SEE this subscription; it never pays for it.
  linked_tenant_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_subscriptions_user_idx ON device_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS device_subscriptions_tenant_idx ON device_subscriptions (linked_tenant_id);

-- Local read-model projection of users_db's patient_hospital_links state (cross-domain
-- reporting via a read model, per the ADR), fed by consuming Topics.patientHospitalLinked/
-- Unlinked. Lets POST /subscriptions set linked_tenant_id correctly even when the patient
-- linked a hospital before buying a subscription.
CREATE TABLE IF NOT EXISTS patient_hospital_link_cache (
  user_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL
);
