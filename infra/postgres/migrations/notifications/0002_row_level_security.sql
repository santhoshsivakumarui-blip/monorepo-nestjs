-- Row-Level Security for notifications_db's tenant-owned tables, per
-- docs/database-tenancy-strategy.md §6.
--
-- STATUS: prepared but not yet enforced — see admin/0004_row_level_security.sql
-- for why (app connects as table owner, which bypasses RLS unless the table
-- is also FORCEd; nothing yet sets app.tenant_id). Do not add FORCE ROW
-- LEVEL SECURITY until a restricted app role exists and every relevant
-- query path sets the session's tenant context.

-- sos_alerts.tenant_id is nullable: an SOS can be triggered before the
-- patient has linked a hospital. Rows with no tenant yet stay visible
-- (patient-owned); once a tenant is set, only that tenant's session can
-- see or write the row.
ALTER TABLE sos_alerts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sos_alerts' AND policyname = 'sos_alerts_tenant_isolation'
  ) THEN
    CREATE POLICY sos_alerts_tenant_isolation ON sos_alerts
      USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Not covered here, deliberately: `notification_preferences` and
-- `notifications_feed` have no tenant_id column — they're scoped by
-- user_id/recipient only, not owned by any one tenant.
