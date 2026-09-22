CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  metric TEXT NOT NULL,
  comparator TEXT NOT NULL,      -- 'gt' | 'lt'
  threshold NUMERIC NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_rules_tenant_metric_idx ON alert_rules (tenant_id, metric) WHERE enabled;

CREATE TABLE IF NOT EXISTS patient_alert_overrides (
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  metric TEXT NOT NULL,
  comparator TEXT NOT NULL,
  threshold NUMERIC NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id, metric)
);

-- rule_source records which table produced the breach ('hospital_wide' | 'patient_override').
-- status runs unconditionally on link status, not vitals_consent — see vitals.controller.ts.
CREATE TABLE IF NOT EXISTS triage_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  metric TEXT NOT NULL,
  value NUMERIC NOT NULL,
  rule_source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID
);
CREATE INDEX IF NOT EXISTS triage_events_tenant_status_idx ON triage_events (tenant_id, status, created_at DESC);
