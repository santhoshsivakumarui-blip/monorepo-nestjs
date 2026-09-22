import { PoolClient } from "pg";
import { ALL_SERVICES_PLACEMENT, TENANT_SCOPED_SERVICES } from "../../../libs/tenancy/src/types";

export interface ProvisionTenantParams {
  tenantId: string;
  slug: string;
  legalName: string;
  complianceFramework: string;
  plan: "starter" | "growth" | "enterprise";
  mode: "pooled" | "dedicated";
  regionAffinity: string;
  vaultSecretPath: string | null;
  kmsKeyArn: string | null;
}

export type ServicePlacement = { service: string; databaseKey: string; status: string };

/** `enterprise_<slug>_<service>_db` — matches docs/database-tenancy-strategy.md §3.3's naming. */
export function dedicatedDatabaseKey(slug: string, service: string): string {
  return `enterprise_${slug}_${service}_db`;
}

/**
 * Shared by POST /tenants (staff-provisioned) and POST /hospitals/register
 * (self-service — always pooled, see that controller's own comment).
 *
 * Writes the `tenants` row and this tenant's placement row(s):
 * - pooled: one row, service = ALL_SERVICES_PLACEMENT ('*'), immediately active.
 * - dedicated: one row per TENANT_SCOPED_SERVICES entry, starting in
 *   'provisioning' — each one only becomes reachable once
 *   provisionDedicatedDatabase (see provision-dedicated-database.ts) has
 *   actually created and migrated that service's database and flipped its
 *   row to 'active'. This function only writes metadata; it never touches
 *   infrastructure itself.
 */
export async function provisionTenant(client: PoolClient, params: ProvisionTenantParams) {
  await client.query(
    `INSERT INTO tenants
       (id, slug, legal_name, compliance_framework, plan, region_affinity, vault_secret_path, kms_key_arn, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'provisioning')`,
    [params.tenantId, params.slug, params.legalName, params.complianceFramework,
     params.plan, params.regionAffinity, params.vaultSecretPath, params.kmsKeyArn],
  );

  const placements: ServicePlacement[] = [];

  if (params.mode === "pooled") {
    const databaseKey = "shared_pool_db";
    await client.query(
      `INSERT INTO tenant_database_assignments (tenant_id, service, mode, pool_name, database_key, status)
       VALUES ($1, $2, 'pooled', 'shared_pool_01', $3, 'active')`,
      [params.tenantId, ALL_SERVICES_PLACEMENT, databaseKey],
    );
    placements.push({ service: ALL_SERVICES_PLACEMENT, databaseKey, status: "active" });
    return { placements };
  }

  for (const service of TENANT_SCOPED_SERVICES) {
    const databaseKey = dedicatedDatabaseKey(params.slug, service);
    await client.query(
      `INSERT INTO tenant_database_assignments (tenant_id, service, mode, pool_name, database_key, status)
       VALUES ($1, $2, 'dedicated', NULL, $3, 'provisioning')`,
      [params.tenantId, service, databaseKey],
    );
    placements.push({ service, databaseKey, status: "provisioning" });
  }
  return { placements };
}
