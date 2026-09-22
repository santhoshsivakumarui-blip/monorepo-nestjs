CREATE TABLE IF NOT EXISTS abha_links (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  abha_id TEXT,
  status TEXT NOT NULL DEFAULT 'not_linked',
  linked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS abha_requests (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID,
  abha_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abha_requests_tenant_status_idx ON abha_requests (tenant_id, status);

CREATE TABLE IF NOT EXISTS abha_activity (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  what TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abha_activity_tenant_idx ON abha_activity (tenant_id, created_at DESC);
