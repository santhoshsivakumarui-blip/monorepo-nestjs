import { database } from "../../../libs/common/src/database";
import { FaceScanController } from "./face-scan.controller";

jest.mock("../../../libs/common/src/database");

const mockedDatabase = database as jest.MockedFunction<typeof database>;

describe("FaceScanController.submit", () => {
  let controller: FaceScanController;

  beforeEach(() => {
    controller = new FaceScanController();
    mockedDatabase.mockReset();
  });

  it("routes all 7 vitals-shaped fields through insertReading (including triage evaluation), not a plain insert", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // beginIdempotent insert
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] }) // resolveLinkedTenant
      // 7 readings × (insert vitals_readings, override lookup, hospital-wide lookup) = 21 calls
      .mockResolvedValue({ rows: [] }); // default for everything after (no rule matches → no triage insert)
    const client = { query, release: jest.fn() };
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(client) } as any);

    const body = {
      recordedAt: "2026-01-01T00:00:00.000Z",
      hr: 78, bpSystolic: 118, bpDiastolic: 76, rr: 15, spo2: 97, temperature: 36.8, hrv: 42,
      overallScore: 78,
    };
    await controller.submit(body as any, "idem-key-1234567890", { user: { sub: "user-1" } });

    const insertedMetrics = query.mock.calls
      .filter((c) => typeof c[0] === "string" && c[0].includes("INSERT INTO vitals_readings"))
      .map((c) => c[1][2]); // metric is the 3rd bound param in insertReading's INSERT
    expect(insertedMetrics).toEqual([
      "heart_rate", "blood_pressure_systolic", "blood_pressure_diastolic", "respiratory_rate", "spo2", "temperature", "hrv",
    ]);
    expect(query.mock.calls.some((c) => typeof c[0] === "string" && c[0].includes("INSERT INTO face_scan_results"))).toBe(true);
  });
});
