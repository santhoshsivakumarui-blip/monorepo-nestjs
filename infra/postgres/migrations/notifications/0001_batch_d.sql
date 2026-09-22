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
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID PRIMARY KEY,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  sms_enabled BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS analytics_enabled BOOLEAN NOT NULL DEFAULT true;

-- POST /notifications has always enqueued Topics.notificationsRequested; until
-- now nothing consumed it. This table + the new consumer finally close that loop.
CREATE TABLE IF NOT EXISTS notifications_feed (
  id UUID PRIMARY KEY,
  recipient TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'system',
  title TEXT,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_feed_recipient_idx ON notifications_feed (recipient, created_at DESC);

CREATE TABLE IF NOT EXISTS sos_alerts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  vitals_snapshot JSONB,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sos_alerts_tenant_status_idx ON sos_alerts (tenant_id, status);
