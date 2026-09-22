import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { database } from "../../../libs/common/src/database";
import { hashCode } from "../../../libs/common/src/otp";
import { AbhaController } from "./abha.controller";

jest.mock("../../../libs/common/src/database");

const mockedDatabase = database as jest.MockedFunction<typeof database>;

function mockClient(queryImpl: jest.Mock) {
  return { query: queryImpl, release: jest.fn() };
}

describe("AbhaController.verifyRequest", () => {
  let controller: AbhaController;

  beforeEach(() => {
    controller = new AbhaController();
    mockedDatabase.mockReset();
  });

  it("increments attempts via a standalone query, not a transaction, so a wrong guess still durably counts", async () => {
    const query = jest.fn().mockResolvedValueOnce({
      rows: [{ attempts: 1, code_hash: hashCode("111111"), expires_at: new Date(Date.now() + 60_000), user_id: "user-1", tenant_id: "tenant-1", abha_id: "42-1234" }],
    });
    mockedDatabase.mockReturnValue({ query } as any);

    await expect(controller.verifyRequest("req-1", { code: "000000" })).rejects.toBeInstanceOf(BadRequestException);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE abha_requests SET attempts = attempts + 1"), ["req-1"]);
  });

  it("locks out once the attempt budget is exceeded", async () => {
    const query = jest.fn().mockResolvedValueOnce({
      rows: [{ attempts: 6, code_hash: hashCode("111111"), expires_at: new Date(Date.now() + 60_000), user_id: "user-1", tenant_id: null, abha_id: "42-1234" }],
    });
    mockedDatabase.mockReturnValue({ query } as any);

    await expect(controller.verifyRequest("req-1", { code: "111111" })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects an expired request", async () => {
    const query = jest.fn().mockResolvedValueOnce({
      rows: [{ attempts: 1, code_hash: hashCode("111111"), expires_at: new Date(Date.now() - 1000), user_id: "user-1", tenant_id: null, abha_id: "42-1234" }],
    });
    mockedDatabase.mockReturnValue({ query } as any);

    await expect(controller.verifyRequest("req-1", { code: "111111" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an unknown or already-resolved request", async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] });
    mockedDatabase.mockReturnValue({ query } as any);

    await expect(controller.verifyRequest("missing", { code: "111111" })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("links the patient and logs tenant activity on a correct, unexpired code from a staff-initiated request", async () => {
    const client = mockClient(
      jest.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({}) // update abha_requests status
        .mockResolvedValueOnce({}) // update abha_links
        .mockResolvedValueOnce({}) // insert abha_activity
        .mockResolvedValueOnce(undefined), // COMMIT
    );
    const query = jest.fn().mockResolvedValueOnce({
      rows: [{ attempts: 1, code_hash: hashCode("111111"), expires_at: new Date(Date.now() + 60_000), user_id: "user-1", tenant_id: "tenant-1", abha_id: "42-1234" }],
    });
    mockedDatabase.mockReturnValue({ query, connect: () => Promise.resolve(client) } as any);

    const result = await controller.verifyRequest("req-1", { code: "111111" });

    expect(result).toEqual({ userId: "user-1", status: "linked" });
    expect(client.query.mock.calls.some((c) => typeof c[0] === "string" && c[0].includes("INSERT INTO abha_activity"))).toBe(true);
  });

  it("does not log tenant activity for a patient self-service request", async () => {
    const client = mockClient(
      jest.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({}) // update abha_requests status
        .mockResolvedValueOnce({}) // update abha_links
        .mockResolvedValueOnce(undefined), // COMMIT
    );
    const query = jest.fn().mockResolvedValueOnce({
      rows: [{ attempts: 1, code_hash: hashCode("111111"), expires_at: new Date(Date.now() + 60_000), user_id: "user-1", tenant_id: null, abha_id: "42-1234" }],
    });
    mockedDatabase.mockReturnValue({ query, connect: () => Promise.resolve(client) } as any);

    await controller.verifyRequest("req-1", { code: "111111" });

    expect(client.query).toHaveBeenCalledTimes(4);
  });
});
