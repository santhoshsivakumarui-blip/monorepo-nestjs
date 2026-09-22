import { Pool } from "pg";
import { fetchTenantDatabaseSecret } from "./secret-store";

/**
 * One pg Pool per dedicated database key, with lifecycle limits so a handful of
 * Enterprise tenants can't exhaust a service's file descriptors / Postgres
 * connections:
 *   - a hard cap on the number of dedicated pools held per process,
 *   - a per-pool connection ceiling,
 *   - idle eviction (LRU) of pools that haven't been used recently.
 *
 * Pooled (Starter/Growth) tenants never come through here — they use the
 * service's own default pool (libs/common database()). This module only manages
 * the extra, per-tenant dedicated pools.
 */

interface PoolEntry {
  pool: Pool;
  lastUsed: number;
}

const pools = new Map<string, PoolEntry>();
let evictionTimer: NodeJS.Timeout | undefined;

function config() {
  return {
    maxPools: Number(process.env.TENANT_POOL_MAX ?? 50),
    maxConnectionsPerPool: Number(process.env.TENANT_POOL_MAX_CONNECTIONS ?? 5),
    idleTtlMs: Number(process.env.TENANT_POOL_IDLE_MS ?? 600_000),
  };
}

/**
 * Local-dev placeholder for the SHARED pool's connection string only
 * (shared_pool_db) — not tenant-specific, so there's nothing to encrypt
 * per-tenant. TENANT_DB_CONNECTIONS is a JSON object read from the
 * environment.
 */
function resolveConnectionStringFromEnv(databaseKey: string): string | undefined {
  const raw = process.env.TENANT_DB_CONNECTIONS;
  if (!raw) return undefined;
  const map = JSON.parse(raw) as Record<string, string>;
  return map[databaseKey];
}

/**
 * Dedicated per-tenant databases (created by
 * apps/admin/src/provision-dedicated-database.ts) resolve here first — see
 * secret-store.ts for the encrypted-at-rest storage this now checks, in
 * place of the old TENANT_DB_CONNECTIONS-only lookup. Falls back to the env
 * var for the shared pool.
 */
async function resolveConnectionString(databaseKey: string): Promise<string> {
  const stored = await fetchTenantDatabaseSecret(databaseKey);
  if (stored) return stored;

  const fromEnv = resolveConnectionStringFromEnv(databaseKey);
  if (fromEnv) return fromEnv;

  throw new Error(`No connection string configured for database key ${databaseKey}`);
}

/** True when a pool has no in-flight or waiting work and is safe to end. */
function isIdle(entry: PoolEntry): boolean {
  return entry.pool.waitingCount === 0 && entry.pool.totalCount === entry.pool.idleCount;
}

async function evict(databaseKey: string): Promise<void> {
  const entry = pools.get(databaseKey);
  if (!entry) return;
  pools.delete(databaseKey);
  await entry.pool.end().catch(() => undefined);
}

/**
 * Frees room for one more pool by ending the least-recently-used idle pool.
 * Returns false if every cached pool is busy — the caller then decides whether
 * to exceed the cap rather than block a live request.
 */
async function evictLeastRecentlyUsedIdle(): Promise<boolean> {
  let oldestKey: string | undefined;
  let oldestUsed = Infinity;
  for (const [key, entry] of pools) {
    if (isIdle(entry) && entry.lastUsed < oldestUsed) {
      oldestUsed = entry.lastUsed;
      oldestKey = key;
    }
  }
  if (!oldestKey) return false;
  await evict(oldestKey);
  return true;
}

/** Ends every pool idle for longer than TENANT_POOL_IDLE_MS. Runs on a timer and is exported for tests. */
export async function evictIdlePools(now: number = Date.now()): Promise<string[]> {
  const { idleTtlMs } = config();
  const evicted: string[] = [];
  for (const [key, entry] of [...pools]) {
    if (isIdle(entry) && now - entry.lastUsed >= idleTtlMs) {
      await evict(key);
      evicted.push(key);
    }
  }
  return evicted;
}

function ensureEvictionTimer(): void {
  if (evictionTimer) return;
  const { idleTtlMs } = config();
  const interval = Math.max(1_000, Math.floor(idleTtlMs / 2));
  evictionTimer = setInterval(() => {
    void evictIdlePools();
  }, interval);
  // Don't keep the process alive just to evict idle pools.
  evictionTimer.unref?.();
}

export function stopPoolEviction(): void {
  if (evictionTimer) {
    clearInterval(evictionTimer);
    evictionTimer = undefined;
  }
}

/** Caches one Pool per databaseKey. Never create a new pg Pool per request. */
export async function getOrCreatePool(databaseKey: string): Promise<Pool> {
  const existing = pools.get(databaseKey);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.pool;
  }

  const { maxPools, maxConnectionsPerPool } = config();
  if (pools.size >= maxPools) {
    // Make room before opening another pool; if everything is busy we still
    // create the pool (a live request must not fail) but it will be the first
    // candidate for eviction once it goes idle.
    await evictLeastRecentlyUsedIdle();
  }

  const pool = new Pool({
    connectionString: await resolveConnectionString(databaseKey),
    max: maxConnectionsPerPool,
  });
  pools.set(databaseKey, { pool, lastUsed: Date.now() });
  ensureEvictionTimer();
  return pool;
}

/** Snapshot of current pool-cache state — used by tests and the health/metrics endpoint. */
export function getPoolStats(): { size: number; keys: string[]; totalConnections: number } {
  let totalConnections = 0;
  for (const entry of pools.values()) totalConnections += entry.pool.totalCount;
  return { size: pools.size, keys: [...pools.keys()], totalConnections };
}

export async function closeAllPools() {
  stopPoolEviction();
  await Promise.all([...pools.values()].map((entry) => entry.pool.end().catch(() => undefined)));
  pools.clear();
}
