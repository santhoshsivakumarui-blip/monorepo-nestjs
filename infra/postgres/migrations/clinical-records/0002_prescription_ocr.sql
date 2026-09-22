CREATE TABLE IF NOT EXISTS prescription_scans (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prescription_scans_user_idx ON prescription_scans (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS prescription_scan_items (
  id UUID PRIMARY KEY,
  scan_id UUID NOT NULL REFERENCES prescription_scans(id),
  name TEXT NOT NULL,
  dose TEXT,
  confidence TEXT,
  needs_check BOOLEAN NOT NULL DEFAULT false,
  confirmed BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS active_medications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID,
  name TEXT NOT NULL,
  dose TEXT,
  source_scan_id UUID REFERENCES prescription_scans(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS active_medications_user_idx ON active_medications (user_id, created_at DESC);
