import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { database } from "../../../libs/common/src/database";
import { hashCode } from "../../../libs/common/src/otp";
import { PatientAuthController } from "./patient-auth.controller";

jest.mock("../../../libs/common/src/database");

const mockedDatabase = database as jest.MockedFunction<typeof database>;

describe("PatientAuthController.verifyOtp", () => {
  const jwt = { sign: jest.fn().mockReturnValue("signed-jwt") } as any;
  let controller: PatientAuthController;

  beforeEach(() => {
    controller = new PatientAuthController(jwt);
    mockedDatabase.mockReset();
    jwt.sign.mockClear();
  });

  it("increments attempts via a standalone query, not a transaction, so a wrong guess still durably counts", async () => {
    const connect = jest.fn();
    const query = jest.fn().mockResolvedValueOnce({
      rows: [{ attempts: 1, code_hash: hashCode("111111"), expires_at: new Date(Date.now() + 60_000), phone: "+919999999999" }],
    });
    mockedDatabase.mockReturnValue({ query, connect } as any);

    await expect(controller.verifyOtp({ challengeId: "c1", code: "000000" })).rejects.toBeInstanceOf(UnauthorizedException);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE otp_challenges SET attempts = attempts + 1"),
      ["c1"],
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it("locks out once the attempt budget is exceeded", async () => {
    const query = jest.fn().mockResolvedValueOnce({
      rows: [{ attempts: 6, code_hash: hashCode("111111"), expires_at: new Date(Date.now() + 60_000), phone: "+919999999999" }],
    });
    mockedDatabase.mockReturnValue({ query } as any);

    await expect(controller.verifyOtp({ challengeId: "c1", code: "111111" })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects an expired challenge even with the correct code", async () => {
    const query = jest.fn().mockResolvedValueOnce({
      rows: [{ attempts: 1, code_hash: hashCode("111111"), expires_at: new Date(Date.now() - 1000), phone: "+919999999999" }],
    });
    mockedDatabase.mockReturnValue({ query } as any);

    await expect(controller.verifyOtp({ challengeId: "c1", code: "111111" })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("issues a JWT and marks the challenge consumed on a correct, unexpired code", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({
        rows: [{ attempts: 1, code_hash: hashCode("111111"), expires_at: new Date(Date.now() + 60_000), phone: "+919999999999" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "user-1", roles: ["user"] }] })
      .mockResolvedValueOnce({});
    mockedDatabase.mockReturnValue({ query } as any);

    const result = await controller.verifyOtp({ challengeId: "c1", code: "111111" });

    expect(result).toEqual({ accessToken: "signed-jwt", userId: "user-1" });
    expect(query).toHaveBeenCalledWith("UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1", ["c1"]);
    expect(jwt.sign).toHaveBeenCalledWith(
      { sub: "user-1", roles: ["user"] },
      expect.any(Object),
    );
  });

  it("rejects a challenge id that doesn't exist or was already used", async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] });
    mockedDatabase.mockReturnValue({ query } as any);

    await expect(controller.verifyOtp({ challengeId: "missing", code: "111111" })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
