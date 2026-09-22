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

-- metric is free TEXT (not an enum) so a future proprietary device can introduce
-- new metric names without a schema migration; source is likewise unvalidated
-- ('google_fit' today, 'device'/'manual' later).
CREATE TABLE IF NOT EXISTS vitals_readings (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  metric TEXT NOT NULL,
  value NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vitals_readings_user_metric_idx ON vitals_readings (user_id, metric, recorded_at DESC);

CREATE TABLE IF NOT EXISTS vitals_consent (
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  category TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id, category)
);

-- Read-model projection of users_db's patient_hospital_links, fed by consuming
-- Topics.patientHospitalLinked/patientHospitalUnlinked — no cross-service query,
-- same pattern as subscriptions_db.patient_hospital_link_cache.
CREATE TABLE IF NOT EXISTS patient_hospital_link_cache (
  user_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL
);
