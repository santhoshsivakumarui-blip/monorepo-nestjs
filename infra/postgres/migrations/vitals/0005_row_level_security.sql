-- Row-Level Security for vitals_db's tenant-owned tables, per
-- docs/database-tenancy-strategy.md §6.
--
-- STATUS: prepared but not yet enforced — see admin/0004_row_level_security.sql
-- for why (app connects as table owner, which bypasses RLS unless the table
-- is also FORCEd; nothing yet sets app.tenant_id). Do not add FORCE ROW
-- LEVEL SECURITY until a restricted app role exists and every relevant
-- query path sets the session's tenant context.

ALTER TABLE vitals_consent ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'vitals_consent' AND policyname = 'vitals_consent_tenant_isolation'
  ) THEN
    CREATE POLICY vitals_consent_tenant_isolation ON vitals_consent
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Read-model cache of users_db's patient_hospital_links. Gets its own
-- policy too: without it, any tenant could read which OTHER tenant every
-- patient in the system is currently linked to.
ALTER TABLE patient_hospital_link_cache ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'patient_hospital_link_cache' AND policyname = 'patient_hospital_link_cache_tenant_isolation'
  ) THEN
    CREATE POLICY patient_hospital_link_cache_tenant_isolation ON patient_hospital_link_cache
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'alert_rules' AND policyname = 'alert_rules_tenant_isolation'
  ) THEN
    CREATE POLICY alert_rules_tenant_isolation ON alert_rules
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE patient_alert_overrides ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'patient_alert_overrides' AND policyname = 'patient_alert_overrides_tenant_isolation'
  ) THEN
    CREATE POLICY patient_alert_overrides_tenant_isolation ON patient_alert_overrides
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE triage_events ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'triage_events' AND policyname = 'triage_events_tenant_isolation'
  ) THEN
    CREATE POLICY triage_events_tenant_isolation ON triage_events
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE vitals_access_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'vitals_access_log' AND policyname = 'vitals_access_log_tenant_isolation'
  ) THEN
    CREATE POLICY vitals_access_log_tenant_isolation ON vitals_access_log
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Not covered here, deliberately: `vitals_readings` and
-- `medication_schedules`/`medication_doses` have no tenant_id column at
-- all — they're scoped by user_id only (a patient's vitals/medications
-- belong to them regardless of which hospital they're linked to today).
