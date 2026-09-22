-- Row-Level Security for subscriptions_db's tenant-owned tables, per
-- docs/database-tenancy-strategy.md §6.
--
-- STATUS: prepared but not yet enforced — see admin/0004_row_level_security.sql
-- for why (app connects as table owner, which bypasses RLS unless the table
-- is also FORCEd; nothing yet sets app.tenant_id). Do not add FORCE ROW
-- LEVEL SECURITY until a restricted app role exists and every relevant
-- query path sets the session's tenant context.

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

-- linked_tenant_id is nullable and visibility-only (per this table's own
-- comment: "A hospital linked here can SEE this subscription; it never
-- pays for it"). A subscription with no linked tenant yet stays visible
-- to its owning patient; once linked, only that tenant's session can see
-- it too — but only via app-level patient_id checks, since this table has
-- no tenant-scoped WITH CHECK write path (a patient, not a tenant, owns
-- the write).
ALTER TABLE device_subscriptions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'device_subscriptions' AND policyname = 'device_subscriptions_tenant_isolation'
  ) THEN
    CREATE POLICY device_subscriptions_tenant_isolation ON device_subscriptions
      USING (linked_tenant_id IS NULL OR linked_tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (linked_tenant_id IS NULL OR linked_tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
