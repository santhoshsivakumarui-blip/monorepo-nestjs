import { Pool } from "pg";
import {
  database,
  registerTenantPoolResolver,
} from "../../common/src/database";
import { findPlacement } from "./placement-resolver";
import { getOrCreatePool } from "./connection-manager";
import type { TenantScopedService } from "./types";

/**
 * Returns the pg Pool where `tenantId`'s data for `service` physically lives:
 *   - dedicated (Enterprise) → that tenant's own database pool,
 *   - pooled (Starter/Growth) or a legacy tenant with no placement row →
 *     this service's default pool (its own `*_db`), which is where all pooled
 *     tenant data already lives today.
 *
 * Throws only when a placement row exists but isn't active yet (a dedicated
 * database still provisioning) — reading/writing the default pool in that
 * window would silently put Enterprise data in the shared database.
 */
export async function resolveTenantPool(
  tenantId: string,
  service: TenantScopedService,
): Promise<Pool> {
  const placement = await findPlacement(tenantId, service);
  if (!placement) return database();
  if (placement.status !== "active") {
    throw new Error(
      `Tenant database is not ready for tenant ${tenantId} (service ${service}, status ${placement.status})`,
    );
  }
  if (placement.mode === "dedicated") return getOrCreatePool(placement.databaseKey);
  return database();
}

/**
 * Call once at service bootstrap (after the DB is reachable) to make every
 * tenant-scoped query in this process route to the right database. It wires
 * libs/common's queryAsTenant/withTenantTransaction — which already receive a
 * tenantId — to resolve the pool through here, so the ~36 existing call sites
 * route correctly with no changes at the call site.
 */
export function registerTenantRouting(service: TenantScopedService): void {
  registerTenantPoolResolver((tenantId) => resolveTenantPool(tenantId, service));
}

/**
 * Fan a patient-facing "mine" query across every database that could hold this
 * patient's rows, then merge the results.
 *
 * Why: a patient can be linked to both pooled hospitals (data in this service's
 * default DB) and Enterprise hospitals (data in each hospital's dedicated DB).
 * Their own cross-hospital view must union all of them. `linkedTenantIds` is the
 * patient's link set, read from the unsharded link cache in the default DB.
 *
 * The default pool is ALWAYS queried (it holds every pooled tenant's data plus
 * any not-yet-linked rows); each linked dedicated database is queried once
 * (de-duplicated by pool identity, since a patient linked to two branches of
 * the same Enterprise tenant hits one database).
 *
 * `query` runs the same read against each pool. Provide `dedupeBy` when the
 * same row could appear in more than one database (e.g. during a migration
 * cutover) to keep only the first occurrence.
 */
export async function scatterGather<T>(
  linkedTenantIds: string[],
  service: TenantScopedService,
  query: (pool: Pool) => Promise<T[]>,
  opts?: { dedupeBy?: (row: T) => string },
): Promise<T[]> {
  const pools: Pool[] = [database()];
  const seen = new Set<Pool>(pools);

  for (const tenantId of new Set(linkedTenantIds)) {
    // A tenant mid-provisioning must not fail the patient's own read of their
    // other hospitals; skip it here (its data isn't queryable yet anyway).
    let pool: Pool;
    try {
      pool = await resolveTenantPool(tenantId, service);
    } catch {
      continue;
    }
    if (!seen.has(pool)) {
      seen.add(pool);
      pools.push(pool);
    }
  }

  const results = await Promise.all(pools.map((pool) => query(pool)));
  const merged = results.flat();

  const dedupeBy = opts?.dedupeBy;
  if (!dedupeBy) return merged;

  const unique: T[] = [];
  const keys = new Set<string>();
  for (const row of merged) {
    const key = dedupeBy(row);
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(row);
  }
  return unique;
}
