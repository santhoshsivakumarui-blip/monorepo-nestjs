import { Logger } from "@nestjs/common";
import { database } from "../../../libs/common/src/database";
import {
  applyMigrationsTo, ensureDatabaseExists, withDatabaseName,
} from "../../../libs/tenancy/src/provision-database";
import { clearPlacementCache } from "../../../libs/tenancy/src/placement-resolver";
import { storeTenantDatabaseSecret } from "../../../libs/tenancy/src/secret-store";
import { dedicatedDatabaseKey } from "./tenant-provisioning";

const logger = new Logger("ProvisionDedicatedDatabase");

export type ProvisionDedicatedDatabaseResult = {
  service: string;
  databaseKey: string;
  appliedMigrations: string[];
};

/**
 * Creates and migrates the real, dedicated Postgres database for one
 * (tenant, service) pair, stores its connection string encrypted (see
 * libs/tenancy/src/secret-store.ts — Phase 2 of the tenancy rollout), then
 * flips its tenant_database_assignments row to 'active'. Called once per
 * TENANT_SCOPED_SERVICES entry after provisionTenant() has already
 * committed the tenant + placement metadata (see tenants.controller.ts) —
 * this is the part that actually touches infrastructure, run outside that
 * transaction since CREATE DATABASE can't run inside one and targets a
 * different database entirely.
 *
 * All dedicated databases are created on the SAME Postgres host/role this
 * admin service itself connects with (process.env.DATABASE_URL) — every
 * service's database already lives on that one Neon project today, and
 * this is the one process whose role should be doing CREATE DATABASE.
 * A real Enterprise deployment (separate cluster per customer) would swap
 * this for a call to the cloud provider's API instead; this is the
 * same-project version described as the "first release" starting point in
 * docs/database-tenancy-strategy.md §13.
 *
 * The connection string is never returned to a caller (nor logged) past
 * this function — it's encrypted and stored, and every later consumer
 * (connection-manager.ts's getOrCreatePool) fetches it back through
 * fetchTenantDatabaseSecret rather than having it passed around in plaintext.
 */
export async function provisionDedicatedDatabase(
  tenantId: string,
  slug: string,
  service: string,
): Promise<ProvisionDedicatedDatabaseResult> {
  const databaseKey = dedicatedDatabaseKey(slug, service);
  const adminConnectionString = process.env.DATABASE_URL;
  if (!adminConnectionString) throw new Error("DATABASE_URL is not set on the admin service.");

  const connectionString = withDatabaseName(adminConnectionString, databaseKey);

  logger.log(`Provisioning ${databaseKey} for tenant ${tenantId} (${service})`);
  await ensureDatabaseExists(connectionString);
  const appliedMigrations = await applyMigrationsTo(service, connectionString);
  await storeTenantDatabaseSecret(databaseKey, connectionString);

  const latestMigration = appliedMigrations[appliedMigrations.length - 1] ?? null;
  await database().query(
    `UPDATE tenant_database_assignments
       SET status = 'active', schema_version = COALESCE($3, schema_version), updated_at = NOW()
     WHERE tenant_id = $1 AND service = $2`,
    [tenantId, service, latestMigration],
  );
  clearPlacementCache();

  logger.log(`${databaseKey} active (${appliedMigrations.length} migration file(s) applied), connection string stored encrypted`);
  return { service, databaseKey, appliedMigrations };
}
