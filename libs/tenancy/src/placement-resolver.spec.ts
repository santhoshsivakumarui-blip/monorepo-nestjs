import { registryDatabase } from "./registry-database";
import { clearPlacementCache, resolvePlacement } from "./placement-resolver";

jest.mock("./registry-database");

const mockedDatabase = registryDatabase as jest.MockedFunction<typeof registryDatabase>;

describe("resolvePlacement", () => {
  beforeEach(() => {
    clearPlacementCache();
    mockedDatabase.mockReset();
  });

  it("resolves an active pooled placement (the '*' wildcard row)", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ mode: "pooled", pool_name: "shared_pool_01", database_key: "shared_pool_db", status: "active", service: "*" }],
    });
    mockedDatabase.mockReturnValue({ query } as any);

    await expect(resolvePlacement("tenant-1", "vitals")).resolves.toEqual({
      tenantId: "tenant-1",
      mode: "pooled",
      databaseKey: "shared_pool_db",
      poolName: "shared_pool_01",
      status: "active",
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.any(String), ["tenant-1", "vitals", "*"]);
  });

  it("resolves an active dedicated placement for a specific service", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ mode: "dedicated", pool_name: null, database_key: "enterprise_acme_vitals_db", status: "active", service: "vitals" }],
    });
    mockedDatabase.mockReturnValue({ query } as any);

    await expect(resolvePlacement("tenant-1", "vitals")).resolves.toEqual({
      tenantId: "tenant-1",
      mode: "dedicated",
      databaseKey: "enterprise_acme_vitals_db",
      poolName: undefined,
      status: "active",
    });
  });

  it("caches a resolved placement per (tenant, service) and does not re-query within the TTL", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ mode: "pooled", pool_name: "shared_pool_01", database_key: "shared_pool_db", status: "active", service: "*" }],
    });
    mockedDatabase.mockReturnValue({ query } as any);

    await resolvePlacement("tenant-2", "vitals");
    await resolvePlacement("tenant-2", "vitals");
    expect(query).toHaveBeenCalledTimes(1);

    await resolvePlacement("tenant-2", "users");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("throws when no placement row exists", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    mockedDatabase.mockReturnValue({ query } as any);

    await expect(resolvePlacement("tenant-3", "vitals")).rejects.toThrow(
      "Tenant database is unavailable for tenant tenant-3 (service vitals)",
    );
  });

  it("throws when the placement is not active", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ mode: "dedicated", pool_name: null, database_key: "enterprise_acme_vitals_db", status: "provisioning", service: "vitals" }],
    });
    mockedDatabase.mockReturnValue({ query } as any);

    await expect(resolvePlacement("tenant-4", "vitals")).rejects.toThrow(
      "Tenant database is unavailable for tenant tenant-4 (service vitals)",
    );
  });
});
