import { Pool } from "pg";

/**
 * Connection to the tenant REGISTRY database (admin_db), which holds
 * `tenants`, `tenant_database_assignments` and `tenant_database_secrets`.
 *
 * Every other table in the platform is sharded per-service (each service's
 * own `*_db`) or per-tenant (Enterprise dedicated databases), but the registry
 * is deliberately never sharded — admin hosts it and it is the single source of
 * truth for "where does this tenant's data live". So resolving a placement or
 * fetching a dedicated database's connection string must always talk to
 * admin_db, NOT to the calling service's own `DATABASE_URL` (which, for vitals
 * or users, points at a database that has no registry tables at all).
 *
 * `ADMIN_DATABASE_URL` is present in every service's environment (docker-compose
 * gives all of them `env_file: .env`). It falls back to `DATABASE_URL` so the
 * admin service itself — and single-database local/test setups — keep working
 * unchanged.
 */
let registryPool: Pool | undefined;

export function registryConnectionString(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const url = env.ADMIN_DATABASE_URL ?? env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Neither ADMIN_DATABASE_URL nor DATABASE_URL is set — cannot reach the tenant registry.",
    );
  }
  return url;
}

export function registryDatabase(): Pool {
  if (!registryPool) {
    registryPool = new Pool({ connectionString: registryConnectionString() });
  }
  return registryPool;
}

/** Test/shutdown hook: drops the cached registry pool so the next call rebuilds it. */
export async function closeRegistryDatabase(): Promise<void> {
  if (registryPool) {
    await registryPool.end();
    registryPool = undefined;
  }
}
