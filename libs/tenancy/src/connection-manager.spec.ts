import { closeAllPools, getOrCreatePool } from "./connection-manager";
import { fetchTenantDatabaseSecret } from "./secret-store";

jest.mock("./secret-store");

const mockedFetchSecret = fetchTenantDatabaseSecret as jest.MockedFunction<typeof fetchTenantDatabaseSecret>;

describe("getOrCreatePool", () => {
  const originalEnv = process.env.TENANT_DB_CONNECTIONS;

  beforeEach(() => {
    // No dedicated-database secret registered, by default — most cases fall
    // through to the env var (or find nothing, for the "throws" cases).
    mockedFetchSecret.mockResolvedValue(null);
  });

  afterEach(async () => {
    process.env.TENANT_DB_CONNECTIONS = originalEnv;
    await closeAllPools();
  });

  it("throws when neither the secret store nor TENANT_DB_CONNECTIONS has this key", async () => {
    delete process.env.TENANT_DB_CONNECTIONS;
    await expect(getOrCreatePool("shared_pool_db")).rejects.toThrow(
      "No connection string configured for database key shared_pool_db",
    );
  });

  it("throws when the database key has no configured connection string", async () => {
    process.env.TENANT_DB_CONNECTIONS = JSON.stringify({ shared_pool_db: "postgresql://x" });
    await expect(getOrCreatePool("enterprise_acme_db")).rejects.toThrow(
      "No connection string configured for database key enterprise_acme_db",
    );
  });

  it("resolves the shared pool from TENANT_DB_CONNECTIONS", async () => {
    process.env.TENANT_DB_CONNECTIONS = JSON.stringify({ shared_pool_db: "postgresql://x" });
    await expect(getOrCreatePool("shared_pool_db")).resolves.toBeTruthy();
  });

  it("prefers a dedicated database's encrypted secret over the env var", async () => {
    process.env.TENANT_DB_CONNECTIONS = JSON.stringify({});
    mockedFetchSecret.mockResolvedValue("postgresql://user:pass@host/enterprise_acme_vitals_db");
    await expect(getOrCreatePool("enterprise_acme_vitals_db")).resolves.toBeTruthy();
    expect(mockedFetchSecret).toHaveBeenCalledWith("enterprise_acme_vitals_db");
  });

  it("caches a pool by database key instead of creating a new one per call", async () => {
    process.env.TENANT_DB_CONNECTIONS = JSON.stringify({ shared_pool_db: "postgresql://x" });
    const first = await getOrCreatePool("shared_pool_db");
    const second = await getOrCreatePool("shared_pool_db");
    expect(first).toBe(second);
  });
});
