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

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  from_role TEXT NOT NULL,       -- 'clinician' | 'patient'
  author_id UUID NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_user_tenant_idx ON messages (user_id, tenant_id, created_at);

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  kind TEXT NOT NULL,            -- 'clinical' | 'system'
  text TEXT NOT NULL,
  author_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_user_tenant_idx ON notes (user_id, tenant_id, created_at);

-- url is a placeholder until real object storage is wired up (no S3/Blob/GCS
-- integration exists anywhere in this codebase yet).
CREATE TABLE IF NOT EXISTS patient_files (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,            -- 'pdf' | 'image' | 'dicom'
  size_bytes BIGINT,
  uploaded_by UUID NOT NULL,
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_files_user_tenant_idx ON patient_files (user_id, tenant_id, created_at);

-- Scoped to this hospital's own staff-recorded visits (is_this_hospital always
-- true in this pass) — cross-hospital/ABHA-sourced visits are a later batch.
CREATE TABLE IF NOT EXISTS visits (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  is_this_hospital BOOLEAN NOT NULL DEFAULT true,
  doctor TEXT,
  reason TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS visit_medications (
  visit_id UUID NOT NULL REFERENCES visits(id),
  name TEXT NOT NULL,
  dose TEXT
);
