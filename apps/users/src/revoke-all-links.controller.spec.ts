import { database } from "../../../libs/common/src/database";
import { RevokeAllLinksController } from "./revoke-all-links.controller";

jest.mock("../../../libs/common/src/database");

const mockedDatabase = database as jest.MockedFunction<typeof database>;

function mockClient(queryImpl: jest.Mock) {
  return { query: queryImpl, release: jest.fn() };
}

describe("RevokeAllLinksController", () => {
  let controller: RevokeAllLinksController;

  beforeEach(() => {
    controller = new RevokeAllLinksController();
    mockedDatabase.mockReset();
  });

  it("unlinks every patient linked to the tenant", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // inbox insert (new)
      .mockResolvedValueOnce({ rows: [{ user_id: "p1" }, { user_id: "p2" }] }) // linked patients
      // p1: unlinkPatientFromTenant
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] }) // select for update
      .mockResolvedValueOnce({}) // delete
      .mockResolvedValueOnce({}) // outbox insert
      // p2: unlinkPatientFromTenant
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(undefined); // COMMIT
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(mockClient(query)) } as any);

    await controller.handle({ key: "evt-1", value: { tenantId: "tenant-1" } });

    const deleteCalls = query.mock.calls.filter((c) => typeof c[0] === "string" && c[0].includes("DELETE FROM patient_hospital_links"));
    expect(deleteCalls).toHaveLength(2);
  });

  it("does nothing beyond the dedupe insert when the event was already processed", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0 }) // already processed
      .mockResolvedValueOnce(undefined); // COMMIT
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(mockClient(query)) } as any);

    await controller.handle({ key: "evt-1", value: { tenantId: "tenant-1" } });

    expect(query).toHaveBeenCalledTimes(3);
  });

  it("ignores a message with no key", async () => {
    const connect = jest.fn();
    mockedDatabase.mockReturnValue({ connect } as any);

    await controller.handle({ value: { tenantId: "tenant-1" } });

    expect(connect).not.toHaveBeenCalled();
  });
});
