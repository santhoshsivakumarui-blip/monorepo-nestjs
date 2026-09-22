import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

let pool: Pool | undefined;
export function database(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

/**
 * Resolves the pg Pool a given tenant's data physically lives in. Registered
 * once per service at bootstrap (see libs/tenancy/src/router.ts's
 * registerTenantRouting): for a pooled tenant it returns this service's default
 * pool; for an Enterprise (dedicated) tenant it returns that tenant's own pool.
 *
 * This indirection exists so libs/common never imports libs/tenancy (which
 * depends on libs/common) — the tenancy layer injects the resolver instead.
 * When no resolver is registered (scripts, tests, single-DB setups) everything
 * falls back to the default pool, i.e. exactly today's pooled-only behavior.
 */
export type TenantPoolResolver = (tenantId: string) => Promise<Pool>;
let tenantPoolResolver: TenantPoolResolver | undefined;

export function registerTenantPoolResolver(resolver: TenantPoolResolver | undefined): void {
  tenantPoolResolver = resolver;
}

/** The pool a tenant's data lives in: its dedicated DB, or the service default when pooled/unregistered. */
export async function poolForTenant(tenantId: string): Promise<Pool> {
  if (tenantPoolResolver) return tenantPoolResolver(tenantId);
  return database();
}

/**
 * Sets app.tenant_id for the duration of a transaction on a pooled tenant
 * database, so RLS policies (docs/database-tenancy-strategy.md §6) can scope
 * every query to the caller's tenant. Call at the start of a transaction,
 * before any tenant-owned table is queried.
 *
 * `is_local=true` (the third set_config argument) scopes the setting to the
 * CURRENT transaction only, resetting at COMMIT/ROLLBACK. This matters
 * because `client` comes from a shared pg Pool: a session-scoped
 * (`is_local=false`) setting would leak into whichever unrelated request
 * reuses this same underlying connection next. Always call this between
 * BEGIN and COMMIT — never on a client running outside a transaction, where
 * each bare `client.query(...)` is its own implicit auto-committed
 * transaction and the setting would be gone before the next statement runs.
 */
export async function setTenantContext(client: PoolClient, tenantId: string): Promise<void> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
}

export async function withTenantContext<T>(
  client: PoolClient,
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await setTenantContext(client, tenantId);
  return fn();
}

/**
 * Runs `fn` inside a transaction with app.tenant_id set for its duration —
 * the BEGIN/set_config/COMMIT-or-ROLLBACK/release ceremony withTenantContext
 * itself doesn't do. Use this (or queryAsTenant below) for any query against
 * a table that has an RLS policy, instead of calling database().query(...)
 * directly, so the policy has a tenant to scope against once RLS is
 * actually enforced (see infra/postgres/migrations/*\/*_row_level_security.sql).
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await (await poolForTenant(tenantId)).connect();
  try {
    await client.query('BEGIN');
    const result = await withTenantContext(client, tenantId, () => fn(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Single-query convenience wrapper over withTenantTransaction. */
export async function queryAsTenant<T extends QueryResultRow = QueryResultRow>(
  tenantId: string,
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return withTenantTransaction(tenantId, (client) => client.query<T>(text, params));
}
