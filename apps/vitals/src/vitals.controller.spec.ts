import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { database } from "../../../libs/common/src/database";
import { VitalsController } from "./vitals.controller";

jest.mock("../../../libs/common/src/database");

const mockedDatabase = database as jest.MockedFunction<typeof database>;

describe("VitalsController.shared", () => {
  let controller: VitalsController;

  beforeEach(() => {
    controller = new VitalsController();
    mockedDatabase.mockReset();
  });

  it("requires both userId and tenantId", async () => {
    await expect(
      controller.shared(undefined, "tenant-1", undefined, undefined, undefined, { user: { sub: "staff-1", tenantId: "tenant-1" } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a caller whose token tenantId doesn't match the query", async () => {
    await expect(
      controller.shared("user-1", "tenant-1", undefined, undefined, undefined, { user: { sub: "staff-1", tenantId: "tenant-2" } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects when the patient isn't linked to the tenant", async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] }); // isLinked → no match
    mockedDatabase.mockReturnValue({ query } as any);

    await expect(
      controller.shared("user-1", "tenant-1", undefined, undefined, undefined, { user: { sub: "staff-1", tenantId: "tenant-1" } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns nothing when linked but no category is consented", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ x: 1 }] }) // isLinked
      .mockResolvedValueOnce({ rows: [] }); // consent rows, none enabled
    mockedDatabase.mockReturnValue({ query } as any);

    const result = await controller.shared("user-1", "tenant-1", undefined, undefined, undefined, { user: { sub: "staff-1", tenantId: "tenant-1" } });
    expect(result).toEqual([]);
  });

  it("restricts the readings query to only the consented metric categories, and logs the access", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ x: 1 }] }) // isLinked
      .mockResolvedValueOnce({ rows: [{ category: "heart_rate" }] }) // only heart_rate consented
      .mockResolvedValueOnce({ rows: [{ metric: "heart_rate", value: 78, unit: "bpm" }] }) // filtered readings
      .mockResolvedValueOnce({}); // access log insert
    mockedDatabase.mockReturnValue({ query } as any);

    const result = await controller.shared("user-1", "tenant-1", undefined, undefined, undefined, { user: { sub: "staff-1", tenantId: "tenant-1" } });

    expect(result).toEqual([{ metric: "heart_rate", value: 78, unit: "bpm" }]);
    const readingsCall = query.mock.calls[2];
    expect(readingsCall[0]).toContain("metric = ANY($2)");
    expect(readingsCall[1]).toEqual(["user-1", ["heart_rate"]]);
    const accessLogCall = query.mock.calls[3];
    expect(accessLogCall[0]).toContain("INSERT INTO vitals_access_log");
    expect(accessLogCall[1]).toEqual(expect.arrayContaining(["user-1", "tenant-1", "staff-1"]));
  });

  it("returns nothing when an explicitly requested metric isn't in a consented category", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ x: 1 }] }) // isLinked
      .mockResolvedValueOnce({ rows: [{ category: "heart_rate" }] }); // spo2 not consented
    mockedDatabase.mockReturnValue({ query } as any);

    const result = await controller.shared("user-1", "tenant-1", "spo2", undefined, undefined, { user: { sub: "staff-1", tenantId: "tenant-1" } });
    expect(result).toEqual([]);
  });
});

describe("VitalsController.ingest — triage evaluation", () => {
  let controller: VitalsController;
  const req = { user: { sub: "user-1" } };
  const body = { readings: [{ metric: "heart_rate", value: 160, unit: "bpm", recordedAt: "2026-01-01T00:00:00.000Z", source: "google_fit" }] };

  beforeEach(() => {
    controller = new VitalsController();
    mockedDatabase.mockReset();
  });

  function mockClient(queryImpl: jest.Mock) {
    return { query: queryImpl, release: jest.fn() };
  }

  it("creates a triage event when a linked patient's reading breaches the hospital-wide rule", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // beginIdempotent insert (new key)
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] }) // link lookup
      .mockResolvedValueOnce({}) // insert vitals_readings
      .mockResolvedValueOnce({ rows: [] }) // patient_alert_overrides — none
      .mockResolvedValueOnce({ rows: [{ comparator: "gt", threshold: "150" }] }) // alert_rules — breached
      .mockResolvedValueOnce({}) // insert triage_events
      .mockResolvedValueOnce({}) // completeIdempotent update
      .mockResolvedValueOnce(undefined); // COMMIT
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(mockClient(query)) } as any);

    await controller.ingest(body as any, "idem-key-1234567890", req as any);

    const calls = query.mock.calls.map((c) => c[0]);
    expect(calls.some((sql: string) => sql.includes("INSERT INTO triage_events"))).toBe(true);
    expect(calls.some((sql: string) => sql.includes("vitals_consent"))).toBe(false);
  });

  it("does not create a triage event for a non-breaching reading", async () => {
    const nonBreaching = { readings: [{ ...body.readings[0], value: 90 }] };
    const query = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ comparator: "gt", threshold: "150" }] })
      .mockResolvedValueOnce({}) // completeIdempotent
      .mockResolvedValueOnce(undefined); // COMMIT
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(mockClient(query)) } as any);

    await controller.ingest(nonBreaching as any, "idem-key-1234567890", req as any);

    const calls = query.mock.calls.map((c) => c[0]);
    expect(calls.some((sql: string) => sql.includes("INSERT INTO triage_events"))).toBe(false);
  });

  it("skips evaluation entirely for an unlinked patient", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] }) // no link
      .mockResolvedValueOnce({}) // insert vitals_readings
      .mockResolvedValueOnce({}) // completeIdempotent
      .mockResolvedValueOnce(undefined); // COMMIT
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(mockClient(query)) } as any);

    await controller.ingest(body as any, "idem-key-1234567890", req as any);

    expect(query).toHaveBeenCalledTimes(6);
  });
});

describe("VitalsController.sharedRoster", () => {
  let controller: VitalsController;

  beforeEach(() => {
    controller = new VitalsController();
    mockedDatabase.mockReset();
  });

  it("groups filtered readings per patient, honoring each patient's own consent", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({
        rows: [
          { user_id: "patient-1", category: "heart_rate" },
          { user_id: "patient-2", category: "spo2" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { user_id: "patient-1", metric: "heart_rate", value: "78", unit: "bpm", recorded_at: "t1" },
          { user_id: "patient-1", metric: "spo2", value: "97", unit: "%", recorded_at: "t1" }, // not consented for patient-1
          { user_id: "patient-2", metric: "spo2", value: "95", unit: "%", recorded_at: "t2" },
        ],
      });
    mockedDatabase.mockReturnValue({ query } as any);

    const result = await controller.sharedRoster("tenant-1", { user: { sub: "staff-1", tenantId: "tenant-1" } });

    expect(result).toEqual([
      { userId: "patient-1", readings: [{ metric: "heart_rate", value: "78", unit: "bpm", recordedAt: "t1" }] },
      { userId: "patient-2", readings: [{ metric: "spo2", value: "95", unit: "%", recordedAt: "t2" }] },
    ]);
    // Exactly 2 calls (consent join + readings) — confirms sharedRoster never
    // writes to vitals_access_log, unlike the single-patient /vitals/shared.
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("returns an empty array when no patient is linked to the tenant", async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] });
    mockedDatabase.mockReturnValue({ query } as any);

    const result = await controller.sharedRoster("tenant-1", { user: { sub: "staff-1", tenantId: "tenant-1" } });
    expect(result).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
