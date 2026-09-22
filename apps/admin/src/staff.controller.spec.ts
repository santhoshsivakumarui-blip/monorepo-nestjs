import { BadRequestException, NotFoundException } from "@nestjs/common";
import { database } from "../../../libs/common/src/database";
import { StaffController } from "./staff.controller";

jest.mock("../../../libs/common/src/database");

const mockedDatabase = database as jest.MockedFunction<typeof database>;

function mockClient(queryImpl: jest.Mock) {
  return { query: queryImpl, release: jest.fn() };
}

describe("StaffController.acceptInvite", () => {
  let controller: StaffController;

  beforeEach(() => {
    controller = new StaffController();
    mockedDatabase.mockReset();
  });

  it("rejects a token that doesn't exist", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // no invite row
      .mockResolvedValueOnce(undefined); // ROLLBACK
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(mockClient(query)) } as any);

    await expect(controller.acceptInvite("bad-token", { password: "supersecret1" }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects an already-consumed invite", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ staff_id: "s1", expires_at: new Date(Date.now() + 60_000), consumed_at: new Date() }] })
      .mockResolvedValueOnce(undefined);
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(mockClient(query)) } as any);

    await expect(controller.acceptInvite("used-token", { password: "supersecret1" }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects an expired invite", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ staff_id: "s1", expires_at: new Date(Date.now() - 60_000), consumed_at: null }] })
      .mockResolvedValueOnce(undefined);
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(mockClient(query)) } as any);

    await expect(controller.acceptInvite("expired-token", { password: "supersecret1" }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("activates the staff account on a valid, unexpired, unused invite", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ staff_id: "s1", expires_at: new Date(Date.now() + 60_000), consumed_at: null }] })
      .mockResolvedValueOnce({}) // update tenant_staff
      .mockResolvedValueOnce({}) // update staff_invites
      .mockResolvedValueOnce(undefined); // COMMIT
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(mockClient(query)) } as any);

    const result = await controller.acceptInvite("good-token", { password: "supersecret1" });

    expect(result).toEqual({ staffId: "s1", accepted: true });
    expect(query.mock.calls[2][0]).toContain("UPDATE tenant_staff SET password_hash");
  });
});

describe("StaffController status transitions", () => {
  let controller: StaffController;

  beforeEach(() => {
    controller = new StaffController();
    mockedDatabase.mockReset();
  });

  it("suspends a staff member within the caller's own tenant", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1", email: "doc@example.com" }] })
      .mockResolvedValueOnce({}) // update status
      .mockResolvedValueOnce({}) // audit event
      .mockResolvedValueOnce(undefined); // COMMIT
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(mockClient(query)) } as any);

    const result = await controller.suspend("staff-1", { user: { sub: "admin-1", tenantId: "tenant-1" } });

    expect(result).toEqual({ id: "staff-1", status: "suspended" });
  });

  it("rejects suspending a staff member in a different tenant", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-2", email: "doc@example.com" }] })
      .mockResolvedValueOnce(undefined);
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(mockClient(query)) } as any);

    await expect(controller.suspend("staff-1", { user: { sub: "admin-1", tenantId: "tenant-1" } }))
      .rejects.toThrow("Cannot access another tenant's data.");
  });
});
