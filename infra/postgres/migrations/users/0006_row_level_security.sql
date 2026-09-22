-- Row-Level Security for users_db's tenant-owned tables, per
-- docs/database-tenancy-strategy.md §6.
--
-- STATUS: prepared but not yet enforced — see admin/0004_row_level_security.sql
-- for why (app connects as table owner, which bypasses RLS unless the table
-- is also FORCEd; nothing yet sets app.tenant_id). Do not add FORCE ROW
-- LEVEL SECURITY until a restricted app role exists and every relevant
-- query path sets the session's tenant context.

ALTER TABLE patient_hospital_links ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'patient_hospital_links' AND policyname = 'patient_hospital_links_tenant_isolation'
  ) THEN
    CREATE POLICY patient_hospital_links_tenant_isolation ON patient_hospital_links
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE link_requests ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'link_requests' AND policyname = 'link_requests_tenant_isolation'
  ) THEN
    CREATE POLICY link_requests_tenant_isolation ON link_requests
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE abha_activity ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'abha_activity' AND policyname = 'abha_activity_tenant_isolation'
  ) THEN
    CREATE POLICY abha_activity_tenant_isolation ON abha_activity
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- abha_requests.tenant_id is nullable: a request can exist before the
-- patient has linked any hospital. Rows with no tenant yet stay visible
-- (they're patient-owned, not cross-tenant); once tenant_id is set, only
-- that tenant's session can see or write the row.
ALTER TABLE abha_requests ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'abha_requests' AND policyname = 'abha_requests_tenant_isolation'
  ) THEN
    CREATE POLICY abha_requests_tenant_isolation ON abha_requests
      USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Not covered here, deliberately: `users` (no tenant_id — a user account
-- isn't owned by any one tenant) and `abha_links` (patient-owned, no
-- tenant_id column).
