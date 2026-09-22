-- Row-Level Security for admin_db's tenant-owned tables, per
-- docs/database-tenancy-strategy.md §6.
--
-- STATUS: prepared but not yet enforced. Every service currently connects as
-- neondb_owner (see .env), and Postgres does not apply RLS to a table's
-- owner unless the table is also set to FORCE ROW LEVEL SECURITY. These
-- policies are therefore inert today — they change nothing about how the
-- app behaves — until a follow-up change:
--   1. creates a restricted, non-owner application role,
--   2. switches each service's DATABASE_URL to connect as that role,
--   3. adds `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, and
--   4. wires `SELECT set_config('app.tenant_id', $1, true)` (see
--      libs/common/src/database.ts's withTenantContext) into every request
--      path that queries these tables.
-- Do not add FORCE ROW LEVEL SECURITY until step 4 is done, or every
-- current query against these tables will start failing.
--
-- current_setting(..., true) (missing_ok) is used instead of the strategy
-- doc's single-arg form so that once enforcement is turned on, a request
-- that forgot to set app.tenant_id fails CLOSED (sees zero rows) rather
-- than throwing "unrecognized configuration parameter".

ALTER TABLE tenant_staff ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tenant_staff' AND policyname = 'tenant_staff_tenant_isolation'
  ) THEN
    CREATE POLICY tenant_staff_tenant_isolation ON tenant_staff
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE hospital_settings ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'hospital_settings' AND policyname = 'hospital_settings_tenant_isolation'
  ) THEN
    CREATE POLICY hospital_settings_tenant_isolation ON hospital_settings
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE hospital_monitoring_defaults ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'hospital_monitoring_defaults' AND policyname = 'hospital_monitoring_defaults_tenant_isolation'
  ) THEN
    CREATE POLICY hospital_monitoring_defaults_tenant_isolation ON hospital_monitoring_defaults
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE hospital_integrations ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'hospital_integrations' AND policyname = 'hospital_integrations_tenant_isolation'
  ) THEN
    CREATE POLICY hospital_integrations_tenant_isolation ON hospital_integrations
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE hospital_audit_events ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'hospital_audit_events' AND policyname = 'hospital_audit_events_tenant_isolation'
  ) THEN
    CREATE POLICY hospital_audit_events_tenant_isolation ON hospital_audit_events
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Not covered here, deliberately: `tenants` and `tenant_database_assignments`
-- (the control-plane registry itself — platform staff must see every
-- tenant, so a per-tenant policy would be wrong) and `admin_users` /
-- `admin_audit_events` / `global_hardware_catalog` (platform-staff-owned,
-- not tenant-owned).
