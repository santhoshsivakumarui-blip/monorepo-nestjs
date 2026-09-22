import { database, registerTenantPoolResolver } from "../../common/src/database";
import { findPlacement } from "./placement-resolver";
import { getOrCreatePool } from "./connection-manager";
import { registerTenantRouting, resolveTenantPool, scatterGather } from "./router";

jest.mock("../../common/src/database");
jest.mock("./placement-resolver");
jest.mock("./connection-manager");

const mockedDatabase = database as jest.MockedFunction<typeof database>;
const mockedRegister = registerTenantPoolResolver as jest.MockedFunction<typeof registerTenantPoolResolver>;
const mockedFindPlacement = findPlacement as jest.MockedFunction<typeof findPlacement>;
const mockedGetOrCreatePool = getOrCreatePool as jest.MockedFunction<typeof getOrCreatePool>;

const defaultPool = { tag: "default" } as any;
const dedicatedPool = { tag: "dedicated" } as any;

describe("resolveTenantPool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDatabase.mockReturnValue(defaultPool);
    mockedGetOrCreatePool.mockResolvedValue(dedicatedPool);
  });

  it("routes a pooled tenant to the service default pool", async () => {
    mockedFindPlacement.mockResolvedValue({
      tenantId: "t1", mode: "pooled", databaseKey: "shared_pool_db", status: "active",
    });
    await expect(resolveTenantPool("t1", "vitals")).resolves.toBe(defaultPool);
    expect(mockedGetOrCreatePool).not.toHaveBeenCalled();
  });

  it("routes a dedicated tenant to its own database pool", async () => {
    mockedFindPlacement.mockResolvedValue({
      tenantId: "t2", mode: "dedicated", databaseKey: "enterprise_acme_vitals_db", status: "active",
    });
    await expect(resolveTenantPool("t2", "vitals")).resolves.toBe(dedicatedPool);
    expect(mockedGetOrCreatePool).toHaveBeenCalledWith("enterprise_acme_vitals_db");
  });

  it("treats a tenant with no placement row as pooled (legacy fallback)", async () => {
    mockedFindPlacement.mockResolvedValue(null);
    await expect(resolveTenantPool("t3", "vitals")).resolves.toBe(defaultPool);
  });

  it("throws when a placement exists but is not active yet (mid-provisioning)", async () => {
    mockedFindPlacement.mockResolvedValue({
      tenantId: "t4", mode: "dedicated", databaseKey: "enterprise_acme_vitals_db", status: "provisioning",
    });
    await expect(resolveTenantPool("t4", "vitals")).rejects.toThrow("not ready");
  });
});

describe("registerTenantRouting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDatabase.mockReturnValue(defaultPool);
    mockedGetOrCreatePool.mockResolvedValue(dedicatedPool);
  });

  it("registers a resolver that routes by the service's placement", async () => {
    registerTenantRouting("vitals");
    expect(mockedRegister).toHaveBeenCalledTimes(1);
    const resolver = mockedRegister.mock.calls[0]![0]!;

    mockedFindPlacement.mockResolvedValue({
      tenantId: "t2", mode: "dedicated", databaseKey: "enterprise_acme_vitals_db", status: "active",
    });
    await expect(resolver("t2")).resolves.toBe(dedicatedPool);
    expect(mockedFindPlacement).toHaveBeenCalledWith("t2", "vitals");
  });
});

describe("scatterGather", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDatabase.mockReturnValue(defaultPool);
    mockedGetOrCreatePool.mockResolvedValue(dedicatedPool);
  });

  it("always queries the default pool, even with no links", async () => {
    const query = jest.fn().mockResolvedValue([{ id: "a" }]);
    const rows = await scatterGather([], "vitals", query);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(defaultPool);
    expect(rows).toEqual([{ id: "a" }]);
  });

  it("queries the default pool plus each linked dedicated pool once", async () => {
    mockedFindPlacement.mockResolvedValue({
      tenantId: "t2", mode: "dedicated", databaseKey: "enterprise_acme_vitals_db", status: "active",
    });
    const query = jest.fn()
      .mockResolvedValueOnce([{ id: "pooled" }])   // default pool
      .mockResolvedValueOnce([{ id: "dedicated" }]); // dedicated pool
    const rows = await scatterGather(["t2"], "vitals", query);
    expect(query).toHaveBeenCalledTimes(2);
    expect(rows).toEqual([{ id: "pooled" }, { id: "dedicated" }]);
  });

  it("does not query the same dedicated pool twice for two tenants that share it", async () => {
    mockedFindPlacement.mockResolvedValue({
      tenantId: "t2", mode: "dedicated", databaseKey: "enterprise_acme_vitals_db", status: "active",
    });
    const query = jest.fn().mockResolvedValue([]);
    await scatterGather(["t2", "t2-branch"], "vitals", query);
    // default pool + one dedicated pool (getOrCreatePool returns the same object)
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("keeps pooled tenants on the default pool (no extra query)", async () => {
    mockedFindPlacement.mockResolvedValue({
      tenantId: "t1", mode: "pooled", databaseKey: "shared_pool_db", status: "active",
    });
    const query = jest.fn().mockResolvedValue([]);
    await scatterGather(["t1"], "vitals", query);
    expect(query).toHaveBeenCalledTimes(1); // only the default pool
    expect(query).toHaveBeenCalledWith(defaultPool);
  });

  it("skips a tenant whose dedicated database is still provisioning rather than failing the read", async () => {
    mockedFindPlacement.mockResolvedValue({
      tenantId: "t4", mode: "dedicated", databaseKey: "enterprise_acme_vitals_db", status: "provisioning",
    });
    const query = jest.fn().mockResolvedValue([{ id: "pooled" }]);
    const rows = await scatterGather(["t4"], "vitals", query);
    expect(query).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([{ id: "pooled" }]);
  });

  it("de-duplicates rows across databases when dedupeBy is provided", async () => {
    mockedFindPlacement.mockResolvedValue({
      tenantId: "t2", mode: "dedicated", databaseKey: "enterprise_acme_vitals_db", status: "active",
    });
    const query = jest.fn()
      .mockResolvedValueOnce([{ id: "dup" }, { id: "only-pooled" }])
      .mockResolvedValueOnce([{ id: "dup" }, { id: "only-dedicated" }]);
    const rows = await scatterGather(["t2"], "vitals", query, { dedupeBy: (r: { id: string }) => r.id });
    expect(rows.map((r) => r.id)).toEqual(["dup", "only-pooled", "only-dedicated"]);
  });
});
