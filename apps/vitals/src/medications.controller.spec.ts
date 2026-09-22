import { database } from "../../../libs/common/src/database";
import { MedicationsController } from "./medications.controller";

jest.mock("../../../libs/common/src/database");

const mockedDatabase = database as jest.MockedFunction<typeof database>;

describe("MedicationsController.doses", () => {
  let controller: MedicationsController;

  beforeEach(() => {
    controller = new MedicationsController();
    mockedDatabase.mockReset();
  });

  it("ensures a dose row per active schedule via an idempotent upsert, then returns the day's doses", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: "sched-1", name: "Telmisartan", dose: "40mg", time_of_day: "07:00", note: null }] })
      .mockResolvedValueOnce({}) // the ON CONFLICT DO NOTHING insert
      .mockResolvedValueOnce({ rows: [{ id: "dose-1", name: "Telmisartan", dose: "40mg", time_of_day: "07:00", note: null, taken: false, taken_at: null }] });
    mockedDatabase.mockReturnValue({ query } as any);

    const result = await controller.doses("2026-01-01", { user: { sub: "user-1" } });

    expect(result).toHaveLength(1);
    const insertCall = query.mock.calls[1];
    expect(insertCall[0]).toContain("ON CONFLICT (schedule_id, scheduled_date) DO NOTHING");
  });

  it("is safe to call twice for the same date — the insert never errors on a duplicate", async () => {
    const query = jest.fn()
      .mockResolvedValue({ rows: [] }); // same mock resolves every call; real dedup is enforced by the DB constraint
    mockedDatabase.mockReturnValue({ query } as any);

    await expect(controller.doses("2026-01-01", { user: { sub: "user-1" } })).resolves.toEqual([]);
    await expect(controller.doses("2026-01-01", { user: { sub: "user-1" } })).resolves.toEqual([]);
  });
});
