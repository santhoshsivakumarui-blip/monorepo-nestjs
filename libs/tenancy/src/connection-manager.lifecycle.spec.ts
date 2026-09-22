import {
  closeAllPools, evictIdlePools, getOrCreatePool, getPoolStats, stopPoolEviction,
} from "./connection-manager";
import { fetchTenantDatabaseSecret } from "./secret-store";

jest.mock("./secret-store");

const mockedFetchSecret = fetchTenantDatabaseSecret as jest.MockedFunction<typeof fetchTenantDatabaseSecret>;

describe("connection-manager pool lifecycle limits", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockedFetchSecret.mockResolvedValue(null);
    // No dedicated secrets — resolve everything from the env map.
    process.env.TENANT_DB_CONNECTIONS = JSON.stringify({
      db_a: "postgresql://a", db_b: "postgresql://b", db_c: "postgresql://c",
    });
  });

  afterEach(async () => {
    await closeAllPools();
    stopPoolEviction();
    process.env = { ...originalEnv };
  });

  it("caps the number of dedicated pools held per process, evicting the least-recently-used idle pool", async () => {
    process.env.TENANT_POOL_MAX = "2";
    await getOrCreatePool("db_a"); // oldest → LRU eviction candidate
    await getOrCreatePool("db_b");
    await getOrCreatePool("db_c"); // exceeds cap, evicts db_a

    const stats = getPoolStats();
    expect(stats.size).toBeLessThanOrEqual(2);
    expect(stats.keys).not.toContain("db_a"); // LRU evicted
    expect(stats.keys).toContain("db_b");
    expect(stats.keys).toContain("db_c");
  });

  it("applies a per-pool connection ceiling", async () => {
    process.env.TENANT_POOL_MAX_CONNECTIONS = "3";
    const pool = await getOrCreatePool("db_a");
    expect((pool as unknown as { options: { max: number } }).options.max).toBe(3);
  });

  it("evicts pools that have been idle longer than the TTL", async () => {
    process.env.TENANT_POOL_IDLE_MS = "1000";
    await getOrCreatePool("db_a");
    expect(getPoolStats().size).toBe(1);

    const evicted = await evictIdlePools(Date.now() + 5_000);
    expect(evicted).toEqual(["db_a"]);
    expect(getPoolStats().size).toBe(0);
  });

  it("does not evict a pool used within the TTL", async () => {
    process.env.TENANT_POOL_IDLE_MS = "10000";
    await getOrCreatePool("db_a");
    const evicted = await evictIdlePools(Date.now() + 5_000);
    expect(evicted).toEqual([]);
    expect(getPoolStats().size).toBe(1);
  });

  it("reuses a cached pool rather than opening a new one", async () => {
    const first = await getOrCreatePool("db_a");
    const second = await getOrCreatePool("db_a");
    expect(first).toBe(second);
    expect(getPoolStats().size).toBe(1);
  });
});
