import { registryDatabase } from "./registry-database";
import { ALL_SERVICES_PLACEMENT, TenantPlacement } from "./types";

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { placement: TenantPlacement; expiresAt: number }>();

function cacheKey(tenantId: string, service: string): string {
  return `${tenantId}:${service}`;
}

/**
 * Resolves a tenant's database placement for one service, from admin_db,
 * cached briefly per docs/database-tenancy-strategy.md §8.
 *
 * A pooled tenant has one row with service = ALL_SERVICES_PLACEMENT ('*')
 * that applies to every service. A dedicated (Enterprise) tenant instead has
 * one row per real service name — see
 * infra/postgres/migrations/admin/0005_per_service_tenant_placement.sql.
 * This prefers an exact (tenantId, service) row over the wildcard, so a
 * tenant that's dedicated for one service but still pooled for another
 * (mid-migration, see the strategy doc's §10) resolves correctly either way.
 *
 * Returns null when the tenant has NO placement row at all (a legacy tenant
 * provisioned before per-service placement existed) — callers treat that as
 * pooled. It still returns a row whose status is not 'active' (e.g. a
 * dedicated database mid-provisioning); use resolvePlacement below when you
 * want that to be a hard error.
 */
export async function findPlacement(tenantId: string, service: string): Promise<TenantPlacement | null> {
  const key = cacheKey(tenantId, service);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.placement;

  const { rows } = await registryDatabase().query<{
    mode: "pooled" | "dedicated";
    pool_name: string | null;
    database_key: string;
    status: string;
    service: string;
  }>(
    `SELECT a.mode, a.pool_name, a.database_key, a.status, a.service
     FROM tenant_database_assignments a
     JOIN tenants t ON t.id = a.tenant_id
     WHERE a.tenant_id = $1 AND a.service IN ($2, $3)
     ORDER BY (a.service = $2) DESC
     LIMIT 1`,
    [tenantId, service, ALL_SERVICES_PLACEMENT],
  );

  const row = rows[0];
  if (!row) return null;

  const placement: TenantPlacement = {
    tenantId,
    mode: row.mode,
    databaseKey: row.database_key,
    poolName: row.pool_name ?? undefined,
    status: row.status,
  };
  cache.set(key, { placement, expiresAt: Date.now() + CACHE_TTL_MS });
  return placement;
}

/** Like findPlacement, but throws unless an ACTIVE placement exists. */
export async function resolvePlacement(tenantId: string, service: string): Promise<TenantPlacement> {
  const placement = await findPlacement(tenantId, service);
  if (!placement || placement.status !== "active") {
    throw new Error(`Tenant database is unavailable for tenant ${tenantId} (service ${service})`);
  }
  return placement;
}

export function clearPlacementCache() {
  cache.clear();
}
