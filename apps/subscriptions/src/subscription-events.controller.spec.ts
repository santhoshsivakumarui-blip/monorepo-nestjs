import { database } from "../../../libs/common/src/database";
import { SubscriptionEventsController } from "./subscription-events.controller";

jest.mock("../../../libs/common/src/database");

const mockedDatabase = database as jest.MockedFunction<typeof database>;

function mockClient(inboxRowCount: number) {
  const query = jest.fn()
    .mockResolvedValueOnce(undefined) // BEGIN
    .mockResolvedValueOnce({ rowCount: inboxRowCount }) // inbox insert
    .mockResolvedValue(undefined); // everything after
  return { query, release: jest.fn() };
}

describe("SubscriptionEventsController", () => {
  let controller: SubscriptionEventsController;

  beforeEach(() => {
    controller = new SubscriptionEventsController();
    mockedDatabase.mockReset();
  });

  it("upserts the link cache and links active subscriptions on a new link event", async () => {
    const client = mockClient(1);
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(client) } as any);

    await controller.patientHospitalLinked({
      key: "evt-1",
      value: { userId: "user-1", tenantId: "tenant-1" },
    });

    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toContain("INSERT INTO inbox_events");
    expect(calls[2]).toContain("INSERT INTO patient_hospital_link_cache");
    expect(calls[3]).toContain("UPDATE device_subscriptions SET linked_tenant_id");
    expect(calls[4]).toBe("COMMIT");
  });

  it("does nothing beyond the dedupe insert when the event was already processed", async () => {
    const client = mockClient(0);
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(client) } as any);

    await controller.patientHospitalLinked({
      key: "evt-1",
      value: { userId: "user-1", tenantId: "tenant-1" },
    });

    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(["BEGIN", expect.stringContaining("INSERT INTO inbox_events"), "COMMIT"]);
  });

  it("clears the link cache and every subscription's linked_tenant_id on unlink", async () => {
    const client = mockClient(1);
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(client) } as any);

    await controller.patientHospitalUnlinked({
      key: "evt-2",
      value: { userId: "user-1", tenantId: "tenant-1" },
    });

    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls[2]).toContain("DELETE FROM patient_hospital_link_cache");
    expect(calls[3]).toContain("UPDATE device_subscriptions SET linked_tenant_id = NULL");
  });

  it("ignores a message with no key (cannot be deduped)", async () => {
    mockedDatabase.mockReturnValue({ connect: jest.fn() } as any);

    await controller.patientHospitalLinked({ value: { userId: "user-1", tenantId: "tenant-1" } });

    expect(mockedDatabase().connect).not.toHaveBeenCalled();
  });
});
