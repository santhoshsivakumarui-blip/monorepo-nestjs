-- Row-Level Security for clinical-records_db's tenant-owned tables, per
-- docs/database-tenancy-strategy.md §6.
--
-- STATUS: prepared but not yet enforced — see admin/0004_row_level_security.sql
-- for why (app connects as table owner, which bypasses RLS unless the table
-- is also FORCEd; nothing yet sets app.tenant_id). Do not add FORCE ROW
-- LEVEL SECURITY until a restricted app role exists and every relevant
-- query path sets the session's tenant context.

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'messages_tenant_isolation'
  ) THEN
    CREATE POLICY messages_tenant_isolation ON messages
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'notes_tenant_isolation'
  ) THEN
    CREATE POLICY notes_tenant_isolation ON notes
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE patient_files ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'patient_files' AND policyname = 'patient_files_tenant_isolation'
  ) THEN
    CREATE POLICY patient_files_tenant_isolation ON patient_files
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'visits' AND policyname = 'visits_tenant_isolation'
  ) THEN
    CREATE POLICY visits_tenant_isolation ON visits
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- prescription_scans/active_medications.tenant_id are nullable: a scan or
-- an active medication can exist before the patient has linked a hospital.
-- Rows with no tenant yet stay visible (patient-owned); once claimed by a
-- tenant, only that tenant's session can see or write the row.
ALTER TABLE prescription_scans ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'prescription_scans' AND policyname = 'prescription_scans_tenant_isolation'
  ) THEN
    CREATE POLICY prescription_scans_tenant_isolation ON prescription_scans
      USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE active_medications ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'active_medications' AND policyname = 'active_medications_tenant_isolation'
  ) THEN
    CREATE POLICY active_medications_tenant_isolation ON active_medications
      USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Not covered here, deliberately: `prescription_scan_items` and
-- `visit_medications` have no tenant_id column — they're reached only via
-- their parent (scan_id / visit_id), which already carries the isolation.
