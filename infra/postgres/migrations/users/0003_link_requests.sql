CREATE TABLE IF NOT EXISTS link_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID,
  origin TEXT NOT NULL,          -- 'qr_desk' | 'invite_link'
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'redeemed' | 'revoked'
  invite_code TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS link_requests_tenant_status_idx ON link_requests (tenant_id, status, created_at DESC);
